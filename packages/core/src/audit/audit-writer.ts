import type { DbClient } from '@orchestra/database';
import type { ActorContext } from '../actor';
import { toJsonValue } from '../json';

export interface AuditEntryInput {
  action: string;
  entityType: string;
  entityId: string;
  purchaseRequestId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
}

/**
 * Appends an audit event. This is the only write path to audit_logs; the
 * table additionally rejects UPDATE/DELETE at the database level.
 * Pass the transaction client so the event commits atomically with the change.
 */
export async function writeAudit(db: DbClient, actor: ActorContext, entry: AuditEntryInput): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: actor.actorType === 'USER' ? actor.actorId : null,
      actorType: actor.actorType,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      purchaseRequestId: entry.purchaseRequestId ?? null,
      oldValue: toJsonValue(entry.oldValue),
      newValue: toJsonValue(entry.newValue),
      metadata: toJsonValue(entry.metadata),
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ? actor.userAgent.slice(0, 512) : null,
      correlationId: actor.correlationId ?? null,
    },
  });
}
