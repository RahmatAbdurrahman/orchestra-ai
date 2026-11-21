import { Injectable } from '@nestjs/common';
import type { DbClient, Prisma } from '@orchestra/database';
import {
  findActiveUserIdsWithRole,
  notifyUsers,
  writeAudit,
  type ActorContext,
} from '@orchestra/core';
import {
  APPROVAL_GROUP_LABELS,
  AuditAction,
  AuditEntity,
  DomainError,
  type ApprovalGroup,
} from '@orchestra/domain';

interface RoutedRequest {
  id: string;
  requestNumber: string;
  departmentId: string;
  requesterId: string;
}

/**
 * Creates the approval levels decided by the business rules and notifies the
 * approvers of the level that is currently actionable. Levels are sequential:
 * level N+1 is activated only after level N approves.
 */
@Injectable()
export class ApprovalRoutingService {
  async start(tx: DbClient, request: RoutedRequest, route: readonly ApprovalGroup[], actor: ActorContext): Promise<void> {
    if (route.length === 0) {
      throw new DomainError('PRECONDITION_FAILED', 'No approval route could be determined for this request');
    }
    let financeDepartmentId: string | null = null;
    if (route.includes('FINANCE')) {
      const finance = await tx.department.findFirst({ where: { isFinance: true }, select: { id: true } });
      if (!finance) throw new DomainError('PRECONDITION_FAILED', 'No finance department is configured');
      financeDepartmentId = finance.id;
    }
    const now = new Date();
    let first: Prisma.ApprovalGetPayload<object> | null = null;
    for (const [index, group] of route.entries()) {
      const approval = await tx.approval.create({
        data: {
          purchaseRequestId: request.id,
          approvalLevel: index + 1,
          approverGroup: group,
          departmentId: group === 'DEPARTMENT' ? request.departmentId : financeDepartmentId,
          activatedAt: index === 0 ? now : null,
        },
      });
      if (index === 0) first = approval;
    }
    await this.announce(tx, request, first!, actor);
  }

  /** Notifies eligible approvers and records the approval request in the audit trail. */
  async announce(
    tx: DbClient,
    request: RoutedRequest,
    approval: { id: string; approvalLevel: number; approverGroup: ApprovalGroup; departmentId: string | null },
    actor: ActorContext,
  ): Promise<void> {
    const approvers = approval.departmentId
      ? await findActiveUserIdsWithRole(tx, 'APPROVER', approval.departmentId)
      : [];
    await notifyUsers(
      tx,
      approvers.filter((id) => id !== request.requesterId),
      {
        type: 'APPROVAL_REQUIRED',
        title: `Approval required: ${request.requestNumber}`,
        message: `Level ${approval.approvalLevel} (${APPROVAL_GROUP_LABELS[approval.approverGroup]}) is waiting for your decision.`,
        link: `/requests/${request.id}`,
      },
    );
    await writeAudit(tx, actor, {
      action: AuditAction.APPROVAL_REQUESTED,
      entityType: AuditEntity.APPROVAL,
      entityId: approval.id,
      purchaseRequestId: request.id,
      newValue: { level: approval.approvalLevel, group: approval.approverGroup, notified: approvers.length },
    });
  }
}
