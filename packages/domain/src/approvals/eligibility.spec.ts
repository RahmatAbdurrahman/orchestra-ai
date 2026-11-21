import { approvalBlockReason, isEligibleApprover } from './eligibility';

const ops = 'dep-ops';
const finance = 'dep-fin';

const opsApprover = { id: 'u-ops', departmentId: ops, roles: ['APPROVER'] as const };
const financeApprover = { id: 'u-fin', departmentId: finance, roles: ['APPROVER'] as const };
const admin = { id: 'u-admin', departmentId: 'dep-it', roles: ['ADMIN'] as const };
const requesterApprover = { id: 'u-req', departmentId: ops, roles: ['REQUESTER', 'APPROVER'] as const };

const departmentSlot = { approverGroup: 'DEPARTMENT' as const, departmentId: ops };
const financeSlot = { approverGroup: 'FINANCE' as const, departmentId: finance };

describe('approver eligibility', () => {
  it('matches approvers to the department of the approval level', () => {
    expect(isEligibleApprover(opsApprover, departmentSlot, { adminCanApprove: false })).toBe(true);
    expect(isEligibleApprover(opsApprover, financeSlot, { adminCanApprove: false })).toBe(false);
    expect(isEligibleApprover(financeApprover, financeSlot, { adminCanApprove: false })).toBe(true);
  });

  it('only lets administrators approve when configured', () => {
    expect(isEligibleApprover(admin, departmentSlot, { adminCanApprove: false })).toBe(false);
    expect(isEligibleApprover(admin, departmentSlot, { adminCanApprove: true })).toBe(true);
  });

  it('blocks approving your own request even when you are an approver', () => {
    expect(
      approvalBlockReason({
        user: requesterApprover,
        slot: departmentSlot,
        requesterId: 'u-req',
        earlierDeciderIds: [],
        requireDistinctApprovers: true,
        options: { adminCanApprove: false },
      }),
    ).toBe('OWN_REQUEST');
  });

  it('enforces distinct approvers across levels', () => {
    const adminApprover = { id: 'u-admin', departmentId: 'dep-it', roles: ['ADMIN'] as const };
    const params = {
      user: adminApprover,
      slot: financeSlot,
      requesterId: 'u-req',
      earlierDeciderIds: ['u-admin'],
      options: { adminCanApprove: true },
    };
    expect(approvalBlockReason({ ...params, requireDistinctApprovers: true })).toBe('ALREADY_APPROVED_EARLIER_LEVEL');
    expect(approvalBlockReason({ ...params, requireDistinctApprovers: false })).toBeNull();
  });

  it('rejects users without eligibility', () => {
    expect(
      approvalBlockReason({
        user: opsApprover,
        slot: financeSlot,
        requesterId: 'u-req',
        earlierDeciderIds: [],
        requireDistinctApprovers: true,
        options: { adminCanApprove: false },
      }),
    ).toBe('NOT_ELIGIBLE');
  });
});
