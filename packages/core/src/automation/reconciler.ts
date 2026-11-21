import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@orchestra/database';
import { QueueJobId } from '@orchestra/domain';
import { systemActor } from '../actor';
import { errorMessage, type CoreLogger } from '../logger';
import type { JobQueue } from '../queue/queue.types';
import { runInTransaction } from '../transaction';
import { lockPurchaseRequest, transitionPurchaseRequest } from '../workflow/transitions';

export interface ReconcilerOptions {
  /** QUEUED jobs untouched for this long are (re-)enqueued. */
  queuedGraceMs: number;
  /** SUBMITTING jobs untouched for this long are considered interrupted. */
  submitLeaseMs: number;
  /** PENDING/RUNNING jobs not polled for this long get a new poll. */
  pollStaleMs: number;
  /** Documents stuck in QUEUED/PROCESSING for this long are re-enqueued. */
  documentStaleMs: number;
  /** Width of the de-duplication window for reconciler messages. */
  bucketMs: number;
  batchSize: number;
}

export const DEFAULT_RECONCILER_OPTIONS: ReconcilerOptions = Object.freeze({
  queuedGraceMs: 30_000,
  submitLeaseMs: 120_000,
  pollStaleMs: 90_000,
  documentStaleMs: 5 * 60_000,
  bucketMs: 60_000,
  batchSize: 100,
});

export interface ReconcileSummary {
  queuedJobs: number;
  interruptedSubmissions: number;
  stalePolls: number;
  staleDocuments: number;
  recoveredRequests: number;
}

/**
 * Restart recovery (SAD 17): PostgreSQL holds the real state, so after a
 * worker or Redis restart the reconciler re-creates the queue messages that
 * may have been lost. Every handler is idempotent (compare-and-set), so a
 * duplicate message is harmless.
 */
export class Reconciler {
  private readonly options: ReconcilerOptions;
  private readonly now: () => Date;

  constructor(
    private readonly deps: {
      db: PrismaClient;
      queue: JobQueue;
      logger: CoreLogger;
      options?: Partial<ReconcilerOptions>;
      now?: () => Date;
    },
  ) {
    this.options = { ...DEFAULT_RECONCILER_OPTIONS, ...deps.options };
    this.now = deps.now ?? (() => new Date());
  }

  async reconcile(): Promise<ReconcileSummary> {
    const { db, queue } = this.deps;
    const now = this.now();
    const at = (msAgo: number) => new Date(now.getTime() - msAgo);
    const bucket = Math.floor(now.getTime() / this.options.bucketMs);
    const take = this.options.batchSize;
    const summary: ReconcileSummary = {
      queuedJobs: 0,
      interruptedSubmissions: 0,
      stalePolls: 0,
      staleDocuments: 0,
      recoveredRequests: 0,
    };

    const queued = await db.automationJob.findMany({
      where: {
        status: 'QUEUED',
        updatedAt: { lt: at(this.options.queuedGraceMs) },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true, attemptCount: true, correlationId: true },
      take,
    });
    for (const job of queued) {
      await queue.enqueueAutomationSubmit(
        { automationJobId: job.id, attemptNo: job.attemptCount + 1, correlationId: job.correlationId },
        { jobId: QueueJobId.reconcile('submit', job.id, job.attemptCount + 1, bucket) },
      );
      summary.queuedJobs += 1;
    }

    const submitting = await db.automationJob.findMany({
      where: { status: 'SUBMITTING', updatedAt: { lt: at(this.options.submitLeaseMs) } },
      select: { id: true, attemptCount: true, correlationId: true },
      take,
    });
    for (const job of submitting) {
      await queue.enqueueAutomationSubmit(
        { automationJobId: job.id, attemptNo: job.attemptCount, correlationId: job.correlationId },
        { jobId: QueueJobId.reconcile('submit', job.id, job.attemptCount, bucket) },
      );
      summary.interruptedSubmissions += 1;
    }

    const monitoring = await db.automationJob.findMany({
      where: {
        status: { in: ['PENDING', 'RUNNING'] },
        OR: [
          { lastPolledAt: null, updatedAt: { lt: at(this.options.pollStaleMs) } },
          { lastPolledAt: { lt: at(this.options.pollStaleMs) } },
        ],
      },
      select: { id: true, attemptCount: true, correlationId: true },
      take,
    });
    for (const job of monitoring) {
      await queue.enqueueAutomationPoll(
        { automationJobId: job.id, attemptNo: job.attemptCount, sequence: 1, correlationId: job.correlationId },
        { jobId: QueueJobId.reconcile('poll', job.id, job.attemptCount, bucket) },
      );
      summary.stalePolls += 1;
    }

    const documents = await db.document.findMany({
      where: {
        processingStatus: { in: ['QUEUED', 'PROCESSING'] },
        updatedAt: { lt: at(this.options.documentStaleMs) },
      },
      select: { id: true, processingRun: true },
      take,
    });
    for (const document of documents) {
      await queue.enqueueDocumentProcessing(
        { documentId: document.id, run: document.processingRun, correlationId: randomUUID() },
        { jobId: QueueJobId.reconcile('doc', document.id, document.processingRun, bucket) },
      );
      summary.staleDocuments += 1;
    }

    const stuck = await db.purchaseRequest.findMany({
      where: {
        status: 'PROCESSING_DOCUMENT',
        updatedAt: { lt: at(this.options.documentStaleMs) },
        documents: { none: { processingStatus: { in: ['QUEUED', 'PROCESSING'] } } },
      },
      select: { id: true },
      take,
    });
    for (const request of stuck) {
      try {
        const moved = await runInTransaction(db, async (tx) => {
          await lockPurchaseRequest(tx, request.id);
          const pending = await tx.document.count({
            where: { purchaseRequestId: request.id, processingStatus: { in: ['QUEUED', 'PROCESSING'] } },
          });
          const current = await tx.purchaseRequest.findUnique({ where: { id: request.id }, select: { status: true } });
          if (pending > 0 || current?.status !== 'PROCESSING_DOCUMENT') return false;
          await transitionPurchaseRequest(tx, {
            purchaseRequestId: request.id,
            from: 'PROCESSING_DOCUMENT',
            to: 'NEEDS_VERIFICATION',
            actor: systemActor(),
            reason: 'Recovered by the reconciler: no document is being processed',
          });
          return true;
        });
        if (moved) summary.recoveredRequests += 1;
      } catch (error) {
        this.deps.logger.warn('Could not recover purchase request', { purchaseRequestId: request.id, error: errorMessage(error) });
      }
    }

    const total = Object.values(summary).reduce((sum, value) => sum + value, 0);
    if (total > 0) this.deps.logger.log('Reconciliation enqueued work', { ...summary });
    return summary;
  }
}
