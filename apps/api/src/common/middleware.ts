import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns a correlation id to every request (accepting a well-formed incoming
 * X-Correlation-Id), exposes it in the response and stores it in the request
 * context so audit events, logs and robot jobs can be traced end to end.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-correlation-id');
  const correlationId = incoming && CORRELATION_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Correlation-Id', correlationId);
  RequestContext.run(
    {
      correlationId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    },
    next,
  );
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense in depth (the session cookie is also SameSite=Lax): state
 * changing requests that carry an Origin header must come from an allowed
 * origin.
 */
export function originCheckMiddleware(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.header('origin');
    if (!origin) return next(); // non-browser clients (curl, service-to-service)
    if (allowed.has(origin)) return next();
    const host = req.header('host');
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return next();
    res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Cross-origin request rejected', correlationId: RequestContext.correlationId() },
    });
  };
}
