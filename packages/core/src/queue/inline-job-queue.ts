import { computeBackoffMs, QueueJobId } from '@orchestra/domain';
import { errorMessage, type CoreLogger } from '../logger';
import {
  QUEUE_ATTEMPTS,
  QUEUE_BACKOFF_MS,
  type AutomationPollJobData,
  type AutomationSubmitJobData,
  type DocumentJobData,
  type EnqueueOptions,
  type JobHandlers,
  type JobQueue,
  type QueueHealth,
} from './queue.types';

type Kind = 'document' | 'submit' | 'poll';

/**
 * In-process queue for local development and automated tests WITHOUT Redis.
 *
 * It runs the same job handlers as the BullMQ worker, with the same retry
 * semantics, but messages live in memory: anything pending is lost on restart
 * and is recovered by the reconciler from PostgreSQL. Never use it in
 * production (QUEUE_DRIVER=bullmq is the default).
 */
export class InlineJobQueue implements JobQueue {
  readonly driver = 'inline' as const;
  private handlers: JobHandlers | null = null;
  private readonly seen = new Map<string, number>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly inFlight = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly logger: CoreLogger,
    private readonly backoffScale = 1,
  ) {}

  registerHandlers(handlers: JobHandlers): void {
    this.handlers = handlers;
  }

  async enqueueDocumentProcessing(data: DocumentJobData, options: EnqueueOptions = {}): Promise<void> {
    this.schedule('document', options.jobId ?? QueueJobId.documentProcessing(data.documentId, data.run), data, options.delayMs ?? 0, 1);
  }

  async enqueueAutomationSubmit(data: AutomationSubmitJobData, options: EnqueueOptions = {}): Promise<void> {
    this.schedule('submit', options.jobId ?? QueueJobId.automationSubmit(data.automationJobId, data.attemptNo), data, options.delayMs ?? 0, 1);
  }

  async enqueueAutomationPoll(data: AutomationPollJobData, options: EnqueueOptions = {}): Promise<void> {
    this.schedule(
      'poll',
      options.jobId ?? QueueJobId.automationPoll(data.automationJobId, data.attemptNo, data.sequence),
      data,
      options.delayMs ?? 0,
      1,
    );
  }

  async health(): Promise<QueueHealth> {
    return { ok: !this.closed, driver: this.driver, message: 'In-process queue (development/test only)' };
  }

  /** Resolves when no job is running or scheduled (used by tests). */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.timers.size > 0 || this.inFlight.size > 0) {
      if (Date.now() > deadline) throw new Error('InlineJobQueue.drain timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.inFlight]);
  }

  private schedule(kind: Kind, jobId: string, data: unknown, delayMs: number, attempt: number): void {
    if (this.closed) return;
    if (attempt === 1) {
      this.prune();
      if (this.seen.has(jobId)) return; // same de-duplication as BullMQ job ids
      this.seen.set(jobId, Date.now());
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = this.execute(kind, jobId, data, attempt).finally(() => this.inFlight.delete(run));
      this.inFlight.add(run);
    }, Math.max(0, delayMs));
    this.timers.add(timer);
  }

  private async execute(kind: Kind, jobId: string, data: unknown, attempt: number): Promise<void> {
    if (!this.handlers) {
      this.logger.error('InlineJobQueue has no handlers registered', { jobId });
      return;
    }
    const maxAttempts = QUEUE_ATTEMPTS[kind];
    const context = { attempt, isFinalAttempt: attempt >= maxAttempts };
    try {
      if (kind === 'document') await this.handlers.processDocument(data as DocumentJobData, context);
      else if (kind === 'submit') await this.handlers.submitAutomation(data as AutomationSubmitJobData, context);
      else await this.handlers.pollAutomation(data as AutomationPollJobData, context);
    } catch (error) {
      if (context.isFinalAttempt) {
        this.logger.error('Inline job failed permanently', { jobId, attempt, error: errorMessage(error) });
        return;
      }
      const delay = computeBackoffMs(attempt, QUEUE_BACKOFF_MS[kind], 60_000) * this.backoffScale;
      this.logger.warn('Inline job failed, retrying', { jobId, attempt, delayMs: delay, error: errorMessage(error) });
      this.schedule(kind, jobId, data, delay, attempt + 1);
    }
  }

  private prune(): void {
    if (this.seen.size < 5_000) return;
    const cutoff = Date.now() - 3600_000;
    for (const [jobId, at] of this.seen) if (at < cutoff) this.seen.delete(jobId);
  }
}
