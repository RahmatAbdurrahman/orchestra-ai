import type {
  ApprovalDecision,
  ApprovalGroup,
  AutomationJobStatus,
  DocumentProcessingStatus,
  PurchaseRequestStatus,
  RoleName,
} from './enums';

export const PURCHASE_REQUEST_STATUS_LABELS: Readonly<Record<PurchaseRequestStatus, string>> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  PROCESSING_DOCUMENT: 'Processing Document',
  NEEDS_VERIFICATION: 'Needs Verification',
  PENDING_APPROVAL: 'Pending Approval',
  REJECTED: 'Rejected',
  APPROVED: 'Approved',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const AUTOMATION_JOB_STATUS_LABELS: Readonly<Record<AutomationJobStatus, string>> = {
  QUEUED: 'Queued',
  SUBMITTING: 'Submitting',
  PENDING: 'Waiting for robot',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export const DOCUMENT_STATUS_LABELS: Readonly<Record<DocumentProcessingStatus, string>> = {
  UPLOADED: 'Uploaded',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  COMPLETED: 'Extracted',
  FAILED: 'Extraction failed',
  VERIFIED: 'Verified',
};

export const APPROVAL_DECISION_LABELS: Readonly<Record<ApprovalDecision, string>> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SKIPPED: 'Skipped',
};

export const APPROVAL_GROUP_LABELS: Readonly<Record<ApprovalGroup, string>> = {
  DEPARTMENT: 'Department approver',
  FINANCE: 'Finance approver',
};

export const ROLE_LABELS: Readonly<Record<RoleName, string>> = {
  ADMIN: 'Administrator',
  REQUESTER: 'Requester',
  APPROVER: 'Approver',
  OPERATOR: 'Automation Operator',
  VIEWER: 'Management / Viewer',
};
