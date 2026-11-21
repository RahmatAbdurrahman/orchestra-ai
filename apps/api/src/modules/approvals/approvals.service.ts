import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { decimalToNumber, type Prisma } from '@orchestra/database';
import {
  createAutomationJob,
  loadWorkflowConfiguration,
  lockPurchaseRequest,
  notifyUsers,
  PURCHASE_REQUEST_AUTOMATION_INCLUDE,
  runInTransaction,
  transitionPurchaseRequest,
  writeAudit,
  type JobQueue,
} from '@orchestra/core';
import {
  APPROVAL_BLOCK_MESSAGES,
  approvalBlockReason,
  AuditAction,
  AuditEntity,
  ConcurrencyConflictError,
  DomainError,
  type ApprovalGroup,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { pageParams, paginated, type PaginationQueryDto } from '../../common/pagination';
import { actorFor, RequestContext } from '../../common/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma.service';
import { JOB_QUEUE } from '../../infrastructure/tokens';
import { RequestAccessService } from '../purchase-requests/request-access.service';
import { ApprovalRoutingService } from './approval-routing.service';

const PENDING_INCLUDE = {
  department: { select: { id: true, name: true } },
  purchaseRequest: {
    select: {
      id: true,
      requestNumber: true,
      title: true,
      status: true,
      supplierName: true,
      currency: true,
      totalAmount: true,
      totalAmountBase: true,
      requiredDate: true,
      ruleEvaluation: true,
      submittedAt: true,
      requesterId: true,
      requester: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      approvals: { select: { approvalLevel: true, approverId: true } },
    },
  },
} as const satisfies Prisma.ApprovalInclude;

type DecisionOutcome =
  | { outcome: 'NEXT_LEVEL'; nextLevel: number }
  | { outcome: 'APPROVED'; automationJobId: string | null }
  | { outcome: 'REJECTED' };

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly routing: ApprovalRoutingService,
    private readonly access: RequestAccessService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Approvals currently waiting for this user's decision. */
  async pending(user: AuthUser) {
    const adminApprover = this.config.rbac.adminCanApprove && user.roles.includes('ADMIN');
    const eligibility: Prisma.ApprovalWhereInput[] = [];
    if (user.roles.includes('APPROVER') && user.departmentId) eligibility.push({ departmentId: user.departmentId });
    if (adminApprover) eligibility.push({});
    if (eligibility.length === 0) return [];

    const rows = await this.prisma.approval.findMany({
      where: {
        decision: 'PENDING',
        activatedAt: { not: null },
        OR: eligibility,
        purchaseRequest: { status: 'PENDING_APPROVAL', requesterId: { not: user.id } },
      },
      include: PENDING_INCLUDE,
      orderBy: { activatedAt: 'asc' },
      take: 200,
    });
    return rows
      .filter((row) => !row.purchaseRequest.approvals.some((other) => other.approverId === user.id))
      .map((row) => {
        const evaluation = row.purchaseRequest.ruleEvaluation as { findings?: Array<{ severity: string }> } | null;
        return {
          id: row.id,
          approvalLevel: row.approvalLevel,
          approverGroup: row.approverGroup,
          department: row.department,
          activatedAt: row.activatedAt,
          purchaseRequest: {
            id: row.purchaseRequest.id,
            requestNumber: row.purchaseRequest.requestNumber,
            title: row.purchaseRequest.title,
            supplierName: row.purchaseRequest.supplierName,
            currency: row.purchaseRequest.currency,
            totalAmount: decimalToNumber(row.purchaseRequest.totalAmount),
            totalAmountBase: decimalToNumber(row.purchaseRequest.totalAmountBase),
            requiredDate: row.purchaseRequest.requiredDate,
            submittedAt: row.purchaseRequest.submittedAt,
            requester: row.purchaseRequest.requester,
            department: row.purchaseRequest.department,
            levels: row.purchaseRequest.approvals.length,
            warningCount: evaluation?.findings?.filter((finding) => finding.severity === 'WARNING').length ?? 0,
          },
        };
      });
  }

  /** Decisions made by this user. */
  async decided(user: AuthUser, query: PaginationQueryDto) {
    const { page, pageSize, skip, take } = pageParams(query);
    const where: Prisma.ApprovalWhereInput = { approverId: user.id, decision: { in: ['APPROVED', 'REJECTED'] } };
    const [rows, total] = await Promise.all([
      this.prisma.approval.findMany({
        where,
        include: { purchaseRequest: { select: { id: true, requestNumber: true, title: true, status: true, currency: true, totalAmount: true } } },
        orderBy: { decidedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.approval.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        approvalLevel: row.approvalLevel,
        approverGroup: row.approverGroup,
        decision: row.decision,
        comments: row.comments,
        decidedAt: row.decidedAt,
        purchaseRequest: { ...row.purchaseRequest, totalAmount: decimalToNumber(row.purchaseRequest.totalAmount) },
      })),
      total,
      page,
      pageSize,
    );
  }

  async history(user: AuthUser, approvalId: string) {
    const approval = await this.prisma.approval.findUnique({ where: { id: approvalId }, select: { purchaseRequestId: true } });
    if (!approval) throw new NotFoundException('Approval not found');
    await this.access.assertReadable(user, approval.purchaseRequestId);
    return this.prisma.approval.findMany({
      where: { purchaseRequestId: approval.purchaseRequestId },
      orderBy: { approvalLevel: 'asc' },
      include: { approver: { select: { id: true, name: true } }, department: { select: { id: true, name: true } } },
    });
  }

  async approve(user: AuthUser, approvalId: string, comments?: string) {
    const correlationId = RequestContext.correlationId() ?? randomUUID();
    const result = await this.decide(user, approvalId, 'APPROVED', comments ?? null, correlationId);
    if (result.outcome === 'APPROVED' && result.automationJobId) {
      try {
        await this.queue.enqueueAutomationSubmit({ automationJobId: result.automationJobId, attemptNo: 1, correlationId });
      } catch (error) {
        this.logger.error(`Enqueue failed; the reconciler will submit the job: ${(error as Error).message}`);
      }
    }
    return result;
  }

  async reject(user: AuthUser, approvalId: string, reason: string) {
    return this.decide(user, approvalId, 'REJECTED', reason, RequestContext.correlationId() ?? randomUUID());
  }

  private async decide(
    user: AuthUser,
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    comments: string | null,
    correlationId: string,
  ): Promise<DecisionOutcome> {
    const probe = await this.prisma.approval.findUnique({ where: { id: approvalId }, select: { purchaseRequestId: true } });
    if (!probe) throw new NotFoundException('Approval not found');
    const actor = actorFor(user);

    return runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, probe.purchaseRequestId);
      const approval = await tx.approval.findUniqueOrThrow({
        where: { id: approvalId },
        include: {
          purchaseRequest: {
            include: { approvals: { orderBy: { approvalLevel: 'asc' } } },
          },
        },
      });
      const request = approval.purchaseRequest;
      if (approval.decision !== 'PENDING' || !approval.activatedAt) {
        throw new DomainError('PRECONDITION_FAILED', 'This approval is not waiting for a decision');
      }
      if (request.status !== 'PENDING_APPROVAL') {
        throw new DomainError('PRECONDITION_FAILED', `The request is ${request.status}`);
      }
      const configuration = await loadWorkflowConfiguration(tx, request.workflowId, request.workflowVersion);
      const blocked = approvalBlockReason({
        user: { id: user.id, departmentId: user.departmentId, roles: user.roles },
        slot: { approverGroup: approval.approverGroup as ApprovalGroup, departmentId: approval.departmentId },
        requesterId: request.requesterId,
        earlierDeciderIds: request.approvals
          .filter((other) => other.approvalLevel < approval.approvalLevel && other.approverId)
          .map((other) => other.approverId!),
        requireDistinctApprovers: configuration.approval.requireDistinctApprovers,
        options: { adminCanApprove: this.config.rbac.adminCanApprove },
      });
      if (blocked) throw new ForbiddenException(APPROVAL_BLOCK_MESSAGES[blocked]);

      const now = new Date();
      const updated = await tx.approval.updateMany({
        where: { id: approval.id, decision: 'PENDING' },
        data: { decision, approverId: user.id, decidedAt: now, comments },
      });
      if (updated.count !== 1) throw new ConcurrencyConflictError('This approval was already decided');
      await writeAudit(tx, actor, {
        action: decision === 'APPROVED' ? AuditAction.APPROVAL_APPROVED : AuditAction.APPROVAL_REJECTED,
        entityType: AuditEntity.APPROVAL,
        entityId: approval.id,
        purchaseRequestId: request.id,
        oldValue: { decision: 'PENDING' },
        newValue: { decision, level: approval.approvalLevel, group: approval.approverGroup },
        metadata: comments ? { comments } : undefined,
      });

      if (decision === 'REJECTED') {
        await tx.approval.updateMany({
          where: { purchaseRequestId: request.id, decision: 'PENDING', id: { not: approval.id } },
          data: { decision: 'SKIPPED' },
        });
        await transitionPurchaseRequest(tx, {
          purchaseRequestId: request.id,
          from: 'PENDING_APPROVAL',
          to: 'REJECTED',
          actor,
          reason: comments,
          metadata: { approvalLevel: approval.approvalLevel },
        });
        await notifyUsers(tx, [request.requesterId], {
          type: 'REQUEST_REJECTED',
          title: `${request.requestNumber} was rejected`,
          message: `Rejected at level ${approval.approvalLevel} by ${user.name}: ${comments ?? ''}`.trim(),
          link: `/requests/${request.id}`,
        });
        return { outcome: 'REJECTED' };
      }

      const next = request.approvals.find((other) => other.approvalLevel === approval.approvalLevel + 1);
      if (next) {
        await tx.approval.update({ where: { id: next.id }, data: { activatedAt: now } });
        await this.routing.announce(tx, request, next as typeof next & { approverGroup: ApprovalGroup }, actor);
        return { outcome: 'NEXT_LEVEL', nextLevel: next.approvalLevel };
      }

      await transitionPurchaseRequest(tx, {
        purchaseRequestId: request.id,
        from: 'PENDING_APPROVAL',
        to: 'APPROVED',
        actor,
        metadata: { levels: request.approvals.length },
      });
      await notifyUsers(tx, [request.requesterId], {
        type: 'REQUEST_APPROVED',
        title: `${request.requestNumber} was approved`,
        message: configuration.automation.enabled && configuration.automation.dispatchMode === 'AUTOMATIC'
          ? 'The purchase order will now be created in the ERP by the UiPath robot.'
          : 'The request is approved.',
        link: `/requests/${request.id}`,
      });

      if (!configuration.automation.enabled || configuration.automation.dispatchMode !== 'AUTOMATIC') {
        return { outcome: 'APPROVED', automationJobId: null };
      }
      const full = await tx.purchaseRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: PURCHASE_REQUEST_AUTOMATION_INCLUDE,
      });
      const job = await createAutomationJob(tx, {
        purchaseRequest: full,
        automation: configuration.automation,
        actor,
        correlationId,
      });
      return { outcome: 'APPROVED', automationJobId: job.automationJobId };
    });
  }
}
