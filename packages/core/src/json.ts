import type { Prisma } from '@orchestra/database';

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|credential/i;

/**
 * Converts an arbitrary value into a JSON value suitable for a Prisma Json
 * column. Undefined values are dropped, Decimals/Dates become strings and
 * keys that look like secrets are redacted (defense in depth for the audit log).
 */
export function toJsonValue(value: unknown, options: { redact?: boolean } = {}): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  const redact = options.redact ?? true;
  const serialized = JSON.stringify(value, (key, current: unknown) => {
    if (redact && key && SENSITIVE_KEY.test(key) && current !== null && current !== undefined) return '[REDACTED]';
    if (typeof current === 'bigint') return current.toString();
    return current;
  });
  if (serialized === undefined) return undefined;
  const parsed: unknown = JSON.parse(serialized);
  return parsed === null ? undefined : (parsed as Prisma.InputJsonValue);
}
