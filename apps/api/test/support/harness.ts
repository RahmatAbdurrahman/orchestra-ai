/**
 * Integration test harness.
 *
 * Real:   NestJS API, PostgreSQL (TEST_DATABASE_URL), business logic, state
 *         machine, rule engine, approvals, automation executor + reconciler,
 *         UiPath adapter HTTP client, ERP simulation (purchase order idempotency).
 * Mocked: UiPath Orchestrator (in-process mock + simulated robot driving the ERP
 *         simulation web UI), document intelligence (stub returning a canned
 *         extraction), queue (in-process InlineJobQueue instead of BullMQ/Redis).
 *
 * Passing these tests does NOT prove anything about a real UiPath tenant/robot.
 */
import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import express from 'express';
import request from 'supertest';
import { createPrismaClient, type PrismaClient } from '@orchestra/database';
import { resetDatabase, seedDatabase } from '@orchestra/database/seed';
import { createErpApp } from '@orchestra/erp-simulation/dist/app';
import { PurchaseOrderStore } from '@orchestra/erp-simulation/dist/store';
import { createOrchestratorMock, type OrchestratorMock, type ScenarioMode } from '@orchestra/uipath-orchestrator-mock/dist/app';
import { ErpUiRobot } from '@orchestra/uipath-orchestrator-mock/dist/robot';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

export const TEST_PASSWORD = process.env.TEST_SEED_PASSWORD ?? 'Orchestra#2026';
export const API = '/api/v1';

const DI_TOKEN = 'test-document-intelligence-token';
const MOCK_ADMIN = 'test-mock-admin-token';

function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

type Field<T> = { value: T | null; confidence: number; needsReview: boolean; source?: string | null };
const field = <T>(value: T | null, confidence: number, needsReview = confidence < 0.85): Field<T> => ({
  value,
  confidence,
  needsReview,
  source: 'stub',
});

/** Canned extraction for "PT Sinar Jaya Abadi" invoice; the tax amount is deliberately low-confidence. */
export function sampleExtraction(overrides: { unitPrice?: number; quantity?: number; taxAmount?: number } = {}) {
  const quantity = overrides.quantity ?? 2;
  const unitPrice = overrides.unitPrice ?? 750_000;
  const subtotal = quantity * unitPrice;
  const tax = overrides.taxAmount ?? Math.round(subtotal * 0.11);
  return {
    documentType: 'INVOICE',
    extractionMethod: 'PDF_TEXT',
    pageCount: 1,
    fields: {
      supplierName: field('PT Sinar Jaya Abadi', 0.95),
      documentNumber: field(`INV-${Date.now()}`, 0.97),
      documentDate: field('2026-11-10', 0.93),
      currency: field('IDR', 0.99),
      subtotal: field(subtotal, 0.95),
      taxAmount: field(tax, 0.7, true),
      totalAmount: field(subtotal + tax, 0.95),
    },
    items: [
      {
        description: field('Laptop stand aluminium', 0.92),
        quantity: field(quantity, 0.95),
        unitPrice: field(unitPrice, 0.94),
        lineTotal: field(subtotal, 0.95),
        confidence: 0.94,
        needsReview: false,
      },
    ],
    overallConfidence: 0.91,
    needsReview: true,
    reviewReasons: ['Tax amount has low confidence'],
    warnings: [],
    rawTextPreview: 'INVOICE ...',
    processingMs: 5,
  };
}

export const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');

export interface Harness {
  app: INestApplication;
  http: Server;
  prisma: PrismaClient;
  erpStore: PurchaseOrderStore;
  orchestrator: OrchestratorMock;
  orchestratorUrl: string;
  documentIntelligence: { next: unknown; calls: number; failNext: number };
  login(email: string, password?: string): Promise<request.Agent>;
  setScenario(mode: ScenarioMode, count?: number): Promise<void>;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('TEST_DATABASE_URL must point to a disposable PostgreSQL database (it is truncated by the tests)');
  }

  // --- external systems (in-process) -----------------------------------------
  const erpStore = new PurchaseOrderStore(':memory:');
  const erp = await listen(
    createErpApp({ store: erpStore, username: 'robot.erp', password: 'erp-test-password', apiToken: 'erp-api', simAdminToken: 'erp-admin' }).app,
  );
  const orchestrator = createOrchestratorMock({
    clientId: 'orchestra-test',
    clientSecret: 'orchestra-test-secret',
    folderId: '42',
    processes: ['PurchaseOrderAutomation'],
    adminToken: MOCK_ADMIN,
    robot: new ErpUiRobot(erp.url, 'robot.erp', 'erp-test-password'),
    pendingMs: 50,
    runMs: 100,
    submitTimeoutDelayMs: 2_500,
  });
  const orchestratorServer = await listen(orchestrator.app);

  const documentIntelligence = { next: sampleExtraction() as unknown, calls: 0, failNext: 0 };
  const stub = express();
  stub.post('/v1/extract', (req, res) => {
    req.resume();
    req.on('end', () => {
      if (req.header('x-internal-token') !== DI_TOKEN) {
        res.status(401).json({ detail: 'invalid token' });
        return;
      }
      documentIntelligence.calls += 1;
      if (documentIntelligence.failNext > 0) {
        documentIntelligence.failNext -= 1;
        res.status(503).json({ detail: 'temporarily unavailable' });
        return;
      }
      res.json(documentIntelligence.next);
    });
  });
  stub.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  const diServer = await listen(stub);

  // --- environment for the API -------------------------------------------------
  const uploadDir = mkdtempSync(path.join(tmpdir(), 'orchestra-it-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    QUEUE_DRIVER: 'inline',
    UPLOAD_DIR: uploadDir,
    CORS_ORIGINS: 'http://localhost:3000',
    SWAGGER_ENABLED: 'false',
    DOCUMENT_INTELLIGENCE_URL: diServer.url,
    DOCUMENT_INTELLIGENCE_TOKEN: DI_TOKEN,
    UIPATH_MODE: 'mock',
    UIPATH_ORCHESTRATOR_URL: orchestratorServer.url,
    UIPATH_IDENTITY_URL: `${orchestratorServer.url}/identity_/connect/token`,
    UIPATH_CLIENT_ID: 'orchestra-test',
    UIPATH_CLIENT_SECRET: 'orchestra-test-secret',
    UIPATH_FOLDER_ID: '42',
    UIPATH_PROCESS_NAME: 'PurchaseOrderAutomation',
    UIPATH_REQUEST_TIMEOUT_MS: '1000',
    AUTOMATION_POLL_BASE_DELAY_MS: '100',
    AUTOMATION_POLL_MAX_DELAY_MS: '300',
    AUTOMATION_RETRY_BASE_DELAY_MS: '200',
    AUTOMATION_RETRY_MAX_DELAY_MS: '1000',
    INLINE_QUEUE_BACKOFF_SCALE: '0.02',
    RECONCILE_INTERVAL_MS: '3600000',
    LOGIN_MAX_FAILED_ATTEMPTS: '3',
    DEMO_LOGIN_ENABLED: 'false',
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    API_RATE_LIMIT_PER_MINUTE: '100000',
  });

  const prisma = createPrismaClient({ url: databaseUrl });
  await resetDatabase(prisma);
  await seedDatabase(prisma, { defaultPassword: TEST_PASSWORD });

  // Configuration is read when the module initialises, i.e. after the environment above is set.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error', 'warn'] });
  configureApp(app);
  await app.init();
  const http = app.getHttpServer() as Server;

  return {
    app,
    http,
    prisma,
    erpStore,
    orchestrator,
    orchestratorUrl: orchestratorServer.url,
    documentIntelligence,
    async login(email, password = TEST_PASSWORD) {
      const agent = request.agent(http);
      const response = await agent.post(`${API}/auth/login`).send({ email, password });
      if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
      return agent;
    },
    async setScenario(mode, count = 1) {
      await request(orchestratorServer.url).post('/__mock/scenarios').set('X-Mock-Admin-Token', MOCK_ADMIN).send({ mode, count }).expect(201);
    },
    async close() {
      await app.close();
      orchestrator.close();
      await prisma.$disconnect();
      await Promise.all(
        [erp.server, orchestratorServer.server, diServer.server].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
        ),
      );
      erpStore.close();
      rmSync(uploadDir, { recursive: true, force: true });
    },
  };
}

/** Polls until the predicate holds (or fails with the last observed value). */
export async function waitFor<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 20_000, intervalMs = 100 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await probe();
  while (!predicate(last)) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out; last value: ${JSON.stringify(last).slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await probe();
  }
  return last;
}

export function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export interface FlowOptions {
  title?: string;
  unitPrice?: number;
  quantity?: number;
}

/**
 * Drives a request through create -> upload -> submit -> extraction -> verify.
 * Returns the request id once it is PENDING_APPROVAL.
 */
export async function createVerifiedRequest(harness: Harness, requester: request.Agent, options: FlowOptions = {}) {
  const unitPrice = options.unitPrice ?? 750_000;
  const quantity = options.quantity ?? 2;
  harness.documentIntelligence.next = sampleExtraction({ unitPrice, quantity });
  const created = await requester
    .post(`${API}/purchase-requests`)
    .send({ title: options.title ?? 'Ergonomic equipment', description: 'Integration test' })
    .expect(201);
  const id = created.body.id as string;
  await requester.post(`${API}/purchase-requests/${id}/documents`).attach('file', MINIMAL_PDF, 'invoice.pdf').expect(201);
  await requester.post(`${API}/purchase-requests/${id}/submit`).expect(200);
  const ready = await waitFor(
    async () => (await requester.get(`${API}/purchase-requests/${id}`)).body,
    (body) => body.status === 'NEEDS_VERIFICATION',
  );
  const document = ready.documents[0];
  const suppliers = await requester.get(`${API}/suppliers`).query({ search: 'Sinar' }).expect(200);
  const tax = Math.round(quantity * unitPrice * 0.11);
  const verified = await requester
    .patch(`${API}/documents/${document.id}/verify`)
    .send({
      supplierId: suppliers.body[0].id,
      supplierName: 'PT Sinar Jaya Abadi',
      documentNumber: document.extraction.fields.documentNumber.value,
      documentDate: '2026-11-10',
      currency: 'IDR',
      requiredDate: futureDate(30),
      taxAmount: tax,
      items: [{ description: 'Laptop stand aluminium', quantity, unitPrice }],
      acknowledgedFields: document.lowConfidenceFields,
    })
    .expect(200);
  return { id, verification: verified.body, documentId: document.id as string };
}
