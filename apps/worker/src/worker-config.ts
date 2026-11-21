import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().default('orchestra'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  DOCUMENT_INTELLIGENCE_URL: z.string().url().default('http://localhost:8000'),
  DOCUMENT_INTELLIGENCE_TOKEN: z.string().min(16),
  WORKER_DOCUMENT_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  WORKER_AUTOMATION_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(0).default(4001),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid worker configuration:\n${issues}`);
  }
  return parsed.data;
}

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
