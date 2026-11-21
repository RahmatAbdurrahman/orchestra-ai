import type { Job } from 'bullmq';
import type { JobExecutionContext } from '@orchestra/core';

/** Maps BullMQ delivery bookkeeping to the handler context used by @orchestra/core. */
export function executionContext(job: Job): JobExecutionContext {
  const maxAttempts = job.opts.attempts ?? 1;
  const attempt = job.attemptsMade + 1;
  return { attempt, isFinalAttempt: attempt >= maxAttempts };
}
