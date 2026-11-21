export const QUEUE_NAMES = Object.freeze({
  DOCUMENTS: 'document-processing',
  AUTOMATION: 'automation',
} as const);

export const JOB_NAMES = Object.freeze({
  PROCESS_DOCUMENT: 'process-document',
  SUBMIT: 'submit',
  POLL: 'poll',
} as const);

export interface DocumentJobData {
  documentId: string;
  run: number;
  correlationId: string;
}

export interface AutomationSubmitJobData {
  automationJobId: string;
  /** Attempt number this message is meant to create (attemptCount + 1 at enqueue time). */
  attemptNo: number;
  correlationId: string;
  triggeredById?: string | null;
}

export interface AutomationPollJobData {
  automationJobId: string;
  attemptNo: number;
  sequence: number;
  correlationId: string;
}

export interface EnqueueOptions {
  delayMs?: number;
  /** Overrides the default queue job id (used by the reconciler). */
  jobId?: string;
}

export interface JobExecutionContext {
  /** 1-based delivery attempt of this queue message. */
  attempt: number;
  /** True on the last delivery: handlers must record a terminal outcome instead of throwing. */
  isFinalAttempt: boolean;
}

export interface JobHandlers {
  processDocument(data: DocumentJobData, context: JobExecutionContext): Promise<void>;
  submitAutomation(data: AutomationSubmitJobData, context: JobExecutionContext): Promise<void>;
  pollAutomation(data: AutomationPollJobData, context: JobExecutionContext): Promise<void>;
}

export interface QueueHealth {
  ok: boolean;
  driver: 'bullmq' | 'inline';
  message?: string;
}

/** Producer side of the background queues (the "port"; BullMQ is the production adapter). */
export interface JobQueue {
  readonly driver: 'bullmq' | 'inline';
  enqueueDocumentProcessing(data: DocumentJobData, options?: EnqueueOptions): Promise<void>;
  enqueueAutomationSubmit(data: AutomationSubmitJobData, options?: EnqueueOptions): Promise<void>;
  enqueueAutomationPoll(data: AutomationPollJobData, options?: EnqueueOptions): Promise<void>;
  health(): Promise<QueueHealth>;
  close(): Promise<void>;
}

/** Delivery attempts per queue message (BullMQ `attempts`). */
export const QUEUE_ATTEMPTS = Object.freeze({
  document: 4,
  submit: 4,
  poll: 5,
});

export const QUEUE_BACKOFF_MS = Object.freeze({
  document: 5_000,
  submit: 5_000,
  poll: 3_000,
});
