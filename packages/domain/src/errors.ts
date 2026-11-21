export const DOMAIN_ERROR_CODES = [
  'INVALID_TRANSITION',
  'CONFLICT',
  'NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'BUSINESS_RULE_VIOLATION',
  'RETRY_LIMIT_REACHED',
  'PRECONDITION_FAILED',
] as const;
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

/**
 * Base class for expected, business-level failures. The API layer maps these
 * to HTTP responses; anything that is not a DomainError is treated as an
 * unexpected (500) error.
 */
export class DomainError extends Error {
  readonly isDomainError = true as const;

  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isDomainError?: unknown }).isDomainError === true &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

export class InvalidTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super('INVALID_TRANSITION', `${entity} cannot move from ${from} to ${to}`, { entity, from, to });
  }
}

export class ConcurrencyConflictError extends DomainError {
  constructor(message = 'The record was modified by another operation. Reload and try again.') {
    super('CONFLICT', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super('NOT_FOUND', id ? `${entity} ${id} was not found` : `${entity} was not found`, { entity, id });
  }
}

export class ForbiddenActionError extends DomainError {
  constructor(message = 'You are not allowed to perform this action') {
    super('FORBIDDEN', message);
  }
}
