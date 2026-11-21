import type { PrismaClient, TransactionClient } from '@orchestra/database';

export const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 10_000, timeout: 20_000 });

/** Interactive transaction with project-wide timeouts. */
export function runInTransaction<T>(db: PrismaClient, fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(fn, TRANSACTION_OPTIONS);
}
