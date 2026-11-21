/**
 * Purchase Request -> Purchase Order flow through the real API and database.
 * UiPath Orchestrator is the in-process MOCK (see test/support/harness.ts).
 */
import { API, createVerifiedRequest, MINIMAL_PDF, startHarness, waitFor, type Harness } from './support/harness';

describe('Purchase request to purchase order (mocked UiPath)', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('runs the complete flow: extraction, verification, approval, robot, PO', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const approver = await harness.login('approver.ops@orchestra.local');

    const created = await requester.post(`${API}/purchase-requests`).send({ title: 'Laptop stands for operations' }).expect(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.requestNumber).toMatch(/^PR-\d{4}-\d{6}$/);
    expect(created.body.allowedActions).toMatchObject({ edit: true, submit: true, uploadDocument: true });

    // Submitting without the required document is refused.
    const refused = await requester.post(`${API}/purchase-requests/${id}/submit`).expect(422);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');

    // Upload validation: the real content type is checked, not the file name.
    await requester
      .post(`${API}/purchase-requests/${id}/documents`)
      .attach('file', Buffer.from('<html><script>alert(1)</script></html>'), 'invoice.pdf')
      .expect(422);
    await requester.post(`${API}/purchase-requests/${id}/documents`).attach('file', MINIMAL_PDF, 'invoice.pdf').expect(201);

    await requester.post(`${API}/purchase-requests/${id}/submit`).expect(200);
    const ready = await waitFor(
      async () => (await requester.get(`${API}/purchase-requests/${id}`)).body,
      (body) => body.status === 'NEEDS_VERIFICATION',
    );
    const document = ready.documents[0];
    expect(document.processingStatus).toBe('COMPLETED');
    expect(document.extraction.fields.supplierName.value).toBe('PT Sinar Jaya Abadi');
    expect(document.lowConfidenceFields).toContain('taxAmount');

    const supplier = (await requester.get(`${API}/suppliers`).query({ search: 'Sinar' }).expect(200)).body[0];
    const verification = {
      supplierId: supplier.id,
      supplierName: supplier.name,
      documentNumber: document.extraction.fields.documentNumber.value,
      documentDate: '2026-11-10',
      currency: 'IDR',
      requiredDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      taxAmount: 165_000,
      items: [{ description: 'Laptop stand aluminium', quantity: 2, unitPrice: 750_000 }],
    };

    // Low-confidence fields must be explicitly confirmed by the human.
    const unacknowledged = await requester
      .patch(`${API}/documents/${document.id}/verify`)
      .send({ ...verification, acknowledgedFields: [] })
      .expect(422);
    expect(unacknowledged.body.error.details.missingAcknowledgements).toContain('taxAmount');

    const verified = await requester
      .patch(`${API}/documents/${document.id}/verify`)
      .send({ ...verification, acknowledgedFields: document.lowConfidenceFields })
      .expect(200);
    expect(verified.body.outcome).toBe('PENDING_APPROVAL');
    expect(verified.body.ruleEvaluation.approvalRoute).toEqual(['DEPARTMENT']);
    expect(verified.body.purchaseRequest.totalAmount).toBe(1_665_000);

    // The approver sees the request in the pending list and approves it.
    const pending = await approver.get(`${API}/approvals/pending`).expect(200);
    const approval = pending.body.find((row: { purchaseRequest: { id: string } }) => row.purchaseRequest.id === id);
    expect(approval).toBeDefined();
    const decision = await approver.post(`${API}/approvals/${approval.id}/approve`).send({ comments: 'OK' }).expect(200);
    expect(decision.body.outcome).toBe('APPROVED');
    expect(decision.body.automationJobId).toEqual(expect.any(String));

    const completed = await waitFor(
      async () => (await requester.get(`${API}/purchase-requests/${id}`)).body,
      (body) => body.status === 'COMPLETED' || body.status === 'FAILED',
    );
    expect(completed.status).toBe('COMPLETED');
    expect(completed.poNumber).toMatch(/^PO-\d{4}-\d{6}$/);
    expect(completed.automationJob.status).toBe('COMPLETED');

    // Exactly one purchase order exists in the ERP for the idempotency key.
    const orders = harness.erpStore.list({ integrationKey: completed.automationJob.idempotencyKey });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ poNumber: completed.poNumber, totalAmount: 1_665_000, externalReference: completed.requestNumber });

    // Every transition is in the audit timeline, in order.
    const timeline = await requester.get(`${API}/purchase-requests/${id}/timeline`).expect(200);
    const transitions = timeline.body
      .filter((event: { action: string }) => event.action === 'PURCHASE_REQUEST.STATUS_CHANGED')
      .map((event: { oldValue: { status: string }; newValue: { status: string } }) => `${event.oldValue.status}>${event.newValue.status}`);
    expect(transitions).toEqual([
      'DRAFT>SUBMITTED',
      'SUBMITTED>PROCESSING_DOCUMENT',
      'PROCESSING_DOCUMENT>NEEDS_VERIFICATION',
      'NEEDS_VERIFICATION>PENDING_APPROVAL',
      'PENDING_APPROVAL>APPROVED',
      'APPROVED>QUEUED',
      'QUEUED>RUNNING',
      'RUNNING>COMPLETED',
    ]);
    const actions = timeline.body.map((event: { action: string }) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'PURCHASE_REQUEST.CREATED',
        'DOCUMENT.UPLOADED',
        'DOCUMENT.PROCESSED',
        'DOCUMENT.VERIFIED',
        'APPROVAL.REQUESTED',
        'APPROVAL.APPROVED',
        'AUTOMATION.JOB_CREATED',
        'AUTOMATION.JOB_SUBMITTED',
        'AUTOMATION.JOB_COMPLETED',
      ]),
    );

    const notifications = await requester.get(`${API}/notifications`).expect(200);
    const types = notifications.body.data.map((notification: { type: string }) => notification.type);
    expect(types).toEqual(expect.arrayContaining(['DOCUMENT_PROCESSED', 'REQUEST_APPROVED', 'AUTOMATION_COMPLETED']));
  });

  it('routes requests above 5,000,000 to department and finance approvers, in order', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const opsApprover = await harness.login('approver.ops@orchestra.local');
    const financeApprover = await harness.login('approver.finance@orchestra.local');
    const itApprover = await harness.login('approver.it@orchestra.local');

    const { id, verification } = await createVerifiedRequest(harness, requester, { unitPrice: 3_000_000, quantity: 2 });
    expect(verification.ruleEvaluation.approvalRoute).toEqual(['DEPARTMENT', 'FINANCE']);

    const detail = (await requester.get(`${API}/purchase-requests/${id}`).expect(200)).body;
    const [level1, level2] = detail.approvals;
    expect(level2.activatedAt).toBeNull();

    // Finance cannot jump the queue; another department's approver is not eligible.
    await financeApprover.post(`${API}/approvals/${level2.id}/approve`).send({}).expect(409);
    await itApprover.post(`${API}/approvals/${level1.id}/approve`).send({}).expect(403);
    // Requesters cannot approve at all.
    await requester.post(`${API}/approvals/${level1.id}/approve`).send({}).expect(403);

    const first = await opsApprover.post(`${API}/approvals/${level1.id}/approve`).send({ comments: 'Department OK' }).expect(200);
    expect(first.body).toEqual({ outcome: 'NEXT_LEVEL', nextLevel: 2 });
    // The department approver is not in the finance group.
    await opsApprover.post(`${API}/approvals/${level2.id}/approve`).send({}).expect(403);
    // Double decisions are rejected.
    await opsApprover.post(`${API}/approvals/${level1.id}/approve`).send({}).expect(409);

    const second = await financeApprover.post(`${API}/approvals/${level2.id}/approve`).send({ comments: 'Finance OK' }).expect(200);
    expect(second.body.outcome).toBe('APPROVED');

    const done = await waitFor(
      async () => (await requester.get(`${API}/purchase-requests/${id}`)).body,
      (body) => body.status === 'COMPLETED' || body.status === 'FAILED',
    );
    expect(done.status).toBe('COMPLETED');
    expect(done.approvals.map((approval: { decision: string }) => approval.decision)).toEqual(['APPROVED', 'APPROVED']);
  });

  it('stops rejected requests: no automation job, no execution', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const approver = await harness.login('approver.ops@orchestra.local');
    const operator = await harness.login('operator@orchestra.local');
    const { id } = await createVerifiedRequest(harness, requester);
    const detail = (await requester.get(`${API}/purchase-requests/${id}`).expect(200)).body;

    await approver.post(`${API}/approvals/${detail.approvals[0].id}/reject`).send({}).expect(400);
    await approver.post(`${API}/approvals/${detail.approvals[0].id}/reject`).send({ reason: 'Not in this quarter budget' }).expect(200);

    const rejected = (await requester.get(`${API}/purchase-requests/${id}`).expect(200)).body;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.statusReason).toBe('Not in this quarter budget');
    expect(rejected.automationJob).toBeNull();
    const dispatch = await operator.post(`${API}/automation/jobs`).send({ purchaseRequestId: id }).expect(409);
    expect(dispatch.body.error.code).toBe('PRECONDITION_FAILED');
    await requester.post(`${API}/purchase-requests/${id}/cancel`).send({ reason: 'too late' }).expect(409);
  });

  it('blocks duplicate supplier invoices with a business rule', async () => {
    const requester = await harness.login('requester@orchestra.local');
    const first = await createVerifiedRequest(harness, requester);
    expect(first.verification.outcome).toBe('PENDING_APPROVAL');
    const invoiceNumber = first.verification.purchaseRequest.documentNumber as string;

    // Second request re-uses the same supplier invoice number.
    harness.documentIntelligence.next = {
      ...(harness.documentIntelligence.next as object),
    };
    const created = await requester.post(`${API}/purchase-requests`).send({ title: 'Duplicate invoice' }).expect(201);
    await requester.post(`${API}/purchase-requests/${created.body.id}/documents`).attach('file', MINIMAL_PDF, 'invoice.pdf').expect(201);
    await requester.post(`${API}/purchase-requests/${created.body.id}/submit`).expect(200);
    const ready = await waitFor(
      async () => (await requester.get(`${API}/purchase-requests/${created.body.id}`)).body,
      (body) => body.status === 'NEEDS_VERIFICATION',
    );
    const supplier = (await requester.get(`${API}/suppliers`).query({ search: 'Sinar' })).body[0];
    const result = await requester
      .patch(`${API}/documents/${ready.documents[0].id}/verify`)
      .send({
        supplierId: supplier.id,
        supplierName: supplier.name,
        documentNumber: invoiceNumber,
        currency: 'IDR',
        requiredDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
        taxAmount: 0,
        items: [{ description: 'Something else', quantity: 1, unitPrice: 100_000 }],
        acknowledgedFields: ready.documents[0].lowConfidenceFields,
      })
      .expect(200);
    expect(result.body.outcome).toBe('BLOCKED_BY_RULES');
    expect(result.body.ruleEvaluation.findings.map((finding: { ruleId: string }) => finding.ruleId)).toContain(
      'REQ-DUPLICATE-DOCUMENT',
    );
    expect(result.body.purchaseRequest.status).toBe('NEEDS_VERIFICATION');
  });
});
