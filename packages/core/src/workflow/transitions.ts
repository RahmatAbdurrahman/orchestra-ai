import type { DbClient, Prisma } from '@orchestra/database';
import {
  assertPurchaseRequestTransition,
  AuditAction,
  AuditEntity,
  ConcurrencyConflictError,
  InvalidTransitionError,
  NotFoundError,
  purchaseRequestTransitionPath,
  type PurchaseRequestStatus,
} from '@orchestra/domain';
import type { ActorContext } from '../actor';
import { writeAudit } from '../audit/audit-writer';

export interface PurchaseRequestTransitionInput {
  purchaseRequestId: string;
  /** Status the caller expects the request to be in (compare-and-set). */
  from: PurchaseRequestStatus;
  to: PurchaseRequestStatus;
  actor: ActorContext;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  /** Additional columns to update atomically with the status change. */
  data?: Omit<Prisma.PurchaseRequestUpdateManyMutationInput, 'status'>;
  now?: Date;
}

function timestampsFor(status: PurchaseRequestStatus, now: Date): Prisma.PurchaseRequestUpdateManyMutationInput {
  switch (status) {
    case 'SUBMITTED':
      return { submittedAt: now };
    case 'APPROVED':
      return { approvedAt: now };
    case 'COMPLETED':
      return { completedAt: now };
    case 'CANCELLED':
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * Moves a purchase request to a new status.
 *
 * - The transition is validated against the state machine.
 * - The update is a compare-and-set on the expected current status, so two
 *   concurrent actors can never both apply a transition (the loser gets a
 *   ConcurrencyConflictError).
 * - Every transition writes an audit event in the same transaction.
 */
export async function transitionPurchaseRequest(
  tx: DbClient,
  input: PurchaseRequestTransitionInput,
): Promise<void> {
  assertPurchaseRequestTransition(input.from, input.to);
  const now = input.now ?? new Date();
  const result = await tx.purchaseRequest.updateMany({
    where: { id: input.purchaseRequestId, status: input.from },
    data: {
      ...input.data,
      ...timestampsFor(input.to, now),
      ...(input.reason !== undefined ? { statusReason: input.reason } : {}),
      status: input.to,
    },
  });
  if (result.count !== 1) {
    const current = await tx.purchaseRequest.findUnique({
      where: { id: input.purchaseRequestId },
      select: { status: true },
    });
    if (!current) throw new NotFoundError('Purchase request', input.purchaseRequestId);
    throw new ConcurrencyConflictError(
      `Purchase request is ${current.status}; expected ${input.from} to move it to ${input.to}`,
    );
  }
  await writeAudit(tx, input.actor, {
    action: AuditAction.REQUEST_STATUS_CHANGED,
    entityType: AuditEntity.PURCHASE_REQUEST,
    entityId: input.purchaseRequestId,
    purchaseRequestId: input.purchaseRequestId,
    oldValue: { status: input.from },
    newValue: { status: input.to },
    metadata: { ...(input.reason ? { reason: input.reason } : {}), ...input.metadata },
  });
}

/**
 * Moves a request to `to` through every intermediate status required by the
 * state machine (e.g. QUEUED -> RUNNING -> COMPLETED when a robot finished
 * between two polls). `data` is applied on the final step only.
 */
export async function transitionPurchaseRequestVia(
  tx: DbClient,
  input: PurchaseRequestTransitionInput,
): Promise<void> {
  const path = purchaseRequestTransitionPath(input.from, input.to);
  if (path === null) throw new InvalidTransitionError('Purchase request', input.from, input.to);
  let current = input.from;
  for (const [index, next] of path.entries()) {
    const isLast = index === path.length - 1;
    await transitionPurchaseRequest(tx, {
      ...input,
      from: current,
      to: next,
      data: isLast ? input.data : undefined,
      reason: isLast ? input.reason : undefined,
    });
    current = next;
  }
}

/** Locks the purchase request row until the end of the transaction (SELECT ... FOR UPDATE). */
export async function lockPurchaseRequest(tx: DbClient, purchaseRequestId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM purchase_requests WHERE id = ${purchaseRequestId}::uuid FOR UPDATE`;
}
