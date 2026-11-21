#!/usr/bin/env node
/**
 * Creates synthetic demo purchase requests by driving the real Orchestra API, exactly as the web UI
 * would: create -> upload a sample invoice -> document intelligence -> verification -> approvals.
 * Nothing is written to the database directly, so every business rule, approval threshold, audit
 * event and notification is genuine. Requests that get fully approved start a REAL UiPath job
 * (whatever UIPATH_MODE the target API uses); no robot result is ever fabricated.
 *
 * Usage:
 *   node scripts/demo-data.mjs --base-url http://localhost:3000            # local web (proxies the API)
 *   node scripts/demo-data.mjs --base-url https://<your-app>.vercel.app    # hosted simulation
 *   options: --robot <n>  number of requests to approve fully so UiPath creates the PO (default 1, 0 = none)
 *
 * Requires DEMO_LOGIN_ENABLED=true on the target API (one-click sign-in, no passwords).
 * Every request title starts with "[DEMO]" so demo data is easy to recognise.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = path.join(ROOT, 'samples', 'invoices');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const BASE = option('base-url', 'http://localhost:3000').replace(/\/+$/, '');
const ROBOT_RUNS = Number(option('robot', '1'));
const API = `${BASE}/api/v1`;
const RUN = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const EMAIL = {
  rina: 'requester@orchestra.local', // Operations
  dimas: 'requester.it@orchestra.local', // Information Technology
  budi: 'approver.ops@orchestra.local',
  joko: 'approver.it@orchestra.local',
  sari: 'approver.finance@orchestra.local',
};

// ------------------------------------------------------------------ HTTP helpers
class Session {
  constructor(email) {
    this.email = email;
    this.cookie = '';
  }

  async request(method, url, body) {
    const headers = { accept: 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${API}${url}`, { method, headers, body: payload, redirect: 'manual' });
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (cookies.length) this.cookie = cookies.map((cookie) => cookie.split(';')[0]).join('; ');
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.error?.message ?? data?.message ?? text;
      throw new Error(`${method} ${url} -> ${response.status}: ${Array.isArray(message) ? message.join('; ') : message}`);
    }
    return data;
  }

  get(url) {
    return this.request('GET', url);
  }
  post(url, body) {
    return this.request('POST', url, body ?? {});
  }
  patch(url, body) {
    return this.request('PATCH', url, body);
  }
}

const sessions = new Map();
async function as(who) {
  if (!sessions.has(who)) {
    const session = new Session(EMAIL[who]);
    await session.post('/auth/demo-login', { email: EMAIL[who] });
    sessions.set(who, session);
  }
  return sessions.get(who);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ Workflow steps
async function createRequest(who, title, description) {
  const session = await as(who);
  return session.post('/purchase-requests', { title: `[DEMO] ${title}`, description });
}

async function uploadAndSubmit(who, request, invoice) {
  const session = await as(who);
  const file = await readFile(path.join(SAMPLES, invoice));
  const type = invoice.endsWith('.png') ? 'image/png' : 'application/pdf';
  const form = new FormData();
  form.append('file', new Blob([file], { type }), invoice);
  await session.request('POST', `/purchase-requests/${request.id}/documents`, form);
  await session.post(`/purchase-requests/${request.id}/submit`);
}

async function waitForStatus(who, request, statuses, timeoutMs = 180_000) {
  const session = await as(who);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const detail = await session.get(`/purchase-requests/${request.id}`);
    if (statuses.includes(detail.status)) return detail;
    if (Date.now() > deadline) throw new Error(`${request.requestNumber} stuck in ${detail.status} (waiting for ${statuses.join('/')})`);
    await sleep(3000);
  }
}

const normalise = (value) => value.toUpperCase().replace(/\b(PT|CV|TBK|LTD)\b/g, '').replace(/[^A-Z0-9]/g, '');

/** Verifies the extracted data the way a careful requester would: confirms low-confidence fields. */
async function verify(who, request, index, requiredInDays = 14) {
  const session = await as(who);
  const detail = await waitForStatus(who, request, ['NEEDS_VERIFICATION']);
  const document = detail.documents[0];
  const fields = document.extraction?.fields ?? {};
  const suppliers = await session.get('/suppliers');
  const extractedSupplier = fields.supplierName?.value ?? '';
  const match = suppliers.find((supplier) => {
    const a = normalise(supplier.name);
    const b = normalise(extractedSupplier);
    return a && b && (a.includes(b) || b.includes(a));
  });
  const items = (document.extraction?.items ?? [])
    .map((item) => ({
      description: item.description?.value ?? 'Item',
      quantity: Math.max(1, Math.round(item.quantity?.value ?? 1)),
      unitPrice: item.unitPrice?.value ?? 0,
    }))
    .filter((item) => item.description);
  const required = new Date(Date.now() + requiredInDays * 86_400_000).toISOString().slice(0, 10);
  const result = await session.patch(`/documents/${document.id}/verify`, {
    supplierId: match?.id,
    supplierName: match?.name ?? (extractedSupplier || 'Unknown supplier'),
    // Sample invoices are reused; a unique number keeps the duplicate-invoice rule meaningful.
    documentNumber: `DEMO-${RUN}-${index}`,
    documentDate: fields.documentDate?.value ?? undefined,
    currency: fields.currency?.value ?? 'IDR',
    requiredDate: required,
    taxAmount: fields.taxAmount?.value ?? 0,
    items: items.length ? items : [{ description: 'Item', quantity: 1, unitPrice: 0 }],
    acknowledgedFields: document.lowConfidenceFields ?? [],
  });
  return result.outcome;
}

async function pendingApprovalFor(who, request) {
  const session = await as(who);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pending = await session.get('/approvals/pending');
    const approval = pending.find((entry) => entry.purchaseRequest.id === request.id);
    if (approval) return approval;
    await sleep(1500);
  }
  throw new Error(`${request.requestNumber}: no pending approval for ${EMAIL[who]}`);
}

async function approve(who, request, comments) {
  const approval = await pendingApprovalFor(who, request);
  return (await as(who)).post(`/approvals/${approval.id}/approve`, { comments });
}

async function reject(who, request, reason) {
  const approval = await pendingApprovalFor(who, request);
  return (await as(who)).post(`/approvals/${approval.id}/reject`, { reason });
}

// ------------------------------------------------------------------ Scenarios
const created = [];
async function scenario(label, run) {
  process.stdout.write(`- ${label} ... `);
  try {
    const result = await run();
    console.log(result);
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
  }
}

async function main() {
  console.log(`Orchestra demo data -> ${BASE} (run ${RUN}, ${ROBOT_RUNS} robot run(s))`);
  const health = await fetch(`${API}/health`).then((response) => response.json());
  console.log(`API health: database ${health.checks?.database}, document intelligence ${health.checks?.documentIntelligence}`);

  await scenario('Draft (not submitted yet)', async () => {
    const request = await createRequest('rina', 'Ergonomic chairs for the warehouse office', 'Replacement of six worn-out chairs in the warehouse office.');
    created.push(request);
    return `${request.requestNumber} DRAFT`;
  });

  await scenario('Cancelled by the requester', async () => {
    const request = await createRequest('dimas', 'Spare keyboards (duplicate entry)', 'Created twice by mistake.');
    await (await as('dimas')).post(`/purchase-requests/${request.id}/cancel`, { reason: 'Duplicate of another request' });
    created.push(request);
    return `${request.requestNumber} CANCELLED`;
  });

  await scenario('Scanned invoice waiting for verification', async () => {
    const request = await createRequest('dimas', 'Network cabling for meeting rooms', 'Scanned quotation from CV Maju Bersama.');
    await uploadAndSubmit('dimas', request, 'invoice-maju-bersama-scan.png');
    const detail = await waitForStatus('dimas', request, ['NEEDS_VERIFICATION', 'FAILED']);
    created.push(request);
    return `${request.requestNumber} ${detail.status}`;
  });

  await scenario('Blocked by business rules (inactive supplier)', async () => {
    const request = await createRequest('rina', 'Packing materials from former supplier', 'Quotation from a supplier that is no longer active.');
    await uploadAndSubmit('rina', request, 'invoice-mitra-lama-blocked-supplier.pdf');
    const outcome = await verify('rina', request, 1);
    created.push(request);
    return `${request.requestNumber} ${outcome}`;
  });

  await scenario('Waiting for department approval', async () => {
    const request = await createRequest('rina', 'Laptop stands for the operations team', 'Ergonomics programme, phase 2.');
    await uploadAndSubmit('rina', request, 'invoice-sinar-jaya-idr.pdf');
    const outcome = await verify('rina', request, 2);
    created.push(request);
    return `${request.requestNumber} ${outcome}`;
  });

  await scenario('Department approved, waiting for finance', async () => {
    const request = await createRequest('dimas', 'Developer workstations', 'Workstations for two new engineers.');
    await uploadAndSubmit('dimas', request, 'invoice-teknologi-nusantara-idr.pdf');
    const outcome = await verify('dimas', request, 3);
    if (outcome !== 'PENDING_APPROVAL') return `${request.requestNumber} ${outcome}`;
    await approve('joko', request, 'Budget confirmed for Q4 hiring.');
    created.push(request);
    return `${request.requestNumber} level 1 approved, waiting for finance`;
  });

  await scenario('Rejected by the approver', async () => {
    const request = await createRequest('rina', 'Imported office supplies (USD)', 'Bulk office supplies from an overseas vendor.');
    await uploadAndSubmit('rina', request, 'invoice-global-office-usd.pdf');
    const outcome = await verify('rina', request, 4);
    if (outcome !== 'PENDING_APPROVAL') return `${request.requestNumber} ${outcome}`;
    await reject('budi', request, 'Please source locally; a registered local supplier offers the same items.');
    created.push(request);
    return `${request.requestNumber} REJECTED`;
  });

  for (let run = 1; run <= ROBOT_RUNS; run += 1) {
    await scenario(`Fully approved -> real UiPath job (${run}/${ROBOT_RUNS})`, async () => {
      const request = await createRequest('rina', `Printer paper and toner, batch ${run}`, 'Monthly consumables for the operations floor.');
      await uploadAndSubmit('rina', request, 'invoice-sinar-jaya-idr.pdf');
      const outcome = await verify('rina', request, 10 + run);
      if (outcome !== 'PENDING_APPROVAL') return `${request.requestNumber} ${outcome}`;
      await approve('budi', request, 'Approved: routine consumables.');
      created.push(request);
      const detail = await waitForStatus('rina', request, ['APPROVED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'], 60_000);
      return `${request.requestNumber} approved, automation ${detail.status} (the robot result is reported by UiPath)`;
    });
  }

  console.log(`Done: ${created.length} demo request(s) created.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
