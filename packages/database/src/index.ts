import { Prisma, PrismaClient } from '../generated/client';

export * from '../generated/client';

/** Transaction client type (the `tx` argument of `prisma.$transaction(async (tx) => ...)`). */
export type TransactionClient = Prisma.TransactionClient;

/** Anything that can run queries: the root client or a transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

export interface CreatePrismaClientOptions {
  url?: string;
  logQueries?: boolean;
}

export function createPrismaClient(options: CreatePrismaClientOptions = {}): PrismaClient {
  return new PrismaClient({
    ...(options.url ? { datasources: { db: { url: options.url } } } : {}),
    log: options.logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

/** Converts Prisma Decimal / null values to plain numbers for API responses. */
export function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

/** Next value of the request number sequence (created in migration 0001_init). */
export async function nextRequestSequence(db: DbClient): Promise<number> {
  const rows = await db.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('purchase_request_number_seq') AS value`;
  const value = rows[0]?.value;
  if (value === undefined) throw new Error('Could not obtain the next purchase request number');
  return Number(value);
}

/** True when the error is a unique constraint violation (Prisma P2002). */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
