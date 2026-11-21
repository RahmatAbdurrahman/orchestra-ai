/**
 * Domain enumerations.
 *
 * Values are plain strings so they are structurally compatible with the
 * Prisma-generated enums (same names) while keeping this package free of any
 * database or framework dependency (it is also consumed by the web app).
 */
function defineEnum<const T extends readonly string[]>(values: T): { readonly [K in T[number]]: K } {
  return Object.freeze(Object.fromEntries(values.map((value) => [value, value]))) as {
    readonly [K in T[number]]: K;
  };
}

export const ROLE_NAMES = ['ADMIN', 'REQUESTER', 'APPROVER', 'OPERATOR', 'VIEWER'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
export const RoleName = defineEnum(ROLE_NAMES);

export const PURCHASE_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PROCESSING_DOCUMENT',
  'NEEDS_VERIFICATION',
  'PENDING_APPROVAL',
  'REJECTED',
  'APPROVED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];
export const PurchaseRequestStatus = defineEnum(PURCHASE_REQUEST_STATUSES);

export const DOCUMENT_PROCESSING_STATUSES = [
  'UPLOADED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'VERIFIED',
] as const;
export type DocumentProcessingStatus = (typeof DOCUMENT_PROCESSING_STATUSES)[number];
export const DocumentProcessingStatus = defineEnum(DOCUMENT_PROCESSING_STATUSES);

export const APPROVAL_DECISIONS = ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const ApprovalDecision = defineEnum(APPROVAL_DECISIONS);

export const APPROVAL_GROUPS = ['DEPARTMENT', 'FINANCE'] as const;
export type ApprovalGroup = (typeof APPROVAL_GROUPS)[number];
export const ApprovalGroup = defineEnum(APPROVAL_GROUPS);

export const AUTOMATION_JOB_STATUSES = [
  'QUEUED',
  'SUBMITTING',
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type AutomationJobStatus = (typeof AUTOMATION_JOB_STATUSES)[number];
export const AutomationJobStatus = defineEnum(AUTOMATION_JOB_STATUSES);

export const AUTOMATION_ATTEMPT_STATUSES = [
  'SUBMITTING',
  'PENDING',
  'RUNNING',
  'SUCCESSFUL',
  'FAULTED',
  'STOPPED',
  'SUBMIT_FAILED',
] as const;
export type AutomationAttemptStatus = (typeof AUTOMATION_ATTEMPT_STATUSES)[number];
export const AutomationAttemptStatus = defineEnum(AUTOMATION_ATTEMPT_STATUSES);

export const NOTIFICATION_TYPES = [
  'INFO',
  'APPROVAL_REQUIRED',
  'REQUEST_APPROVED',
  'REQUEST_REJECTED',
  'DOCUMENT_PROCESSED',
  'AUTOMATION_COMPLETED',
  'AUTOMATION_FAILED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
export const NotificationType = defineEnum(NOTIFICATION_TYPES);

export const ACTOR_TYPES = ['USER', 'SYSTEM', 'ROBOT'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
export const ActorType = defineEnum(ACTOR_TYPES);

export const WORKFLOW_TYPES = ['PURCHASE_REQUEST'] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];
export const WorkflowType = defineEnum(WORKFLOW_TYPES);

/** Audit entity types used across the platform. */
export const AuditEntity = Object.freeze({
  USER: 'User',
  SESSION: 'Session',
  WORKFLOW: 'Workflow',
  PURCHASE_REQUEST: 'PurchaseRequest',
  DOCUMENT: 'Document',
  APPROVAL: 'Approval',
  AUTOMATION_JOB: 'AutomationJob',
  INTEGRATION: 'Integration',
  SUPPLIER: 'Supplier',
} as const);
export type AuditEntity = (typeof AuditEntity)[keyof typeof AuditEntity];

/** Audit action names. Kept in one place so dashboards and filters stay consistent. */
export const AuditAction = Object.freeze({
  AUTH_LOGIN_SUCCEEDED: 'AUTH.LOGIN_SUCCEEDED',
  AUTH_LOGIN_FAILED: 'AUTH.LOGIN_FAILED',
  AUTH_LOGOUT: 'AUTH.LOGOUT',
  AUTH_PASSWORD_CHANGED: 'AUTH.PASSWORD_CHANGED',
  USER_CREATED: 'USER.CREATED',
  USER_UPDATED: 'USER.UPDATED',
  USER_ACTIVATED: 'USER.ACTIVATED',
  USER_DEACTIVATED: 'USER.DEACTIVATED',
  WORKFLOW_CREATED: 'WORKFLOW.CREATED',
  WORKFLOW_UPDATED: 'WORKFLOW.UPDATED',
  WORKFLOW_ACTIVATED: 'WORKFLOW.ACTIVATED',
  WORKFLOW_DEACTIVATED: 'WORKFLOW.DEACTIVATED',
  SUPPLIER_CREATED: 'SUPPLIER.CREATED',
  SUPPLIER_UPDATED: 'SUPPLIER.UPDATED',
  REQUEST_CREATED: 'PURCHASE_REQUEST.CREATED',
  REQUEST_UPDATED: 'PURCHASE_REQUEST.UPDATED',
  REQUEST_STATUS_CHANGED: 'PURCHASE_REQUEST.STATUS_CHANGED',
  REQUEST_RULES_EVALUATED: 'PURCHASE_REQUEST.RULES_EVALUATED',
  DOCUMENT_UPLOADED: 'DOCUMENT.UPLOADED',
  DOCUMENT_PROCESSING_REQUESTED: 'DOCUMENT.PROCESSING_REQUESTED',
  DOCUMENT_PROCESSED: 'DOCUMENT.PROCESSED',
  DOCUMENT_PROCESSING_FAILED: 'DOCUMENT.PROCESSING_FAILED',
  DOCUMENT_VERIFIED: 'DOCUMENT.VERIFIED',
  APPROVAL_REQUESTED: 'APPROVAL.REQUESTED',
  APPROVAL_APPROVED: 'APPROVAL.APPROVED',
  APPROVAL_REJECTED: 'APPROVAL.REJECTED',
  AUTOMATION_JOB_CREATED: 'AUTOMATION.JOB_CREATED',
  AUTOMATION_JOB_SUBMITTED: 'AUTOMATION.JOB_SUBMITTED',
  AUTOMATION_SUBMISSION_FAILED: 'AUTOMATION.SUBMISSION_FAILED',
  AUTOMATION_JOB_RUNNING: 'AUTOMATION.JOB_RUNNING',
  AUTOMATION_JOB_COMPLETED: 'AUTOMATION.JOB_COMPLETED',
  AUTOMATION_JOB_FAILED: 'AUTOMATION.JOB_FAILED',
  AUTOMATION_RETRY_REQUESTED: 'AUTOMATION.RETRY_REQUESTED',
  AUTOMATION_RETRY_SCHEDULED: 'AUTOMATION.RETRY_SCHEDULED',
  AUTOMATION_JOB_CANCELLED: 'AUTOMATION.JOB_CANCELLED',
  AUTOMATION_RECONCILED: 'AUTOMATION.RECONCILED',
  INTEGRATION_CONNECTION_TESTED: 'INTEGRATION.CONNECTION_TESTED',
  SYSTEM_ERROR: 'SYSTEM.ERROR',
} as const);
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
