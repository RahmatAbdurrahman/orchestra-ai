export type UiPathErrorKind =
  | 'CONFIGURATION'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'NOT_FOUND'
  | 'PROCESS_NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ROBOT_UNAVAILABLE'
  | 'SERVER'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE';

export interface UiPathApiErrorOptions {
  kind: UiPathErrorKind;
  message: string;
  status?: number;
  /** Safe to try again later. */
  retryable: boolean;
  /**
   * The request may have been processed by Orchestrator even though we did
   * not receive a successful response (timeout, connection reset, 5xx).
   * Callers must check the job reference before submitting again.
   */
  ambiguous: boolean;
  orchestratorErrorCode?: number | string;
  cause?: unknown;
}

export class UiPathApiError extends Error {
  readonly kind: UiPathErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly ambiguous: boolean;
  readonly orchestratorErrorCode?: number | string;

  constructor(options: UiPathApiErrorOptions) {
    super(options.message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'UiPathApiError';
    this.kind = options.kind;
    this.status = options.status;
    this.retryable = options.retryable;
    this.ambiguous = options.ambiguous;
    this.orchestratorErrorCode = options.orchestratorErrorCode;
  }
}

export function isUiPathApiError(error: unknown): error is UiPathApiError {
  return error instanceof UiPathApiError || (error as { name?: string } | null)?.name === 'UiPathApiError';
}

const ROBOT_UNAVAILABLE_PATTERN = /robot|no machine|no license|licen[cs]e.*(available|exceeded)|runtime/i;

/** Maps an HTTP error response from Orchestrator to a typed error. */
export function errorFromResponse(
  status: number,
  body: unknown,
  context: { method: string; path: string },
): UiPathApiError {
  const payload = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const remoteMessage =
    (typeof payload.message === 'string' && payload.message) ||
    (typeof payload.error_description === 'string' && payload.error_description) ||
    (typeof payload.error === 'string' && payload.error) ||
    (typeof body === 'string' && body.slice(0, 300)) ||
    `HTTP ${status}`;
  const orchestratorErrorCode =
    typeof payload.errorCode === 'number' || typeof payload.errorCode === 'string'
      ? (payload.errorCode as number | string)
      : undefined;
  const isMutation = context.method !== 'GET';
  const message = `UiPath ${context.method} ${context.path} failed (${status}): ${remoteMessage}`;

  if (status === 401) {
    return new UiPathApiError({ kind: 'AUTHENTICATION', status, message, retryable: false, ambiguous: false, orchestratorErrorCode });
  }
  if (status === 403) {
    return new UiPathApiError({ kind: 'AUTHORIZATION', status, message, retryable: false, ambiguous: false, orchestratorErrorCode });
  }
  if (status === 404) {
    return new UiPathApiError({ kind: 'NOT_FOUND', status, message, retryable: false, ambiguous: false, orchestratorErrorCode });
  }
  if (status === 409) {
    return new UiPathApiError({ kind: 'CONFLICT', status, message, retryable: false, ambiguous: false, orchestratorErrorCode });
  }
  if (status === 429) {
    return new UiPathApiError({ kind: 'RATE_LIMITED', status, message, retryable: true, ambiguous: false, orchestratorErrorCode });
  }
  if (status >= 500) {
    return new UiPathApiError({ kind: 'SERVER', status, message, retryable: true, ambiguous: isMutation, orchestratorErrorCode });
  }
  if (ROBOT_UNAVAILABLE_PATTERN.test(remoteMessage)) {
    return new UiPathApiError({ kind: 'ROBOT_UNAVAILABLE', status, message, retryable: true, ambiguous: false, orchestratorErrorCode });
  }
  return new UiPathApiError({ kind: 'VALIDATION', status, message, retryable: false, ambiguous: false, orchestratorErrorCode });
}

const DEFINITELY_NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_INVALID_URL']);

/** Maps a transport-level failure (no HTTP response) to a typed error. */
export function errorFromTransport(
  error: unknown,
  context: { method: string; path: string; timeoutMs: number },
): UiPathApiError {
  const isMutation = context.method !== 'GET';
  const name = (error as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new UiPathApiError({
      kind: 'TIMEOUT',
      message: `UiPath ${context.method} ${context.path} timed out after ${context.timeoutMs} ms`,
      retryable: true,
      ambiguous: isMutation,
      cause: error,
    });
  }
  const code = (error as { cause?: { code?: string } } | null)?.cause?.code;
  const notSent = code !== undefined && DEFINITELY_NOT_SENT_CODES.has(code);
  return new UiPathApiError({
    kind: 'NETWORK',
    message: `UiPath ${context.method} ${context.path} failed: ${(error as Error)?.message ?? 'network error'}${code ? ` (${code})` : ''}`,
    retryable: true,
    ambiguous: isMutation && !notSent,
    cause: error,
  });
}
