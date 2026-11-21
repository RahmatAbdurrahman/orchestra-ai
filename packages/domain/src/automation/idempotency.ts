/**
 * Idempotency key for the business operation "create the purchase order for
 * this purchase request". It is stable across every retry of the same request,
 * so the ERP can refuse to create a second purchase order for it.
 */
export function buildIdempotencyKey(purchaseRequestId: string): string {
  return `oa-po-${purchaseRequestId}`;
}

/**
 * Reference attached to one UiPath job submission (attempt). After an
 * ambiguous failure (e.g. HTTP timeout) Orchestra looks the reference up in
 * Orchestrator before deciding whether to submit again.
 */
export function buildAttemptReference(automationJobId: string, attemptNo: number): string {
  if (!Number.isInteger(attemptNo) || attemptNo < 1) {
    throw new RangeError('attemptNo must be a positive integer');
  }
  return `oa-${automationJobId}-${attemptNo}`;
}

/** BullMQ job ids must be unique per logical unit of work (and must not contain ':'). */
export const QueueJobId = Object.freeze({
  documentProcessing: (documentId: string, run: number) => `doc-${documentId}-${run}`,
  automationSubmit: (automationJobId: string, attemptNo: number) => `submit-${automationJobId}-${attemptNo}`,
  automationPoll: (automationJobId: string, attemptNo: number, sequence: number) =>
    `poll-${automationJobId}-${attemptNo}-${sequence}`,
  /** Re-enqueue issued by the reconciler; `bucket` limits duplicates to one per reconcile window. */
  reconcile: (kind: 'doc' | 'submit' | 'poll', entityId: string, attemptOrRun: number, bucket: number) =>
    `reconcile-${kind}-${entityId}-${attemptOrRun}-${bucket}`,
});

/** Exponential backoff with an upper bound. `attempt` starts at 1. */
export function computeBackoffMs(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxMs, baseMs * 2 ** exponent);
}

/** Poll interval that grows slowly while a robot job is pending or running. */
export function computePollDelayMs(sequence: number, baseMs = 3_000, maxMs = 30_000): number {
  return Math.min(maxMs, Math.round(baseMs * 1.5 ** Math.max(0, sequence - 1)));
}
