import { PURCHASE_REQUEST_STATUS_LABELS, type PurchaseRequestStatus } from '@orchestra/domain';
import type { AuditEvent } from './types';

const ACTION_LABELS: Record<string, string> = {
  'AUTH.LOGIN_SUCCEEDED': 'Signed in',
  'AUTH.LOGIN_FAILED': 'Failed sign-in attempt',
  'AUTH.LOGOUT': 'Signed out',
  'AUTH.PASSWORD_CHANGED': 'Changed password',
  'USER.CREATED': 'Created a user',
  'USER.UPDATED': 'Updated a user',
  'USER.ACTIVATED': 'Activated a user',
  'USER.DEACTIVATED': 'Deactivated a user',
  'WORKFLOW.CREATED': 'Created a workflow',
  'WORKFLOW.UPDATED': 'Updated a workflow',
  'WORKFLOW.ACTIVATED': 'Activated a workflow',
  'WORKFLOW.DEACTIVATED': 'Deactivated a workflow',
  'SUPPLIER.CREATED': 'Created a supplier',
  'SUPPLIER.UPDATED': 'Updated a supplier',
  'PURCHASE_REQUEST.CREATED': 'Created a purchase request',
  'PURCHASE_REQUEST.UPDATED': 'Edited a purchase request',
  'PURCHASE_REQUEST.RULES_EVALUATED': 'Business rules evaluated',
  'DOCUMENT.UPLOADED': 'Uploaded a document',
  'DOCUMENT.PROCESSING_REQUESTED': 'Requested document processing',
  'DOCUMENT.PROCESSED': 'Document processed by document intelligence',
  'DOCUMENT.PROCESSING_FAILED': 'Document extraction failed',
  'DOCUMENT.VERIFIED': 'Verified the extracted data',
  'APPROVAL.REQUESTED': 'Approval requested',
  'APPROVAL.APPROVED': 'Approved',
  'APPROVAL.REJECTED': 'Rejected',
  'AUTOMATION.JOB_CREATED': 'Automation job created',
  'AUTOMATION.JOB_SUBMITTED': 'Job submitted to UiPath Orchestrator',
  'AUTOMATION.JOB_RUNNING': 'UiPath robot started',
  'AUTOMATION.JOB_COMPLETED': 'Purchase order created by the robot',
  'AUTOMATION.JOB_FAILED': 'Automation failed',
  'AUTOMATION.RETRY_REQUESTED': 'Operator retry requested',
  'AUTOMATION.RETRY_SCHEDULED': 'Automatic retry scheduled',
  'AUTOMATION.JOB_CANCELLED': 'Automation job cancelled',
  'AUTOMATION.RECONCILED': 'Interrupted submission recovered',
  'INTEGRATION.CONNECTION_TESTED': 'Tested the UiPath connection',
};

export function describeEvent(event: AuditEvent): string {
  if (event.action === 'PURCHASE_REQUEST.STATUS_CHANGED') {
    const from = event.oldValue?.status as PurchaseRequestStatus | undefined;
    const to = event.newValue?.status as PurchaseRequestStatus | undefined;
    if (from && to) return `Status ${PURCHASE_REQUEST_STATUS_LABELS[from]} → ${PURCHASE_REQUEST_STATUS_LABELS[to]}`;
  }
  const label = ACTION_LABELS[event.action] ?? event.action;
  const poNumber = event.newValue?.poNumber;
  if (typeof poNumber === 'string') return `${label}: ${poNumber}`;
  return label;
}
