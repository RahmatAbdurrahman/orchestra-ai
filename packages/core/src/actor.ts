import type { ActorType } from '@orchestra/domain';

/** Who performed an action, plus request metadata recorded in the audit trail. */
export interface ActorContext {
  actorId: string | null;
  actorType: ActorType;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export function systemActor(correlationId?: string | null): ActorContext {
  return { actorId: null, actorType: 'SYSTEM', correlationId: correlationId ?? null };
}

export function robotActor(correlationId?: string | null): ActorContext {
  return { actorId: null, actorType: 'ROBOT', correlationId: correlationId ?? null };
}

export function userActor(
  userId: string,
  extras: { ipAddress?: string | null; userAgent?: string | null; correlationId?: string | null } = {},
): ActorContext {
  return { actorId: userId, actorType: 'USER', ...extras };
}
