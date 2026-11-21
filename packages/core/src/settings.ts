import type { AutomationExecutorOptions } from './automation/automation-executor';
import type { ReconcilerOptions } from './automation/reconciler';

function numberFromEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

/** Optional overrides (mainly for tests and demos) of the executor timings. */
export function automationExecutorOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<AutomationExecutorOptions> {
  return compact({
    submitLeaseMs: numberFromEnv(env, 'AUTOMATION_SUBMIT_LEASE_MS'),
    unconfirmedSubmissionTimeoutMs: numberFromEnv(env, 'AUTOMATION_UNCONFIRMED_TIMEOUT_MS'),
    autoRetryBaseDelayMs: numberFromEnv(env, 'AUTOMATION_RETRY_BASE_DELAY_MS'),
    autoRetryMaxDelayMs: numberFromEnv(env, 'AUTOMATION_RETRY_MAX_DELAY_MS'),
    pollBaseDelayMs: numberFromEnv(env, 'AUTOMATION_POLL_BASE_DELAY_MS'),
    pollMaxDelayMs: numberFromEnv(env, 'AUTOMATION_POLL_MAX_DELAY_MS'),
  });
}

export function reconcilerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<ReconcilerOptions> {
  return compact({
    queuedGraceMs: numberFromEnv(env, 'RECONCILE_QUEUED_GRACE_MS'),
    submitLeaseMs: numberFromEnv(env, 'AUTOMATION_SUBMIT_LEASE_MS'),
    pollStaleMs: numberFromEnv(env, 'RECONCILE_POLL_STALE_MS'),
    documentStaleMs: numberFromEnv(env, 'RECONCILE_DOCUMENT_STALE_MS'),
  });
}

export function inlineQueueBackoffScaleFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  return numberFromEnv(env, 'INLINE_QUEUE_BACKOFF_SCALE') ?? 1;
}
