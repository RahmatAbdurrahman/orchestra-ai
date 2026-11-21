import type { AutomationJobStatus, PurchaseRequestStatus } from '../enums';
import { InvalidTransitionError } from '../errors';

/**
 * Allowed purchase request status transitions (SAD section 16).
 *
 * Notes on the edges that are not drawn in the high level diagram:
 * - SUBMITTED -> PENDING_APPROVAL: workflows that do not require a supporting
 *   document skip the document stages.
 * - QUEUED -> FAILED: the job could not be submitted to UiPath (or no robot
 *   picked it up) after the automatic retry budget was used.
 * - FAILED -> CANCELLED: an operator abandons a failed job.
 * - cancellation is only possible before the request is approved.
 */
export const PURCHASE_REQUEST_TRANSITIONS: Readonly<
  Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>
> = Object.freeze({
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PROCESSING_DOCUMENT', 'PENDING_APPROVAL', 'CANCELLED'],
  PROCESSING_DOCUMENT: ['NEEDS_VERIFICATION', 'CANCELLED'],
  NEEDS_VERIFICATION: ['PROCESSING_DOCUMENT', 'PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['QUEUED'],
  QUEUED: ['RUNNING', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  FAILED: ['QUEUED', 'CANCELLED'],
  REJECTED: [],
  COMPLETED: [],
  CANCELLED: [],
});

export const TERMINAL_PURCHASE_REQUEST_STATUSES: readonly PurchaseRequestStatus[] = [
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
];

/** Statuses in which the requester may withdraw (cancel) their own request. */
export const REQUESTER_CANCELLABLE_STATUSES: readonly PurchaseRequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING_DOCUMENT',
  'NEEDS_VERIFICATION',
  'PENDING_APPROVAL',
];

/** Statuses that count as "in flight" (committed against budget, blocking duplicates). */
export const ACTIVE_PURCHASE_REQUEST_STATUSES: readonly PurchaseRequestStatus[] = [
  'SUBMITTED',
  'PROCESSING_DOCUMENT',
  'NEEDS_VERIFICATION',
  'PENDING_APPROVAL',
  'APPROVED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
];

/** Statuses whose amount is committed against the department budget. */
export const BUDGET_COMMITTED_STATUSES: readonly PurchaseRequestStatus[] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
];

export function canTransitionPurchaseRequest(
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): boolean {
  return PURCHASE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertPurchaseRequestTransition(
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): void {
  if (!canTransitionPurchaseRequest(from, to)) {
    throw new InvalidTransitionError('Purchase request', from, to);
  }
}

export function isTerminalPurchaseRequestStatus(status: PurchaseRequestStatus): boolean {
  return TERMINAL_PURCHASE_REQUEST_STATUSES.includes(status);
}

/**
 * Automation job lifecycle. A job represents "create the purchase order for
 * this request" and may span several UiPath job attempts.
 */
export const AUTOMATION_JOB_TRANSITIONS: Readonly<
  Record<AutomationJobStatus, readonly AutomationJobStatus[]>
> = Object.freeze({
  QUEUED: ['SUBMITTING', 'FAILED'],
  SUBMITTING: ['PENDING', 'QUEUED', 'FAILED'],
  PENDING: ['RUNNING', 'COMPLETED', 'QUEUED', 'FAILED'],
  RUNNING: ['COMPLETED', 'FAILED'],
  FAILED: ['QUEUED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
});

export function canTransitionAutomationJob(
  from: AutomationJobStatus,
  to: AutomationJobStatus,
): boolean {
  return AUTOMATION_JOB_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertAutomationJobTransition(
  from: AutomationJobStatus,
  to: AutomationJobStatus,
): void {
  if (!canTransitionAutomationJob(from, to)) {
    throw new InvalidTransitionError('Automation job', from, to);
  }
}

export const ACTIVE_AUTOMATION_JOB_STATUSES: readonly AutomationJobStatus[] = [
  'QUEUED',
  'SUBMITTING',
  'PENDING',
  'RUNNING',
];

/** Business status the purchase request should have for a given job status. */
export function purchaseRequestStatusForJob(status: AutomationJobStatus): PurchaseRequestStatus {
  switch (status) {
    case 'QUEUED':
    case 'SUBMITTING':
    case 'PENDING':
      return 'QUEUED';
    case 'RUNNING':
      return 'RUNNING';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}

/**
 * Shortest valid path between two purchase request statuses (breadth first).
 * Used when the system observes an external state that skips an intermediate
 * status (e.g. a robot job finished between two polls, QUEUED -> COMPLETED),
 * so every intermediate transition is still recorded and audited.
 */
export function purchaseRequestTransitionPath(
  from: PurchaseRequestStatus,
  to: PurchaseRequestStatus,
): PurchaseRequestStatus[] | null {
  if (from === to) return [];
  const queue: PurchaseRequestStatus[][] = [[from]];
  const visited = new Set<PurchaseRequestStatus>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    for (const next of PURCHASE_REQUEST_TRANSITIONS[last]) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === to) return candidate.slice(1);
      visited.add(next);
      queue.push(candidate);
    }
  }
  return null;
}
