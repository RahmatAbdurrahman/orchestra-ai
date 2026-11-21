/**
 * Contract test: the real UiPath adapter (@orchestra/uipath-client is not
 * imported here to keep the mock independent) is exercised in the API
 * integration tests. This suite checks the mock's own behaviour, including
 * the mock robot driving a real ERP simulation instance over HTTP.
 */
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import request from 'supertest';
import { createErpApp } from '@orchestra/erp-simulation/dist/app';
import { PurchaseOrderStore } from '@orchestra/erp-simulation/dist/store';
import { createOrchestratorMock } from './app';
import { ErpUiRobot } from './robot';

const FOLDER = '7';

async function startErp() {
  const store = new PurchaseOrderStore(':memory:');
  const { app } = createErpApp({ store, username: 'robot', password: 'pw-123456', apiToken: 't', simAdminToken: 's' });
  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { store, server, url };
}

function payload(idempotencyKey: string) {
  return {
    in_IdempotencyKey: idempotencyKey,
    in_PurchaseOrderJson: JSON.stringify({
      requestNumber: 'PR-2026-000001',
      supplierCode: 'SUP-001',
      supplierName: 'PT Sinar Jaya Abadi',
      currency: 'IDR',
      requiredDate: '2026-12-31',
      documentNumber: 'INV-1',
      taxAmount: 0,
      items: [{ description: 'Laptop stand', quantity: 2, unitPrice: 750000 }],
    }),
  };
}

describe('mock robot against the ERP simulation', () => {
  let erp: Awaited<ReturnType<typeof startErp>>;
  beforeAll(async () => {
    erp = await startErp();
  });
  afterAll(() => {
    erp.server.close();
  });

  it('creates a purchase order through the web UI and is idempotent', async () => {
    const robot = new ErpUiRobot(erp.url, 'robot', 'pw-123456');
    const first = await robot.createPurchaseOrder(payload('oa-po-a'));
    const second = await robot.createPurchaseOrder(payload('oa-po-a'));
    expect(first).toMatchObject({ out_Status: 'CREATED', out_IdempotencyKey: 'oa-po-a' });
    expect(first.out_PoNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(second).toMatchObject({ out_Status: 'ALREADY_EXISTS', out_PoNumber: first.out_PoNumber });
    expect(erp.store.list({ integrationKey: 'oa-po-a' })).toHaveLength(1);
  });

  it('reports ERP business errors as BUSINESS_ERROR output', async () => {
    const robot = new ErpUiRobot(erp.url, 'robot', 'pw-123456');
    const input = payload('oa-po-b');
    const parsed = JSON.parse(input.in_PurchaseOrderJson);
    parsed.supplierCode = 'SUP-006';
    const result = await robot.createPurchaseOrder({ ...input, in_PurchaseOrderJson: JSON.stringify(parsed) });
    expect(result.out_Status).toBe('BUSINESS_ERROR');
    expect(result.out_Message).toContain('blocked');
  });
});

describe('Orchestrator mock API', () => {
  const robot = { createPurchaseOrder: jest.fn() };
  const mock = createOrchestratorMock({
    clientId: 'id',
    clientSecret: 'secret',
    folderId: FOLDER,
    processes: ['PurchaseOrderAutomation'],
    adminToken: 'admin',
    robot,
    pendingMs: 10,
    runMs: 10,
    submitTimeoutDelayMs: 50,
  });
  afterAll(() => mock.close());

  async function token() {
    const response = await request(mock.app)
      .post('/identity_/connect/token')
      .type('form')
      .send({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'secret' });
    return response.body.access_token as string;
  }

  it('rejects bad client credentials and wrong folders', async () => {
    const bad = await request(mock.app)
      .post('/identity_/connect/token')
      .type('form')
      .send({ grant_type: 'client_credentials', client_id: 'id', client_secret: 'nope' });
    expect(bad.status).toBe(400);
    const access = await token();
    const wrongFolder = await request(mock.app).get('/odata/Releases').set('Authorization', `Bearer ${access}`).set('X-UIPATH-OrganizationUnitId', '999');
    expect(wrongFolder.status).toBe(403);
  });

  it('runs a job to completion and finds it by reference', async () => {
    robot.createPurchaseOrder.mockResolvedValueOnce({
      out_Status: 'CREATED',
      out_PoNumber: 'PO-2026-000009',
      out_IdempotencyKey: 'k',
      out_ErpReference: 'PO-2026-000009',
      out_Message: 'ok',
      out_ScreenshotPath: null,
    });
    const access = await token();
    const auth = { Authorization: `Bearer ${access}`, 'X-UIPATH-OrganizationUnitId': FOLDER };
    const releases = await request(mock.app).get(`/odata/Releases?$filter=${encodeURIComponent("Name eq 'PurchaseOrderAutomation'")}`).set(auth);
    const started = await request(mock.app)
      .post('/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs')
      .set(auth)
      .send({ startInfo: { ReleaseKey: releases.body.value[0].Key, Strategy: 'ModernJobsCount', JobsCount: 1, InputArguments: '{}', Reference: 'ref-1' } });
    expect(started.status).toBe(201);
    const id = started.body.value[0].Id;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const job = await request(mock.app).get(`/odata/Jobs(${id})`).set(auth);
    expect(job.body.State).toBe('Successful');
    expect(JSON.parse(job.body.OutputArguments).out_PoNumber).toBe('PO-2026-000009');
    const byReference = await request(mock.app).get(`/odata/Jobs?$filter=${encodeURIComponent("Reference eq 'ref-1'")}`).set(auth);
    expect(byReference.body.value).toHaveLength(1);
  });

  it('keeps jobs pending when no robot is available and supports stopping them', async () => {
    const access = await token();
    const auth = { Authorization: `Bearer ${access}`, 'X-UIPATH-OrganizationUnitId': FOLDER };
    await request(mock.app).post('/__mock/scenarios').set('X-Mock-Admin-Token', 'admin').send({ mode: 'robot-unavailable' });
    const releases = await request(mock.app).get('/odata/Releases').set(auth);
    const started = await request(mock.app)
      .post('/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs')
      .set(auth)
      .send({ startInfo: { ReleaseKey: releases.body.value[0].Key, InputArguments: '{}', Reference: 'ref-2' } });
    const id = started.body.value[0].Id;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((await request(mock.app).get(`/odata/Jobs(${id})`).set(auth)).body.State).toBe('Pending');
    await request(mock.app).post('/odata/Jobs/UiPath.Server.Configuration.OData.StopJobs').set(auth).send({ jobIds: [id], strategy: 'SoftStop' });
    expect((await request(mock.app).get(`/odata/Jobs(${id})`).set(auth)).body.State).toBe('Stopped');
  });
});
