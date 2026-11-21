import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActorContext } from '@orchestra/core';
import type { AuthUser } from './auth-user';

export interface RequestContextData {
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  correlationId(): string | null {
    return storage.getStore()?.correlationId ?? null;
  },
};

/** Builds the audit actor for the current HTTP request. */
export function actorFor(user: AuthUser): ActorContext {
  const context = RequestContext.get();
  return {
    actorId: user.id,
    actorType: 'USER',
    ipAddress: context?.ipAddress ?? null,
    userAgent: context?.userAgent ?? null,
    correlationId: context?.correlationId ?? null,
  };
}

/** Actor for unauthenticated events (e.g. failed logins). */
export function anonymousActor(): ActorContext {
  const context = RequestContext.get();
  return {
    actorId: null,
    actorType: 'USER',
    ipAddress: context?.ipAddress ?? null,
    userAgent: context?.userAgent ?? null,
    correlationId: context?.correlationId ?? null,
  };
}
