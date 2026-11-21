import type { DbClient, PrismaClient } from '@orchestra/database';
import {
  AuditAction,
  AuditEntity,
  buildIdempotencyKey,
  ConcurrencyConflictError,
  DomainError,
  NotFoundError,
  type AutomationConfig,
} from '@orchestra/domain';
import type { ActorContext } from '../actor';
import { writeAudit } from '../audit/audit-writer';
import { toJsonValue } from '../json';
import type { JobQueue } from '../queue/queue.types';
import { runInTransaction } from '../transaction';
import { transitionPurchaseRequest } from '../workflow/transitions';
import { writeAutomationLog } from './automation-log';
import { buildRobotPayload, type PurchaseRequestForAutomation } from './robot-payload';

/**
 * Creates the automation job for an approved request and moves the request
 * APPROVED -> QUEUED. Must run inside the caller's transaction (typically the
 * final approval); enqueue the returned job only after the commit.
 * The unique purchase_request_id / idempotency_key columns guarantee that a
 * request can never get a second job, even under concurrent approvals.
 */
export async function createAutomationJob(
  tx: DbClient,
  params: {
    purchaseRequest: PurchaseRequestForAutomation;
    automation: AutomationConfig;
    actor: ActorContext;
    correlationId: string;
  },
): Promise<{ automationJobId: string; attemptNo: number; correlationId: string }> {
  const { purchaseRequest: request, automation, actor, correlationId } = params;
  const payload = buildRobotPayload(request);
  const idempotencyKey = buildIdempotencyKey(request.id);
  const job = await tx.automationJob.create({
    data: {
      purchaseRequestId: request.id,
      workflowId: request.workflowId,
      processName: automation.processName,
      idempotencyKey,
      correlationId,
      status: 'QUEUED',
      maxAutoAttempts: automation.maxAutoAttempts,
      maxTotalAttempts: automation.maxTotalAttempts,
      pendingTimeoutSec: automation.pendingTimeoutMinutes * 60,
      executionTimeoutSec: automation.executionTimeoutMinutes * 60,
      inputPayload: toJsonValue(payload, { redact: false }) ?? {},
    },
  });
  await transitionPurchaseRequest(tx, {
    purchaseRequestId: request.id,
    from: 'APPROVED',
    to: 'QUEUED',
    actor,
    metadata: { automationJobId: job.id },
  });
  await writeAutomationLog(tx, {
    automationJobId: job.id,
    level: 'INFO',
    eventType: 'JOB_CREATED',
    message: `Automation job created for ${request.requestNumber} (UiPath process ${automation.processName})`,
    metadata: { idempotencyKey },
    correlationId,
  });
  await writeAudit(tx, actor, {
    action: AuditAction.AUTOMATION_JOB_CREATED,
    entityType: AuditEntity.AUTOMATION_JOB,
    entityId: job.id,
    purchaseRequestId: request.id,
    newValue: { status: 'QUEUED', processName: automation.processName, idempotencyKey },
  });
  return { automationJobId: job.id, attemptNo: 1, correlationId };
}

/**
 * Operator retry of a failed job (FAILED -> QUEUED). The next attempt reuses
 * the same idempotency key, so the ERP cannot create a second purchase order.
 */
export async function retryAutomationJob(
  db: PrismaClient,
  queue: JobQueue,
  params: { automationJobId: string; actor: ActorContext; reason?: string | null },
): Promise<{ attemptNo: number }> {
  const result = await runInTransaction(db, async (tx) => {
    const job = await tx.automationJob.findUnique({ where: { id: params.automationJobId } });
    if (!job) throw new NotFoundError('Automation job', params.automationJobId);
    if (job.status !== 'FAILED') {
      throw new DomainError('PRECONDITION_FAILED', `Only failed jobs can be retried (this job is ${job.status})`);
    }
    if (job.attemptCount >= job.maxTotalAttempts) {
      throw new DomainError(
        'RETRY_LIMIT_REACHED',
        `Retry limit reached (${job.attemptCount}/${job.maxTotalAttempts} attempts). Manual intervention is required.`,
      );
    }
    const updated = await tx.automationJob.updateMany({
      where: { id: job.id, status: 'FAILED', attemptCount: job.attemptCount },
      data: { status: 'QUEUED', requiresIntervention: false, nextAttemptAt: null, queuedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConcurrencyConflictError();
    await transitionPurchaseRequest(tx, {
      purchaseRequestId: job.purchaseRequestId,
      from: 'FAILED',
      to: 'QUEUED',
      actor: params.actor,
      reason: params.reason ?? 'Operator retry',
      metadata: { automationJobId: job.id, retry: true },
    });
    await writeAutomationLog(tx, {
      automationJobId: job.id,
      level: 'INFO',
      eventType: 'RETRY_REQUESTED',
      message: `Retry requested by operator (next attempt ${job.attemptCount + 1}/${job.maxTotalAttempts})${params.reason ? `: ${params.reason}` : ''}`,
      correlationId: job.correlationId,
    });
    await writeAudit(tx, params.actor, {
      action: AuditAction.AUTOMATION_RETRY_REQUESTED,
      entityType: AuditEntity.AUTOMATION_JOB,
      entityId: job.id,
      purchaseRequestId: job.purchaseRequestId,
      oldValue: { status: 'FAILED', attemptCount: job.attemptCount },
      newValue: { status: 'QUEUED' },
      metadata: { reason: params.reason ?? null },
    });
    return { attemptNo: job.attemptCount + 1, correlationId: job.correlationId };
  });
  await queue.enqueueAutomationSubmit({
    automationJobId: params.automationJobId,
    attemptNo: result.attemptNo,
    correlationId: result.correlationId,
    triggeredById: params.actor.actorId,
  });
  return { attemptNo: result.attemptNo };
}

/** Operator abandons a failed job (FAILED -> CANCELLED); the request is cancelled too. */
export async function cancelAutomationJob(
  db: PrismaClient,
  params: { automationJobId: string; actor: ActorContext; reason: string },
): Promise<void> {
  await runInTransaction(db, async (tx) => {
    const job = await tx.automationJob.findUnique({ where: { id: params.automationJobId } });
    if (!job) throw new NotFoundError('Automation job', params.automationJobId);
    if (job.status !== 'FAILED') {
      throw new DomainError('PRECONDITION_FAILED', `Only failed jobs can be cancelled (this job is ${job.status})`);
    }
    const updated = await tx.automationJob.updateMany({
      where: { id: job.id, status: 'FAILED' },
      data: { status: 'CANCELLED', requiresIntervention: false, completedAt: new Date() },
    });
    if (updated.count !== 1) throw new ConcurrencyConflictError();
    await transitionPurchaseRequest(tx, {
      purchaseRequestId: job.purchaseRequestId,
      from: 'FAILED',
      to: 'CANCELLED',
      actor: params.actor,
      reason: params.reason,
      metadata: { automationJobId: job.id },
    });
    await writeAutomationLog(tx, {
      automationJobId: job.id,
      level: 'WARN',
      eventType: 'CANCELLED',
      message: `Job cancelled by operator: ${params.reason}`,
      correlationId: job.correlationId,
    });
    await writeAudit(tx, params.actor, {
      action: AuditAction.AUTOMATION_JOB_CANCELLED,
      entityType: AuditEntity.AUTOMATION_JOB,
      entityId: job.id,
      purchaseRequestId: job.purchaseRequestId,
      oldValue: { status: 'FAILED' },
      newValue: { status: 'CANCELLED' },
      metadata: { reason: params.reason },
    });
  });
}
