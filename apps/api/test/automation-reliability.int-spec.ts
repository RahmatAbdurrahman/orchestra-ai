/**
 * Failure handling, retries, idempotency and restart recovery.
 * UiPath Orchestrator is the in-process MOCK with injected failure scenarios;
 * these tests verify Orchestra's behaviour, not a real UiPath robot.
 */
import { InlineJobQueue, Reconciler, silentLogger, type JobQueue } from '@orchestra/core';
import { buildAttemptReference, DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION } from '@orchestra/domain';
import { loadUiPathConfigFromEnv, UiPathOrchestratorClient } from '@orchestra/uipath-client';
import type request from 'supertest';
import { JOB_QUEUE } from '../src/infrastructure/tokens';
import { API, createVerifiedRequest, startHarness, waitFor, type Harness } from './support/harness';

describe('Automation reliability (mocked UiPath)', () => {
  let harness: Harness;
  let requester: request.Agent;
  let approver: request.Agent;
  let operator: request.Agent;

  beforeAll(async () => {
    harness = await startHarness();
    requester = await harness.login('requester@orchestra.local');
    approver = await harness.login('approver.ops@orchestra.local');
    operator = await harness.login('operator@orchestra.local');
  });

  afterAll(async () => {
    await harness?.close();
  });

  async function approveNewRequest(title: string) {
    const { id } = await createVerifiedRequest(harness, requester, { title });
    const detail = (await requester.get(`${API}/purchase-requests/${id}`).expect(200)).body;
    const decision = await approver.post(`${API}/approvals/${detail.approvals[0].id}/approve`).send({}).expect(200);
    return { id, jobId: decision.body.automationJobId as string };
  }

  async function waitForJob(jobId: string, statuses: string[]) {
    return waitFor(
      async () => (await operator.get(`${API}/automation/jobs/${jobId}`)).body,
      (body) => statuses.includes(body.status),
    );
  }

  it('retries a job that failed after the ERP accepted the order without creating a duplicate PO', async () => {
    await harness.setScenario('fault-after-erp');
    const { id, jobId } = await approveNewRequest('Robot crashes after submit');

    const failed = await waitForJob(jobId, ['FAILED', 'COMPLETED']);
    expect(failed.status).toBe('FAILED');
    expect(failed.errorCode).toBe('SYSTEM_EXCEPTION');
    expect(failed.attemptCount).toBe(1);
    expect(failed.canRetry).toBe(true);
    expect((await requester.get(`${API}/purchase-requests/${id}`)).body.status).toBe('FAILED');

    // The robot did create the order before crashing.
    const idempotencyKey = failed.idempotencyKey as string;
    expect(harness.erpStore.list({ integrationKey: idempotencyKey })).toHaveLength(1);
    const firstPo = harness.erpStore.list({ integrationKey: idempotencyKey })[0]!.poNumber;

    // Only operators may retry.
    await requester.post(`${API}/automation/jobs/${jobId}/retry`).send({}).expect(403);
    await approver.post(`${API}/automation/jobs/${jobId}/retry`).send({}).expect(403);

    await operator.post(`${API}/automation/jobs/${jobId}/retry`).send({ reason: 'Robot restarted' }).expect(200);
    const completed = await waitForJob(jobId, ['COMPLETED', 'FAILED']);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.attemptCount).toBe(2);
    expect(completed.poNumber).toBe(firstPo);
    expect(completed.attempts.map((attempt: { triggeredBy: string; status: string }) => `${attempt.triggeredBy}:${attempt.status}`)).toEqual([
      'SYSTEM:FAULTED',
      'USER:SUCCESSFUL',
    ]);

    // Still exactly one purchase order: the ERP recognised the idempotency key.
    expect(harness.erpStore.list({ integrationKey: idempotencyKey })).toHaveLength(1);
    const logs = (await operator.get(`${API}/automation/jobs/${jobId}/logs`).expect(200)).body;
    expect(logs.map((log: { message: string }) => log.message).join('\n')).toContain('no duplicate was created');

    // A completed job cannot be retried.
    const again = await operator.post(`${API}/automation/jobs/${jobId}/retry`).send({}).expect(409);
    expect(again.body.error.code).toBe('PRECONDITION_FAILED');
  });

  it('does not resubmit when StartJobs times out but the job was created (reference lookup)', async () => {
    await harness.setScenario('submit-timeout');
    const { jobId } = await approveNewRequest('StartJobs response lost');
    const done = await waitForJob(jobId, ['COMPLETED', 'FAILED']);
    expect(done.status).toBe('COMPLETED');
    expect(done.attemptCount).toBe(1);
    const reference = buildAttemptReference(jobId, 1);
    const mockJobs = [...harness.orchestrator.jobs.values()].filter((job) => job.Reference === reference);
    expect(mockJobs).toHaveLength(1);
    const logs = (await operator.get(`${API}/automation/jobs/${jobId}/logs`).expect(200)).body;
    expect(logs.map((log: { eventType: string }) => log.eventType)).toContain('SUBMISSION_RECOVERED');
  });

  it('automatically retries a submission that failed before the robot started', async () => {
    await harness.setScenario('submit-error');
    const { jobId } = await approveNewRequest('Orchestrator 500 on submit');
    const done = await waitForJob(jobId, ['COMPLETED', 'FAILED']);
    expect(done.status).toBe('COMPLETED');
    expect(done.attemptCount).toBe(2);
    expect(done.attempts.map((attempt: { status: string }) => attempt.status)).toEqual(['SUBMIT_FAILED', 'SUCCESSFUL']);
    expect(done.attempts[0].errorCode).toBe('SERVER');
  });

  it('marks business exceptions as failed without automatic retries', async () => {
    await harness.setScenario('business-error');
    const { id, jobId } = await approveNewRequest('Vendor on hold');
    const failed = await waitForJob(jobId, ['FAILED', 'COMPLETED']);
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'BUSINESS_EXCEPTION', attemptCount: 1, requiresIntervention: false });
    const notifications = (await operator.get(`${API}/notifications`).expect(200)).body.data;
    expect(notifications.some((notification: { type: string; link: string }) => notification.type === 'AUTOMATION_FAILED' && notification.link === `/automation/${jobId}`)).toBe(true);

    // The operator abandons the job; the request is cancelled.
    await operator.post(`${API}/automation/jobs/${jobId}/cancel`).send({ reason: 'Vendor blocked; handled manually' }).expect(200);
    expect((await requester.get(`${API}/purchase-requests/${id}`)).body.status).toBe('CANCELLED');
  });

  it('enforces the retry limit and then requires manual intervention', async () => {
    const admin = await harness.login('admin@orchestra.local');
    const workflows = (await admin.get(`${API}/workflows`).expect(200)).body;
    const workflow = workflows[0];
    const configuration = {
      ...DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
      automation: { ...DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION.automation, maxAutoAttempts: 1, maxTotalAttempts: 2 },
    };
    const updated = await admin
      .patch(`${API}/workflows/${workflow.id}`)
      .send({ configuration, changeNote: 'Tighter retry budget for test' })
      .expect(200);
    expect(updated.body.version).toBe(workflow.version + 1);

    await harness.setScenario('fault', 2);
    const { id, jobId } = await approveNewRequest('Always failing robot');
    const firstFailure = await waitForJob(jobId, ['FAILED']);
    expect(firstFailure).toMatchObject({ attemptCount: 1, maxTotalAttempts: 2, requiresIntervention: false });

    await operator.post(`${API}/automation/jobs/${jobId}/retry`).send({}).expect(200);
    const secondFailure = await waitFor(
      async () => (await operator.get(`${API}/automation/jobs/${jobId}`)).body,
      (body) => body.status === 'FAILED' && body.attemptCount === 2,
    );
    expect(secondFailure.requiresIntervention).toBe(true);
    expect(secondFailure.canRetry).toBe(false);

    const refused = await operator.post(`${API}/automation/jobs/${jobId}/retry`).send({}).expect(409);
    expect(refused.body.error.code).toBe('RETRY_LIMIT_REACHED');
    expect((await requester.get(`${API}/purchase-requests/${id}`)).body.status).toBe('FAILED');

    // Restore the default configuration for the next tests.
    await admin
      .patch(`${API}/workflows/${workflow.id}`)
      .send({ configuration: DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION, changeNote: 'Restore defaults' })
      .expect(200);
  });

  it('recovers after a worker crash: lost queue message and interrupted submission', async () => {
    const queue = harness.app.get<JobQueue>(JOB_QUEUE) as InlineJobQueue;
    const original = queue.enqueueAutomationSubmit.bind(queue);
    // Simulate a crash right after the approval committed: the submit message is lost.
    queue.enqueueAutomationSubmit = async () => undefined;
    const lost = await approveNewRequest('Lost message');
    const interrupted = await approveNewRequest('Interrupted submission');
    queue.enqueueAutomationSubmit = original;

    // Second job: the worker crashed after Orchestrator created the UiPath job.
    const reference = buildAttemptReference(interrupted.jobId, 1);
    const job = await harness.prisma.automationJob.findUniqueOrThrow({ where: { id: interrupted.jobId } });
    const client = new UiPathOrchestratorClient(loadUiPathConfigFromEnv()!);
    await client.startJob({
      processName: job.processName,
      reference,
      inputArguments: {
        in_IdempotencyKey: job.idempotencyKey,
        in_PurchaseOrderJson: JSON.stringify(job.inputPayload),
      },
    });
    await harness.prisma.automationJob.update({
      where: { id: interrupted.jobId },
      data: { status: 'SUBMITTING', attemptCount: 1, attempts: { create: { attemptNo: 1, reference, status: 'SUBMITTING', triggeredBy: 'SYSTEM' } } },
    });
    await harness.prisma.$executeRawUnsafe(
      `UPDATE automation_jobs SET updated_at = now() - interval '10 minutes' WHERE id IN ('${lost.jobId}', '${interrupted.jobId}')`,
    );

    const reconciler = new Reconciler({ db: harness.prisma, queue, logger: silentLogger });
    const summary = await reconciler.reconcile();
    expect(summary.queuedJobs).toBeGreaterThanOrEqual(1);
    expect(summary.interruptedSubmissions).toBeGreaterThanOrEqual(1);

    const lostDone = await waitForJob(lost.jobId, ['COMPLETED', 'FAILED']);
    const interruptedDone = await waitForJob(interrupted.jobId, ['COMPLETED', 'FAILED']);
    expect(lostDone.status).toBe('COMPLETED');
    expect(interruptedDone.status).toBe('COMPLETED');
    // The interrupted submission was adopted, not submitted again.
    expect(interruptedDone.attemptCount).toBe(1);
    expect([...harness.orchestrator.jobs.values()].filter((mockJob) => mockJob.Reference === reference)).toHaveLength(1);
    expect(harness.erpStore.list({ integrationKey: interruptedDone.idempotencyKey })).toHaveLength(1);
  });

  it('reports UiPath health through the integration endpoint without exposing secrets', async () => {
    const admin = await harness.login('admin@orchestra.local');
    const health = await admin.post(`${API}/integrations/uipath/test-connection`).expect(200);
    expect(health.body).toMatchObject({ ok: true, mode: 'mock', isMock: true, authenticated: true, processFound: true });
    expect(JSON.stringify(health.body)).not.toContain('orchestra-test-secret');
    await requester.get(`${API}/integrations/uipath/health`).expect(403);
  });
});
