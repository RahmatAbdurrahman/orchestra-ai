/** Thin fetch wrapper for the Orchestra API (same-origin, proxied by app/api/v1/[...path]). */
export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly correlationId?: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

export async function api<T>(path: string, options: { method?: string; body?: Body; query?: Record<string, unknown> } = {}): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const isForm = options.body instanceof FormData;
  const response = await fetch(url.pathname + url.search, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: isForm ? undefined : options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: isForm ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown; correlationId?: string } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'ERROR',
      error?.message ?? `Request failed (${response.status})`,
      error?.details,
      error?.correlationId ?? response.headers.get('x-correlation-id'),
    );
  }
  return payload as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Human readable message for toasts, including validation details. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (Array.isArray(error.details) && error.details.length > 0) {
      return `${error.message}: ${error.details.slice(0, 3).join('; ')}`;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong';
}
