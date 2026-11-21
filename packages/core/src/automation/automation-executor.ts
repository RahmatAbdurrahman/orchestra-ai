import type { AutomationAttempt, AutomationJob, PrismaClient, TransactionClient } from '@orchestra/database';
import {
  AuditAction,
  AuditEntity,
  buildAttemptReference,
  classifyRobotFault,
  computeBackoffMs,
  computePollDelayMs,
  validateRobotOutput,
  type AutomationJobStatus,
  type RobotOutput,
  type RobotPurchaseOrderPayload,
} from '@orchestra/domain';
import {
  isUiPathApiError,
  type JobResult,
  type JobStatusResult,
  type RpaExecutionProvider,
} from '@orchestra/uipath-client';
import { robotActor, systemActor } from '../actor';
import { writeAudit } from '../audit/audit-writer';
import { toJsonValue } from '../json';
import { errorMessage, type CoreLogger } from '../logger';
import { findActiveUserIdsWithRole, notifyUsers } from '../notifications/notifications';
import type {
  AutomationPollJobData,
  AutomationSubmitJobData,
  JobExecutionContext,
  JobQueue,
} from '../queue/queue.types';
import { runInTransaction } from '../transaction';
import { transitionPurchaseRequest, transitionPurchaseRequestVia } from '../workflow/transitions';
import { writeAutomationLog } from './automation-log';
import { buildRobotInputArguments } from './robot-payload';

export interface AutomationExecutorOptions {
  /** A submission older than this without progress is considered interrupted. */
  submitLeaseMs: number;
  /** After this long an unconfirmed submission is failed for operator review. */
  unconfirmedSubmissionTimeoutMs: number;
  autoRetryBaseDelayMs: number;
  autoRetryMaxDelayMs: number;
  pollBaseDelayMs: number;
  pollMaxDelayMs: number;
}

export const DEFAULT_AUTOMATION_EXECUTOR_OPTIONS: AutomationExecutorOptions = Object.freeze({
  submitLeaseMs: 120_000,
  unconfirmedSubmissionTimeoutMs: 30 * 60_000,
  autoRetryBaseDelayMs: 15_000,
  autoRetryMaxDelayMs: 5 * 60_000,
  pollBaseDelayMs: 3_000,
  pollMaxDelayMs: 30_000,
});

export interface AutomationExecutorDependencies {
  db: PrismaClient;
  /** null when the UiPath integration is not configured. */
  rpa: RpaExecutionProvider | null;
  queue: JobQueue;
  logger: CoreLogger;
  options?: Partial<AutomationExecutorOptions>;
  now?: () => Date;
}

export interface ExecutionFailure {
  code: string;
  message: string;
  retryable: boolean;
  /** The robot never started working on the request (safe to resubmit automatically). */
  beforeStart: boolean;
}

type SubmissionTarget = Pick<JobStatusResult, 'jobId' | 'jobKey' | 'state' | 'rawState'>;

/**
 * Executes automation jobs against UiPath Orchestrator.
 *
 * Reliability rules (SAD 6.3 / 13.5 / 17):
 * - PostgreSQL is the source of truth; every state change is a compare-and-set.
 * - Each UiPath submission (attempt) carries a unique Reference. Before
 *   submitting, and after any ambiguous failure, the reference is looked up so
 *   a timeout is never treated as "not submitted".
 * - Failures before the robot started (submission errors, no robot picked the
 *   job up) are retried automatically within `maxAutoAttempts`.
 * - Failures after the robot started mark the job FAILED; only an authorized
 *   operator retry re-queues it (bounded by `maxTotalAttempts`).
 * - The idempotency key travels with every attempt so the ERP rejects
 *   duplicate purchase orders.
 */
export class AutomationExecutor {
  private readonly options: AutomationExecutorOptions;
  private readonly now: () => Date;

  constructor(private readonly deps: AutomationExecutorDependencies) {
    this.options = { ...DEFAULT_AUTOMATION_EXECUTOR_OPTIONS, ...deps.options };
    this.now = deps.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  async submit(data: AutomationSubmitJobData, _context: JobExecutionContext): Promise<void> {
    const job = await this.deps.db.automationJob.findUnique({ where: { id: data.automationJobId } });
    if (!job) {
      this.deps.logger.warn('Automation job not found', { automationJobId: data.automationJobId });
      return;
    }
    if (job.status === 'QUEUED') return this.submitQueued(job, data);
    if (job.status === 'SUBMITTING') return this.resumeInterruptedSubmission(job);
    this.deps.logger.debug?.('Submit message ignored; job is not waiting for submission', {
      automationJobId: job.id,
      status: job.status,
    });
  }

  private async submitQueued(job: AutomationJob, data: AutomationSubmitJobData): Promise<void> {
    const attemptNo = job.attemptCount + 1;
    if (data.attemptNo !== attemptNo) {
      this.deps.logger.debug?.('Stale submit message ignored', { automationJobId: job.id, attemptNo: data.attemptNo });
      return;
    }
    if (job.nextAttemptAt && job.nextAttemptAt.getTime() > this.now().getTime() + 2_000) {
      // Not due yet; the delayed message or the reconciler will pick it up.
      return;
    }
    if (attemptNo > job.maxTotalAttempts) {
      await runInTransaction(this.deps.db, (tx) =>
        this.failJobInTx(tx, job, ['QUEUED'], job.attemptCount, {
          code: 'RETRY_LIMIT_REACHED',
          message: `Retry limit reached (${job.attemptCount}/${job.maxTotalAttempts})`,
          retryable: false,
          beforeStart: true,
        }),
      );
      return;
    }

    const reference = buildAttemptReference(job.id, attemptNo);
    const attempt = await runInTransaction(this.deps.db, async (tx) => {
      const claimed = await tx.automationJob.updateMany({
        where: { id: job.id, status: 'QUEUED', attemptCount: job.attemptCount },
        data: { status: 'SUBMITTING', attemptCount: attemptNo, nextAttemptAt: null },
      });
      if (claimed.count !== 1) return null;
      const created = await tx.automationAttempt.create({
        data: {
          automationJobId: job.id,
          attemptNo,
          reference,
          status: 'SUBMITTING',
          triggeredBy: data.triggeredById ? 'USER' : 'SYSTEM',
          triggeredById: data.triggeredById ?? null,
        },
      });
      await writeAutomationLog(tx, {
        automationJobId: job.id,
        attemptNo,
        level: 'INFO',
        eventType: 'SUBMITTING',
        message: `Submitting attempt ${attemptNo}/${job.maxTotalAttempts} to UiPath (reference ${reference})`,
        correlationId: job.correlationId,
      });
      return created;
    });
    if (!attempt) return;
    await this.performSubmission({ ...job, status: 'SUBMITTING', attemptCount: attemptNo }, attempt);
  }

  private async performSubmission(job: AutomationJob, attempt: AutomationAttempt): Promise<void> {
    const { rpa } = this.deps;
    if (!rpa) {
      await this.handleSubmissionFailure(job, attempt, {
        code: 'UIPATH_NOT_CONFIGURED',
        message: 'The UiPath integration is not configured',
        retryable: false,
        beforeStart: true,
      });
      return;
    }

    let target: SubmissionTarget | null = null;
    try {
      // Never submit twice for the same reference (e.g. after a crash right after StartJobs).
      const existing = await rpa.findJobByReference(attempt.reference);
      if (existing) {
        await this.log(job, attempt.attemptNo, 'WARN', 'ADOPTED_EXISTING_JOB', `UiPath job ${existing.jobId} already exists for reference ${attempt.reference}; adopting it instead of submitting again`);
        target = existing;
      } else {
        const payload = job.inputPayload as unknown as RobotPurchaseOrderPayload;
        target = await rpa.startJob({
          processName: job.processName,
          reference: attempt.reference,
          inputArguments: buildRobotInputArguments(job, payload) as unknown as Record<string, unknown>,
        });
      }
    } catch (error) {
      if (isUiPathApiError(error) && error.ambiguous) {
        // The request may have reached Orchestrator: look the reference up before deciding.
        let lookup: JobStatusResult | null | undefined;
        try {
          lookup = await rpa.findJobByReference(attempt.reference);
        } catch {
          lookup = undefined;
        }
        if (lookup) {
          await this.log(job, attempt.attemptNo, 'WARN', 'SUBMISSION_RECOVERED', `StartJobs failed (${error.message}) but job ${lookup.jobId} exists in Orchestrator; adopting it`);
          target = lookup;
        } else if (lookup === undefined) {
          await this.log(job, attempt.attemptNo, 'WARN', 'SUBMISSION_UNCONFIRMED', `Submission outcome unknown (${error.message}). It will be verified by reference before any resubmission.`);
          return; // stays SUBMITTING; resolved by the reconciler after the lease expires
        } else {
          await this.handleSubmissionFailure(job, attempt, {
            code: error.kind,
            message: error.message,
            retryable: error.retryable,
            beforeStart: true,
          });
          return;
        }
      } else {
        await this.handleSubmissionFailure(job, attempt, toFailure(error, true));
        return;
      }
    }
    await this.markSubmitted(job, attempt, target);
  }

  private async resumeInterruptedSubmission(job: AutomationJob): Promise<void> {
    const now = this.now();
    if (now.getTime() - job.updatedAt.getTime() < this.options.submitLeaseMs) return; // still owned by another worker
    const attempt = await this.deps.db.automationAttempt.findUnique({
      where: { automationJobId_attemptNo: { automationJobId: job.id, attemptNo: job.attemptCount } },
    });
    // Claim the stale submission (compare-and-set on updatedAt).
    const claimed = await this.deps.db.automationJob.updateMany({
      where: { id: job.id, status: 'SUBMITTING', updatedAt: job.updatedAt },
      data: { lastPolledAt: now },
    });
    if (claimed.count !== 1) return;

    if (!attempt) {
      await runInTransaction(this.deps.db, async (tx) => {
        await tx.automationJob.updateMany({
          where: { id: job.id, status: 'SUBMITTING' },
          data: { status: 'QUEUED', attemptCount: Math.max(0, job.attemptCount - 1) },
        });
      });
      return;
    }
    if (!this.deps.rpa) {
      await this.handleSubmissionFailure(job, attempt, {
        code: 'UIPATH_NOT_CONFIGURED',
        message: 'The UiPath integration is not configured',
        retryable: false,
        beforeStart: true,
      });
      return;
    }

    let found: JobStatusResult | null;
    try {
      found = await this.deps.rpa.findJobByReference(attempt.reference);
    } catch (error) {
      if (now.getTime() - attempt.createdAt.getTime() > this.options.unconfirmedSubmissionTimeoutMs) {
        await this.handleSubmissionFailure(job, attempt, {
          code: 'SUBMISSION_UNCONFIRMED',
          message: `Could not confirm whether UiPath job ${attempt.reference} was created (${errorMessage(error)}). Check Orchestrator before retrying.`,
          retryable: false,
          beforeStart: true,
        });
      } else {
        await this.log(job, attempt.attemptNo, 'WARN', 'RECONCILE_DEFERRED', `Orchestrator unavailable while verifying reference ${attempt.reference}: ${errorMessage(error)}`);
      }
      return;
    }
    if (found) {
      await this.log(job, attempt.attemptNo, 'INFO', 'RECONCILED', `Interrupted submission found in Orchestrator as job ${found.jobId}; resuming monitoring`);
      await writeAudit(this.deps.db, systemActor(job.correlationId), {
        action: AuditAction.AUTOMATION_RECONCILED,
        entityType: AuditEntity.AUTOMATION_JOB,
        entityId: job.id,
        purchaseRequestId: job.purchaseRequestId,
        metadata: { reference: attempt.reference, uipathJobId: found.jobId },
      });
      await this.markSubmitted(job, attempt, found);
    } else {
      await this.handleSubmissionFailure(job, attempt, {
        code: 'SUBMISSION_NOT_FOUND',
        message: `Interrupted submission ${attempt.reference} was not found in Orchestrator`,
        retryable: true,
        beforeStart: true,
      });
    }
  }

  private async markSubmitted(job: AutomationJob, attempt: AutomationAttempt, target: SubmissionTarget): Promise<void> {
    const now = this.now();
    const submitted = await runInTransaction(this.deps.db, async (tx) => {
      const updated = await tx.automationJob.updateMany({
        where: { id: job.id, status: 'SUBMITTING', attemptCount: attempt.attemptNo },
        data: {
          status: 'PENDING',
          uipathJobId: target.jobId,
          uipathJobKey: target.jobKey,
          errorCode: null,
          errorMessage: null,
        },
      });
      if (updated.count !== 1) return false;
      await tx.automationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'PENDING',
          uipathJobId: target.jobId,
          uipathJobKey: target.jobKey,
          uipathState: target.rawState,
          submittedAt: now,
        },
      });
      await writeAutomationLog(tx, {
        automationJobId: job.id,
        attemptNo: attempt.attemptNo,
        level: 'INFO',
        eventType: 'SUBMITTED',
        message: `UiPath job ${target.jobId} created (state ${target.rawState ?? 'unknown'})`,
        metadata: { uipathJobId: target.jobId, uipathJobKey: target.jobKey, reference: attempt.reference },
        correlationId: job.correlationId,
      });
      await writeAudit(tx, systemActor(job.correlationId), {
        action: AuditAction.AUTOMATION_JOB_SUBMITTED,
        entityType: AuditEntity.AUTOMATION_JOB,
        entityId: job.id,
        purchaseRequestId: job.purchaseRequestId,
        newValue: { status: 'PENDING', uipathJobId: target.jobId, attemptNo: attempt.attemptNo },
        metadata: { reference: attempt.reference },
      });
      return true;
    });
    if (submitted) await this.schedulePoll(job, attempt.attemptNo, 1);
  }

  private async handleSubmissionFailure(job: AutomationJob, attempt: AutomationAttempt, failure: ExecutionFailure): Promise<void> {
    const now = this.now();
    const autoRetry = this.canAutoRetry(job, attempt.attemptNo, failure);
    const delayMs = computeBackoffMs(attempt.attemptNo, this.options.autoRetryBaseDelayMs, this.options.autoRetryMaxDelayMs);
    const retryScheduled = await runInTransaction(this.deps.db, async (tx) => {
      await tx.automationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUBMIT_FAILED',
          errorCode: failure.code.slice(0, 60),
          errorMessage: failure.message.slice(0, 4000),
          retryable: failure.retryable,
          endedAt: now,
        },
      });
      if (autoRetry) {
        return this.scheduleAutomaticRetryInTx(tx, job, ['SUBMITTING'], attempt.attemptNo, failure, delayMs);
      }
      await this.failJobInTx(tx, job, ['SUBMITTING'], attempt.attemptNo, failure);
      return false;
    });
    if (retryScheduled) {
      await this.deps.queue.enqueueAutomationSubmit(
        { automationJobId: job.id, attemptNo: attempt.attemptNo + 1, correlationId: job.correlationId },
        { delayMs },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Monitoring
  // ---------------------------------------------------------------------------

  async poll(data: AutomationPollJobData, context: JobExecutionContext): Promise<void> {
    const { db, rpa } = this.deps;
    const job = await db.automationJob.findUnique({ where: { id: data.automationJobId } });
    if (!job || (job.status !== 'PENDING' && job.status !== 'RUNNING') || job.attemptCount !== data.attemptNo) return;
    const attempt = await db.automationAttempt.findUnique({
      where: { automationJobId_attemptNo: { automationJobId: job.id, attemptNo: data.attemptNo } },
    });
    if (!attempt || (attempt.status !== 'PENDING' && attempt.status !== 'RUNNING') || !attempt.uipathJobId) return;

    if (!rpa) {
      await this.handleExecutionFailure(job, attempt, {
        code: 'UIPATH_NOT_CONFIGURED',
        message: 'The UiPath integration is not configured; the job cannot be monitored',
        retryable: false,
        beforeStart: attempt.status === 'PENDING',
      });
      return;
    }

    let status: JobResult;
    try {
      status = await rpa.getJobResult(attempt.uipathJobId);
    } catch (error) {
      if (isUiPathApiError(error) && error.kind === 'NOT_FOUND') {
        await this.handleExecutionFailure(job, attempt, {
          code: 'UIPATH_JOB_NOT_FOUND',
          message: `UiPath job ${attempt.uipathJobId} no longer exists in Orchestrator`,
          retryable: false,
          beforeStart: attempt.status === 'PENDING',
        });
        return;
      }
      if (!context.isFinalAttempt) throw error; // queue-level retry with backoff
      // Monitoring is unavailable; keep watching instead of failing a job that may still be running.
      await this.log(job, attempt.attemptNo, 'WARN', 'POLL_FAILED', `Could not read job status from Orchestrator: ${errorMessage(error)}`);
      await this.schedulePoll(job, attempt.attemptNo, data.sequence + 1, this.options.pollMaxDelayMs * 2);
      return;
    }

    const now = this.now();
    await db.automationAttempt.update({
      where: { id: attempt.id },
      data: { pollCount: { increment: 1 }, lastPolledAt: now, uipathState: status.rawState },
    });
    await db.automationJob.updateMany({ where: { id: job.id }, data: { lastPolledAt: now } });

    switch (status.state) {
      case 'PENDING':
      case 'UNKNOWN': {
        const waitingSince = (attempt.submittedAt ?? attempt.createdAt).getTime();
        if (now.getTime() - waitingSince > job.pendingTimeoutSec * 1000) {
          await this.tryStop(job, attempt, 'SoftStop');
          await this.handleExecutionFailure(job, attempt, {
            code: 'ROBOT_UNAVAILABLE',
            message: `No robot picked up UiPath job ${attempt.uipathJobId} within ${Math.round(job.pendingTimeoutSec / 60)} minute(s)`,
            retryable: true,
            beforeStart: true,
          });
          return;
        }
        await this.schedulePoll(job, attempt.attemptNo, data.sequence + 1);
        return;
      }
      case 'RUNNING': {
        const startedAt = attempt.startedAt ?? (status.startTime ? new Date(status.startTime) : now);
        if (job.status === 'PENDING') await this.markRunning(job, attempt, startedAt, status);
        if (now.getTime() - startedAt.getTime() > job.executionTimeoutSec * 1000) {
          await this.tryStop(job, attempt, 'Kill');
          await this.handleExecutionFailure(job, attempt, {
            code: 'EXECUTION_TIMEOUT',
            message: `UiPath job ${attempt.uipathJobId} exceeded the execution timeout of ${Math.round(job.executionTimeoutSec / 60)} minute(s) and was stopped`,
            retryable: true,
            beforeStart: false,
          });
          return;
        }
        await this.schedulePoll(job, attempt.attemptNo, data.sequence + 1);
        return;
      }
      case 'SUCCESSFUL': {
        const validation = validateRobotOutput(status.outputArguments ?? status.rawOutputArguments ?? {}, job.idempotencyKey);
        if (!validation.ok) {
          await this.handleExecutionFailure(job, attempt, {
            code: 'INVALID_ROBOT_OUTPUT',
            message: `${validation.reason}. Verify the purchase order in the ERP before retrying.`,
            retryable: false,
            beforeStart: false,
          });
          return;
        }
        if (validation.value.out_Status === 'BUSINESS_ERROR') {
          await this.handleExecutionFailure(job, attempt, {
            code: 'BUSINESS_EXCEPTION',
            message: validation.value.out_Message || 'The robot reported a business error',
            retryable: false,
            beforeStart: false,
          });
          return;
        }
        await this.complete(job, attempt, validation.value, status, now);
        return;
      }
      case 'FAULTED': {
        const fault = classifyRobotFault({ info: status.info, jobError: status.jobError });
        await this.handleExecutionFailure(job, attempt, {
          code: fault.code,
          message: fault.message,
          retryable: fault.retryable,
          beforeStart: !attempt.startedAt && !status.startTime,
        });
        return;
      }
      case 'STOPPED': {
        await this.handleExecutionFailure(job, attempt, {
          code: 'STOPPED',
          message: `UiPath job ${attempt.uipathJobId} was stopped in Orchestrator`,
          retryable: false,
          beforeStart: !attempt.startedAt && !status.startTime,
        });
        return;
      }
    }
  }

  private async markRunning(job: AutomationJob, attempt: AutomationAttempt, startedAt: Date, status: JobStatusResult): Promise<void> {
    await runInTransaction(this.deps.db, async (tx) => {
      const updated = await tx.automationJob.updateMany({
        where: { id: job.id, status: 'PENDING', attemptCount: attempt.attemptNo },
        data: { status: 'RUNNING', startedAt: job.startedAt ?? startedAt },
      });
      if (updated.count !== 1) return;
      await tx.automationAttempt.update({ where: { id: attempt.id }, data: { status: 'RUNNING', startedAt } });
      const request = await tx.purchaseRequest.findUnique({ where: { id: job.purchaseRequestId }, select: { status: true } });
      if (request?.status === 'QUEUED') {
        await transitionPurchaseRequest(tx, {
          purchaseRequestId: job.purchaseRequestId,
          from: 'QUEUED',
          to: 'RUNNING',
          actor: robotActor(job.correlationId),
          metadata: { automationJobId: job.id, uipathJobId: attempt.uipathJobId },
        });
      }
      await writeAutomationLog(tx, {
        automationJobId: job.id,
        attemptNo: attempt.attemptNo,
        level: 'INFO',
        eventType: 'RUNNING',
        message: `Robot started UiPath job ${attempt.uipathJobId}${status.hostMachineName ? ` on ${status.hostMachineName}` : ''}`,
        correlationId: job.correlationId,
      });
      await writeAudit(tx, robotActor(job.correlationId), {
        action: AuditAction.AUTOMATION_JOB_RUNNING,
        entityType: AuditEntity.AUTOMATION_JOB,
        entityId: job.id,
        purchaseRequestId: job.purchaseRequestId,
        newValue: { status: 'RUNNING', uipathJobId: attempt.uipathJobId },
      });
    });
  }

  private async complete(
    job: AutomationJob,
    attempt: AutomationAttempt,
    output: RobotOutput,
    status: JobResult,
    now: Date,
  ): Promise<void> {
    const poNumber = output.out_PoNumber!;
    const duplicatePrevented = output.out_Status === 'ALREADY_EXISTS';
    await runInTransaction(this.deps.db, async (tx) => {
      const updated = await tx.automationJob.updateMany({
        where: { id: job.id, status: { in: ['PENDING', 'RUNNING'] }, attemptCount: attempt.attemptNo },
        data: {
          status: 'COMPLETED',
          poNumber,
          outputData: toJsonValue(output, { redact: false }),
          completedAt: now,
          startedAt: job.startedAt ?? attempt.startedAt ?? (status.startTime ? new Date(status.startTime) : now),
          errorCode: null,
          errorMessage: null,
          requiresIntervention: false,
        },
      });
      if (updated.count !== 1) return;
      await tx.automationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'SUCCESSFUL',
          startedAt: attempt.startedAt ?? (status.startTime ? new Date(status.startTime) : undefined),
          endedAt: status.endTime ? new Date(status.endTime) : now,
          outputArguments: toJsonValue(output, { redact: false }),
          screenshotRef: output.out_ScreenshotPath ?? null,
        },
      });
      const request = await tx.purchaseRequest.findUnique({
        where: { id: job.purchaseRequestId },
        select: { status: true, requesterId: true, requestNumber: true },
      });
      if (request && (request.status === 'QUEUED' || request.status === 'RUNNING')) {
        await transitionPurchaseRequestVia(tx, {
          purchaseRequestId: job.purchaseRequestId,
          from: request.status,
          to: 'COMPLETED',
          actor: robotActor(job.correlationId),
          data: { poNumber },
          metadata: { automationJobId: job.id, poNumber, result: output.out_Status },
        });
      }
      await writeAutomationLog(tx, {
        automationJobId: job.id,
        attemptNo: attempt.attemptNo,
        level: 'INFO',
        eventType: 'COMPLETED',
        message: duplicatePrevented
          ? `Purchase order ${poNumber} already existed in the ERP for this idempotency key; no duplicate was created`
          : `Purchase order ${poNumber} created in the ERP`,
        metadata: { poNumber, result: output.out_Status, erpReference: output.out_ErpReference ?? null },
        correlationId: job.correlationId,
      });
      await writeAudit(tx, robotActor(job.correlationId), {
        action: AuditAction.AUTOMATION_JOB_COMPLETED,
        entityType: AuditEntity.AUTOMATION_JOB,
        entityId: job.id,
        purchaseRequestId: job.purchaseRequestId,
        newValue: { status: 'COMPLETED', poNumber, result: output.out_Status },
      });
      if (request) {
        await notifyUsers(tx, [request.requesterId], {
          type: 'AUTOMATION_COMPLETED',
          title: `${request.requestNumber}: purchase order ${poNumber}`,
          message: duplicatePrevented
            ? `The ERP already had purchase order ${poNumber} for this request; no duplicate was created.`
            : `The robot created purchase order ${poNumber} in the ERP.`,
          link: `/requests/${job.purchaseRequestId}`,
        });
      }
    });
  }

  private async handleExecutionFailure(job: AutomationJob, attempt: AutomationAttempt, failure: ExecutionFailure): Promise<void> {
    const now = this.now();
    const autoRetry = this.canAutoRetry(job, attempt.attemptNo, failure);
    const delayMs = computeBackoffMs(attempt.attemptNo, this.options.autoRetryBaseDelayMs, this.options.autoRetryMaxDelayMs);
    const retryScheduled = await runInTransaction(this.deps.db, async (tx) => {
      const current = await tx.automationJob.findUnique({ where: { id: job.id }, select: { status: true, attemptCount: true } });
      if (!current || (current.status !== 'PENDING' && current.status !== 'RUNNING') || current.attemptCount !== attempt.attemptNo) {
        return false;
      }
      await tx.automationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: failure.code === 'STOPPED' ? 'STOPPED' : 'FAULTED',
          errorCode: failure.code.slice(0, 60),
          errorMessage: failure.message.slice(0, 4000),
          retryable: failure.retryable,
          endedAt: now,
        },
      });
      if (autoRetry && current.status === 'PENDING') {
        return this.scheduleAutomaticRetryInTx(tx, job, ['PENDING'], attempt.attemptNo, failure, delayMs);
      }
      await this.failJobInTx(tx, job, ['PENDING', 'RUNNING'], attempt.attemptNo, failure);
      return false;
    });
    if (retryScheduled) {
      await this.deps.queue.enqueueAutomationSubmit(
        { automationJobId: job.id, attemptNo: attempt.attemptNo + 1, correlationId: job.correlationId },
        { delayMs },
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private canAutoRetry(job: AutomationJob, attemptNo: number, failure: ExecutionFailure): boolean {
    return (
      failure.retryable &&
      failure.beforeStart &&
      attemptNo < job.maxAutoAttempts &&
      attemptNo < job.maxTotalAttempts
    );
  }

  private async scheduleAutomaticRetryInTx(
    tx: TransactionClient,
    job: AutomationJob,
    expected: AutomationJobStatus[],
    attemptNo: number,
    failure: ExecutionFailure,
    delayMs: number,
  ): Promise<boolean> {
    const nextAttemptAt = new Date(this.now().getTime() + delayMs);
    const updated = await tx.automationJob.updateMany({
      where: { id: job.id, status: { in: expected }, attemptCount: attemptNo },
      data: {
        status: 'QUEUED',
        nextAttemptAt,
        errorCode: failure.code.slice(0, 60),
        errorMessage: failure.message.slice(0, 4000),
      },
    });
    if (updated.count !== 1) return false;
    await writeAutomationLog(tx, {
      automationJobId: job.id,
      attemptNo,
      level: 'WARN',
      eventType: 'RETRY_SCHEDULED',
      message: `Attempt ${attemptNo} failed before the robot started (${failure.code}: ${failure.message}). Automatic retry ${attemptNo + 1}/${job.maxAutoAttempts} in ${Math.round(delayMs / 1000)}s.`,
      correlationId: job.correlationId,
    });
    await writeAudit(tx, systemActor(job.correlationId), {
      action: AuditAction.AUTOMATION_RETRY_SCHEDULED,
      entityType: AuditEntity.AUTOMATION_JOB,
      entityId: job.id,
      purchaseRequestId: job.purchaseRequestId,
      metadata: { attemptNo, errorCode: failure.code, nextAttemptAt: nextAttemptAt.toISOString() },
    });
    return true;
  }

  private async failJobInTx(
    tx: TransactionClient,
    job: AutomationJob,
    expected: AutomationJobStatus[],
    attemptNo: number,
    failure: ExecutionFailure,
  ): Promise<void> {
    const limitReached = attemptNo >= job.maxTotalAttempts;
    const updated = await tx.automationJob.updateMany({
      where: { id: job.id, status: { in: expected } },
      data: {
        status: 'FAILED',
        errorCode: failure.code.slice(0, 60),
        errorMessage: failure.message.slice(0, 4000),
        requiresIntervention: limitReached,
        nextAttemptAt: null,
      },
    });
    if (updated.count !== 1) return;
    const request = await tx.purchaseRequest.findUnique({
      where: { id: job.purchaseRequestId },
      select: { status: true, requesterId: true, requestNumber: true },
    });
    if (request && (request.status === 'QUEUED' || request.status === 'RUNNING')) {
      await transitionPurchaseRequest(tx, {
        purchaseRequestId: job.purchaseRequestId,
        from: request.status,
        to: 'FAILED',
        actor: systemActor(job.correlationId),
        reason: failure.message.slice(0, 500),
        metadata: { automationJobId: job.id, errorCode: failure.code },
      });
    }
    await writeAutomationLog(tx, {
      automationJobId: job.id,
      attemptNo,
      level: 'ERROR',
      eventType: 'JOB_FAILED',
      message: `${failure.code}: ${failure.message}${limitReached ? ' Retry limit reached; manual intervention required.' : ' An operator can retry the job.'}`,
      metadata: { retryable: failure.retryable, beforeStart: failure.beforeStart },
      correlationId: job.correlationId,
    });
    await writeAudit(tx, systemActor(job.correlationId), {
      action: AuditAction.AUTOMATION_JOB_FAILED,
      entityType: AuditEntity.AUTOMATION_JOB,
      entityId: job.id,
      purchaseRequestId: job.purchaseRequestId,
      newValue: { status: 'FAILED', errorCode: failure.code, attemptNo, requiresIntervention: limitReached },
    });
    const operators = await findActiveUserIdsWithRole(tx, 'OPERATOR');
    const label = request?.requestNumber ?? job.purchaseRequestId;
    await notifyUsers(tx, operators, {
      type: 'AUTOMATION_FAILED',
      title: `Automation failed for ${label}`,
      message: `${failure.code}: ${failure.message.slice(0, 300)}`,
      link: `/automation/${job.id}`,
    });
    if (request) {
      await notifyUsers(tx, [request.requesterId], {
        type: 'AUTOMATION_FAILED',
        title: `${label}: purchase order creation failed`,
        message: 'The automation operator has been notified and will handle the failure.',
        link: `/requests/${job.purchaseRequestId}`,
      });
    }
  }

  private async schedulePoll(job: AutomationJob, attemptNo: number, sequence: number, delayOverrideMs?: number): Promise<void> {
    await this.deps.queue.enqueueAutomationPoll(
      { automationJobId: job.id, attemptNo, sequence, correlationId: job.correlationId },
      { delayMs: delayOverrideMs ?? computePollDelayMs(sequence, this.options.pollBaseDelayMs, this.options.pollMaxDelayMs) },
    );
  }

  private async tryStop(job: AutomationJob, attempt: AutomationAttempt, strategy: 'SoftStop' | 'Kill'): Promise<void> {
    if (!this.deps.rpa || !attempt.uipathJobId) return;
    try {
      await this.deps.rpa.stopJob(attempt.uipathJobId, strategy);
      await this.log(job, attempt.attemptNo, 'WARN', 'STOP_REQUESTED', `Requested ${strategy} for UiPath job ${attempt.uipathJobId}`);
    } catch (error) {
      await this.log(job, attempt.attemptNo, 'WARN', 'STOP_FAILED', `Could not stop UiPath job ${attempt.uipathJobId}: ${errorMessage(error)}`);
    }
  }

  private async log(job: AutomationJob, attemptNo: number | null, level: 'INFO' | 'WARN' | 'ERROR', eventType: string, message: string): Promise<void> {
    await writeAutomationLog(this.deps.db, {
      automationJobId: job.id,
      attemptNo,
      level,
      eventType,
      message,
      correlationId: job.correlationId,
    });
    const context = { automationJobId: job.id, attemptNo, eventType };
    if (level === 'ERROR') this.deps.logger.error(message, context);
    else if (level === 'WARN') this.deps.logger.warn(message, context);
    else this.deps.logger.log(message, context);
  }
}

function toFailure(error: unknown, beforeStart: boolean): ExecutionFailure {
  if (isUiPathApiError(error)) {
    return { code: error.kind, message: error.message, retryable: error.retryable, beforeStart };
  }
  return { code: 'UNEXPECTED_ERROR', message: errorMessage(error), retryable: false, beforeStart };
}
