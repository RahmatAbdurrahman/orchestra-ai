import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).default('bullmq'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().default('orchestra'),
  UPLOAD_DIR: z.string().default('./storage/uploads'),
  SESSION_COOKIE_NAME: z.string().default('oa_session'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  COOKIE_SECURE: booleanString.default('false'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  TRUST_PROXY: booleanString.default('false'),
  SWAGGER_ENABLED: booleanString.default('true'),
  DOCUMENT_INTELLIGENCE_URL: z.string().url().default('http://localhost:8000'),
  DOCUMENT_INTELLIGENCE_TOKEN: z.string().min(16, 'DOCUMENT_INTELLIGENCE_TOKEN must be at least 16 characters'),
  RBAC_ADMIN_CAN_APPROVE: booleanString.default('false'),
  RBAC_ADMIN_CAN_OPERATE_AUTOMATION: booleanString.default('false'),
  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  DEMO_LOGIN_ENABLED: booleanString.default('false'),
});

export type AppConfig = {
  env: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  queue: { driver: 'bullmq' | 'inline'; redisUrl: string; prefix: string };
  uploadDir: string;
  session: { cookieName: string; ttlMs: number; secureCookie: boolean };
  corsOrigins: string[];
  trustProxy: boolean;
  swaggerEnabled: boolean;
  documentIntelligence: { url: string; token: string };
  rbac: { adminCanApprove: boolean; adminCanOperateAutomation: boolean };
  login: { maxFailedAttempts: number; lockoutMs: number };
  reconcileIntervalMs: number;
  /** One-click sign-in as a seeded account, for simulations. Never allowed in production. */
  demoLoginEnabled: boolean;
};

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid API configuration:\n${issues}`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === 'production' && value.QUEUE_DRIVER === 'inline') {
    throw new Error('QUEUE_DRIVER=inline is for development/tests only and is not allowed in production');
  }
  if (value.NODE_ENV === 'production' && value.DEMO_LOGIN_ENABLED) {
    throw new Error('DEMO_LOGIN_ENABLED is for simulations only and is not allowed in production');
  }
  return {
    env: value.NODE_ENV,
    port: value.API_PORT,
    databaseUrl: value.DATABASE_URL,
    queue: { driver: value.QUEUE_DRIVER, redisUrl: value.REDIS_URL, prefix: value.QUEUE_PREFIX },
    uploadDir: value.UPLOAD_DIR,
    session: {
      cookieName: value.SESSION_COOKIE_NAME,
      ttlMs: value.SESSION_TTL_HOURS * 3600_000,
      secureCookie: value.COOKIE_SECURE,
    },
    corsOrigins: value.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    trustProxy: value.TRUST_PROXY,
    swaggerEnabled: value.SWAGGER_ENABLED,
    documentIntelligence: { url: value.DOCUMENT_INTELLIGENCE_URL, token: value.DOCUMENT_INTELLIGENCE_TOKEN },
    rbac: {
      adminCanApprove: value.RBAC_ADMIN_CAN_APPROVE,
      adminCanOperateAutomation: value.RBAC_ADMIN_CAN_OPERATE_AUTOMATION,
    },
    login: { maxFailedAttempts: value.LOGIN_MAX_FAILED_ATTEMPTS, lockoutMs: value.LOGIN_LOCKOUT_MINUTES * 60_000 },
    reconcileIntervalMs: value.RECONCILE_INTERVAL_MS,
    demoLoginEnabled: value.DEMO_LOGIN_ENABLED,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
