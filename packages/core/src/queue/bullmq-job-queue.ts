import { QueueJobId } from '@orchestra/domain';
import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type RedisOptions } from 'ioredis';
import {
  JOB_NAMES,
  QUEUE_ATTEMPTS,
  QUEUE_BACKOFF_MS,
  QUEUE_NAMES,
  type AutomationPollJobData,
  type AutomationSubmitJobData,
  type DocumentJobData,
  type EnqueueOptions,
  type JobQueue,
  type QueueHealth,
} from './queue.types';

export function createRedisConnection(redisUrl: string, options: RedisOptions = {}): IORedis {
  // BullMQ requires maxRetriesPerRequest = null for blocking connections.
  return new IORedis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, ...options });
}

function baseOptions(attempts: number, backoffMs: number): JobsOptions {
  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: { age: 24 * 3600, count: 5_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

/**
 * BullMQ producer. Queue job ids are deterministic per unit of work, so
 * enqueuing the same work twice (e.g. API + reconciler) is a no-op while the
 * first job still exists. PostgreSQL remains the source of truth for state.
 */
export class BullMqJobQueue implements JobQueue {
  readonly driver = 'bullmq' as const;
  private readonly connection: IORedis;
  private readonly documents: Queue;
  private readonly automation: Queue;

  constructor(redisUrl: string, prefix = 'orchestra') {
    this.connection = createRedisConnection(redisUrl);
    this.documents = new Queue(QUEUE_NAMES.DOCUMENTS, { connection: this.connection, prefix });
    this.automation = new Queue(QUEUE_NAMES.AUTOMATION, { connection: this.connection, prefix });
  }

  async enqueueDocumentProcessing(data: DocumentJobData, options: EnqueueOptions = {}): Promise<void> {
    await this.documents.add(JOB_NAMES.PROCESS_DOCUMENT, data, {
      ...baseOptions(QUEUE_ATTEMPTS.document, QUEUE_BACKOFF_MS.document),
      jobId: options.jobId ?? QueueJobId.documentProcessing(data.documentId, data.run),
      delay: options.delayMs,
    });
  }

  async enqueueAutomationSubmit(data: AutomationSubmitJobData, options: EnqueueOptions = {}): Promise<void> {
    await this.automation.add(JOB_NAMES.SUBMIT, data, {
      ...baseOptions(QUEUE_ATTEMPTS.submit, QUEUE_BACKOFF_MS.submit),
      jobId: options.jobId ?? QueueJobId.automationSubmit(data.automationJobId, data.attemptNo),
      delay: options.delayMs,
    });
  }

  async enqueueAutomationPoll(data: AutomationPollJobData, options: EnqueueOptions = {}): Promise<void> {
    await this.automation.add(JOB_NAMES.POLL, data, {
      ...baseOptions(QUEUE_ATTEMPTS.poll, QUEUE_BACKOFF_MS.poll),
      jobId: options.jobId ?? QueueJobId.automationPoll(data.automationJobId, data.attemptNo, data.sequence),
      delay: options.delayMs,
    });
  }

  async health(): Promise<QueueHealth> {
    try {
      const pong = await this.connection.ping();
      return { ok: pong === 'PONG', driver: this.driver };
    } catch (error) {
      return { ok: false, driver: this.driver, message: (error as Error).message };
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.documents.close(), this.automation.close()]);
    this.connection.disconnect();
  }
}
