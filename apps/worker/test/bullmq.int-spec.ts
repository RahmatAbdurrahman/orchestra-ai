/**
 * BullMQ wiring against a real Redis (REDIS_URL). Skipped when REDIS_URL is
 * not set. Verifies the two properties the reliability design depends on:
 *  - queue job ids de-duplicate repeated enqueues of the same unit of work;
 *  - failed deliveries are retried and the last delivery is flagged as final,
 *    so handlers can record a terminal outcome instead of throwing.
 */
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import {
  BullMqJobQueue,
  createRedisConnection,
  QUEUE_ATTEMPTS,
  QUEUE_NAMES,
  type DocumentJobData,
  type JobExecutionContext,
} from '@orchestra/core';
import { executionContext } from '../src/processors/processor-context';

const redisUrl = process.env.REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis('BullMQ wiring (real Redis)', () => {
  const prefix = `orchestra-test-${randomUUID().slice(0, 8)}`;
  let queue: BullMqJobQueue;
  let worker: Worker<DocumentJobData> | undefined;

  beforeAll(() => {
    queue = new BullMqJobQueue(redisUrl!, prefix);
  });

  afterAll(async () => {
    await worker?.close();
    await queue.close();
  });

  it('de-duplicates job ids and retries failed deliveries up to the final attempt', async () => {
    const seen: Array<{ documentId: string } & JobExecutionContext> = [];
    worker = new Worker<DocumentJobData>(
      QUEUE_NAMES.DOCUMENTS,
      async (job) => {
        const context = executionContext(job);
        seen.push({ documentId: job.data.documentId, ...context });
        if (job.data.documentId === 'flaky' && !context.isFinalAttempt) throw new Error('transient failure');
      },
      { connection: createRedisConnection(redisUrl!), prefix, concurrency: 1 },
    );

    await queue.enqueueDocumentProcessing({ documentId: 'once', run: 1, correlationId: 'c-1' });
    await queue.enqueueDocumentProcessing({ documentId: 'once', run: 1, correlationId: 'c-1' });
    await queue.enqueueDocumentProcessing({ documentId: 'flaky', run: 1, correlationId: 'c-2' });

    const deadline = Date.now() + 100_000;
    while (seen.filter((entry) => entry.documentId === 'flaky').length < QUEUE_ATTEMPTS.document) {
      if (Date.now() > deadline) throw new Error(`timed out: ${JSON.stringify(seen)}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(seen.filter((entry) => entry.documentId === 'once')).toHaveLength(1);
    const flaky = seen.filter((entry) => entry.documentId === 'flaky');
    expect(flaky.map((entry) => entry.attempt)).toEqual([1, 2, 3, 4]);
    expect(flaky.map((entry) => entry.isFinalAttempt)).toEqual([false, false, false, true]);
  }, 120_000);

  it('reports queue health', async () => {
    await expect(queue.health()).resolves.toMatchObject({ ok: true, driver: 'bullmq' });
  });
});
