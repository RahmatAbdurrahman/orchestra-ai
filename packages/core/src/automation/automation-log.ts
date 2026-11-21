import type { DbClient } from '@orchestra/database';
import { toJsonValue } from '../json';

export type AutomationLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface AutomationLogEntry {
  automationJobId: string;
  attemptNo?: number | null;
  level: AutomationLogLevel;
  eventType: string;
  message: string;
  metadata?: unknown;
  correlationId?: string | null;
}

/** Operational execution log shown to operators (separate from the audit trail). */
export async function writeAutomationLog(db: DbClient, entry: AutomationLogEntry): Promise<void> {
  await db.automationLog.create({
    data: {
      automationJobId: entry.automationJobId,
      attemptNo: entry.attemptNo ?? null,
      level: entry.level,
      eventType: entry.eventType,
      message: entry.message.slice(0, 4000),
      metadata: toJsonValue(entry.metadata),
      correlationId: entry.correlationId ?? null,
    },
  });
}
