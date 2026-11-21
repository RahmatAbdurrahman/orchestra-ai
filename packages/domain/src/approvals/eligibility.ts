import type { ApprovalGroup, RoleName } from '../enums';

export interface ApproverIdentity {
  id: string;
  departmentId: string | null;
  roles: readonly RoleName[];
}

export interface ApprovalSlot {
  approverGroup: ApprovalGroup;
  /** Department whose approvers may decide this level. */
  departmentId: string | null;
}

export interface EligibilityOptions {
  /** PRD RBAC matrix: "Approve Request - Admin: Configurable". */
  adminCanApprove: boolean;
}

/** Whether the user belongs to the group of approvers for this approval level. */
export function isEligibleApprover(
  user: ApproverIdentity,
  slot: ApprovalSlot,
  options: EligibilityOptions,
): boolean {
  if (user.roles.includes('APPROVER') && slot.departmentId !== null && user.departmentId === slot.departmentId) {
    return true;
  }
  return options.adminCanApprove && user.roles.includes('ADMIN');
}

export type ApprovalBlockReason = 'NOT_ELIGIBLE' | 'OWN_REQUEST' | 'ALREADY_APPROVED_EARLIER_LEVEL';

export const APPROVAL_BLOCK_MESSAGES: Readonly<Record<ApprovalBlockReason, string>> = {
  NOT_ELIGIBLE: 'You are not an eligible approver for this approval level',
  OWN_REQUEST: 'You cannot approve or reject your own purchase request',
  ALREADY_APPROVED_EARLIER_LEVEL: 'The same person cannot approve more than one level of a request',
};

/**
 * Segregation-of-duties checks applied before an approval decision:
 * the approver must be eligible, must not be the requester, and (when
 * configured) must not have decided an earlier level of the same request.
 */
export function approvalBlockReason(params: {
  user: ApproverIdentity;
  slot: ApprovalSlot;
  requesterId: string;
  earlierDeciderIds: readonly string[];
  requireDistinctApprovers: boolean;
  options: EligibilityOptions;
}): ApprovalBlockReason | null {
  if (params.user.id === params.requesterId) return 'OWN_REQUEST';
  if (!isEligibleApprover(params.user, params.slot, params.options)) return 'NOT_ELIGIBLE';
  if (params.requireDistinctApprovers && params.earlierDeciderIds.includes(params.user.id)) {
    return 'ALREADY_APPROVED_EARLIER_LEVEL';
  }
  return null;
}
