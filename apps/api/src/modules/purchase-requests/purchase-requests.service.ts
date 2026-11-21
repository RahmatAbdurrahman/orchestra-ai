import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { nextRequestSequence, Prisma, type DbClient } from '@orchestra/database';
import {
  loadWorkflowConfiguration,
  lockPurchaseRequest,
  runInTransaction,
  transitionPurchaseRequest,
  writeAudit,
  type JobQueue,
} from '@orchestra/core';
import {
  AuditAction,
  AuditEntity,
  computeLineTotal,
  computeTotals,
  DomainError,
  findBestSupplierMatch,
  formatRequestNumber,
  ForbiddenActionError,
  REQUESTER_CANCELLABLE_STATUSES,
  type PurchaseRequestStatus,
  type RuleEvaluationResult,
  type RuleRequestInput,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { pageParams, paginated } from '../../common/pagination';
import { actorFor, RequestContext } from '../../common/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma.service';
import { JOB_QUEUE } from '../../infrastructure/tokens';
import { ApprovalRoutingService } from '../approvals/approval-routing.service';
import { RuleEvaluationService } from '../business-rules/rule-evaluation.service';
import {
  isoDate,
  parseConfiguration,
  presentListRow,
  presentPurchaseRequest,
  PURCHASE_REQUEST_DETAIL_INCLUDE,
  PURCHASE_REQUEST_LIST_SELECT,
} from './purchase-request.presenter';
import type {
  CreatePurchaseRequestDto,
  ListPurchaseRequestsQueryDto,
  PurchaseRequestItemDto,
  UpdatePurchaseRequestDto,
} from './purchase-requests.dto';
import { RequestAccessService } from './request-access.service';

export function toDateOnly(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function itemsData(items: PurchaseRequestItemDto[]) {
  return items.map((item, index) => ({
    lineNo: index + 1,
    description: item.description.trim(),
    quantity: item.quantity,
    unit: item.unit?.trim() || null,
    unitPrice: new Prisma.Decimal(item.unitPrice.toFixed(2)),
    lineTotal: new Prisma.Decimal(computeLineTotal(item.quantity, item.unitPrice).toFixed(2)),
  }));
}

@Injectable()
export class PurchaseRequestsService {
  private readonly logger = new Logger(PurchaseRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RequestAccessService,
    private readonly rules: RuleEvaluationService,
    private readonly routing: ApprovalRoutingService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(user: AuthUser, query: ListPurchaseRequestsQueryDto) {
    const { page, pageSize, skip, take } = pageParams(query);
    const statuses = query.status
      ?.split(',')
      .map((status) => status.trim().toUpperCase())
      .filter(Boolean) as PurchaseRequestStatus[] | undefined;
    const where: Prisma.PurchaseRequestWhereInput = {
      AND: [
        this.access.readableWhere(user),
        statuses?.length ? { status: { in: statuses } } : {},
        query.mine ? { requesterId: user.id } : {},
        query.departmentId ? { departmentId: query.departmentId } : {},
        query.search
          ? {
              OR: [
                { requestNumber: { contains: query.search, mode: 'insensitive' } },
                { title: { contains: query.search, mode: 'insensitive' } },
                { supplierName: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.purchaseRequest.findMany({
        where,
        select: PURCHASE_REQUEST_LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.purchaseRequest.count({ where }),
    ]);
    return paginated(rows.map(presentListRow), total, page, pageSize);
  }

  async detail(user: AuthUser, id: string) {
    await this.access.assertReadable(user, id);
    const request = await this.prisma.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: PURCHASE_REQUEST_DETAIL_INCLUDE,
    });
    const version = await this.prisma.workflowVersion.findUnique({
      where: { workflowId_version: { workflowId: request.workflowId, version: request.workflowVersion } },
      select: { configuration: true },
    });
    return presentPurchaseRequest(request, user, parseConfiguration(version?.configuration), {
      adminCanApprove: this.config.rbac.adminCanApprove,
    });
  }

  async timeline(user: AuthUser, id: string) {
    await this.access.assertReadable(user, id);
    const events = await this.prisma.auditLog.findMany({
      where: { purchaseRequestId: id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { id: true, name: true } } },
      take: 500,
    });
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      actorType: event.actorType,
      actor: event.actor,
      oldValue: event.oldValue,
      newValue: event.newValue,
      metadata: event.metadata,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
    }));
  }

  async create(user: AuthUser, input: CreatePurchaseRequestDto) {
    const departmentId = user.departmentId;
    if (!departmentId) {
      throw new UnprocessableEntityException('Your account has no department; ask an administrator to assign one');
    }
    const workflow = await this.prisma.workflow.findFirst({
      where: { workflowType: 'PURCHASE_REQUEST', isActive: true, ...(input.workflowId ? { id: input.workflowId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (!workflow) throw new UnprocessableEntityException('No active purchase request workflow is configured');
    const supplier = await this.resolveSupplier(input.supplierId, input.supplierName);
    const items = input.items ?? [];
    const totals = computeTotals(items, input.taxAmount ?? 0);

    const created = await runInTransaction(this.prisma, async (tx) => {
      const sequence = await nextRequestSequence(tx);
      const request = await tx.purchaseRequest.create({
        data: {
          requestNumber: formatRequestNumber(new Date().getUTCFullYear(), sequence),
          title: input.title.trim(),
          description: input.description?.trim() || null,
          requesterId: user.id,
          departmentId,
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          supplierId: supplier?.id ?? null,
          supplierName: supplier?.name ?? input.supplierName?.trim() ?? null,
          documentNumber: input.documentNumber?.trim() || null,
          currency: input.currency ?? 'IDR',
          requiredDate: toDateOnly(input.requiredDate),
          subtotalAmount: new Prisma.Decimal(totals.subtotal.toFixed(2)),
          taxAmount: new Prisma.Decimal(totals.taxAmount.toFixed(2)),
          totalAmount: new Prisma.Decimal(totals.total.toFixed(2)),
          items: { create: itemsData(items) },
        },
      });
      await writeAudit(tx, actorFor(user), {
        action: AuditAction.REQUEST_CREATED,
        entityType: AuditEntity.PURCHASE_REQUEST,
        entityId: request.id,
        purchaseRequestId: request.id,
        newValue: {
          requestNumber: request.requestNumber,
          title: request.title,
          status: request.status,
          workflow: `${workflow.key}@v${workflow.version}`,
          totalAmount: totals.total,
        },
      });
      return request;
    });
    return this.detail(user, created.id);
  }

  async update(user: AuthUser, id: string, input: UpdatePurchaseRequestDto) {
    const existing = await this.loadOwned(user, id);
    if (existing.status !== 'DRAFT') throw new DomainError('PRECONDITION_FAILED', 'Only draft requests can be edited');
    const supplier =
      input.supplierId !== undefined || input.supplierName !== undefined
        ? await this.resolveSupplier(input.supplierId, input.supplierName)
        : undefined;

    await runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, id);
      const current = await tx.purchaseRequest.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (current.status !== 'DRAFT') throw new DomainError('PRECONDITION_FAILED', 'Only draft requests can be edited');
      const items =
        input.items ??
        current.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice.toString()),
          unit: item.unit ?? undefined,
        }));
      const taxAmount = input.taxAmount ?? Number(current.taxAmount.toString());
      const totals = computeTotals(items, taxAmount);
      if (input.items) {
        await tx.purchaseRequestItem.deleteMany({ where: { purchaseRequestId: id } });
        await tx.purchaseRequestItem.createMany({ data: itemsData(input.items).map((item) => ({ ...item, purchaseRequestId: id })) });
      }
      await tx.purchaseRequest.update({
        where: { id },
        data: {
          ...(input.title ? { title: input.title.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
          ...(supplier !== undefined ? { supplierId: supplier?.id ?? null, supplierName: supplier?.name ?? input.supplierName?.trim() ?? null } : {}),
          ...(input.documentNumber !== undefined ? { documentNumber: input.documentNumber?.trim() || null } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.requiredDate !== undefined ? { requiredDate: toDateOnly(input.requiredDate) } : {}),
          subtotalAmount: new Prisma.Decimal(totals.subtotal.toFixed(2)),
          taxAmount: new Prisma.Decimal(totals.taxAmount.toFixed(2)),
          totalAmount: new Prisma.Decimal(totals.total.toFixed(2)),
        },
      });
      await writeAudit(tx, actorFor(user), {
        action: AuditAction.REQUEST_UPDATED,
        entityType: AuditEntity.PURCHASE_REQUEST,
        entityId: id,
        purchaseRequestId: id,
        oldValue: { totalAmount: Number(current.totalAmount.toString()) },
        newValue: { totalAmount: totals.total, changedFields: Object.keys(input) },
      });
    });
    return this.detail(user, id);
  }

  /**
   * DRAFT -> SUBMITTED, then either:
   *  - PROCESSING_DOCUMENT (documents are queued for extraction), or
   *  - PENDING_APPROVAL directly when the workflow does not require a document
   *    and the request passes the business rules.
   */
  async submit(user: AuthUser, id: string) {
    const request = await this.loadOwned(user, id);
    if (request.status !== 'DRAFT') throw new DomainError('PRECONDITION_FAILED', `Request is ${request.status}; only drafts can be submitted`);
    const configuration = await loadWorkflowConfiguration(this.prisma, request.workflowId, request.workflowVersion);
    const documents = await this.prisma.document.findMany({
      where: { purchaseRequestId: id, processingStatus: { in: ['UPLOADED', 'FAILED', 'COMPLETED'] } },
      select: { id: true, processingRun: true },
    });
    if (configuration.document.required && documents.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'Upload the supporting document (invoice or quotation) before submitting');
    }
    const actor = actorFor(user);
    const correlationId = RequestContext.correlationId() ?? randomUUID();

    if (documents.length > 0) {
      const queued = await runInTransaction(this.prisma, async (tx) => {
        await transitionPurchaseRequest(tx, { purchaseRequestId: id, from: 'DRAFT', to: 'SUBMITTED', actor });
        const runs: Array<{ documentId: string; run: number }> = [];
        for (const document of documents) {
          const run = document.processingRun + 1;
          await tx.document.update({
            where: { id: document.id },
            data: { processingStatus: 'QUEUED', processingRun: run, processingError: null },
          });
          await writeAudit(tx, actor, {
            action: AuditAction.DOCUMENT_PROCESSING_REQUESTED,
            entityType: AuditEntity.DOCUMENT,
            entityId: document.id,
            purchaseRequestId: id,
            metadata: { run },
          });
          runs.push({ documentId: document.id, run });
        }
        await transitionPurchaseRequest(tx, { purchaseRequestId: id, from: 'SUBMITTED', to: 'PROCESSING_DOCUMENT', actor });
        return runs;
      });
      for (const item of queued) {
        await this.enqueueSafely(() =>
          this.queue.enqueueDocumentProcessing({ documentId: item.documentId, run: item.run, correlationId }),
        );
      }
      return this.detail(user, id);
    }

    // No document: validate the manually entered data directly.
    const full = await this.prisma.purchaseRequest.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { lineNo: 'asc' } } } });
    const ruleInput: RuleRequestInput = {
      supplierId: full.supplierId,
      supplierName: full.supplierName,
      documentNumber: full.documentNumber,
      currency: full.currency,
      requiredDate: isoDate(full.requiredDate),
      items: full.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice.toString()),
      })),
      taxAmount: Number(full.taxAmount.toString()),
    };
    await runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, id);
      const evaluation = await this.rules.evaluate(tx, {
        purchaseRequestId: id,
        requesterId: full.requesterId,
        departmentId: full.departmentId,
        input: ruleInput,
        configuration,
      });
      if (!evaluation.passed) {
        throw new DomainError('BUSINESS_RULE_VIOLATION', 'The request does not pass the business rules', {
          findings: evaluation.findings,
        });
      }
      await transitionPurchaseRequest(tx, { purchaseRequestId: id, from: 'DRAFT', to: 'SUBMITTED', actor });
      await this.enterApproval(tx, full, evaluation, actor, 'SUBMITTED');
    });
    return this.detail(user, id);
  }

  /** Stores the rule evaluation and moves the request into approval. Shared with document verification. */
  async enterApproval(
    tx: DbClient,
    request: { id: string; requestNumber: string; departmentId: string; requesterId: string },
    evaluation: RuleEvaluationResult,
    actor: ReturnType<typeof actorFor>,
    from: 'SUBMITTED' | 'NEEDS_VERIFICATION',
  ): Promise<void> {
    await tx.purchaseRequest.update({
      where: { id: request.id },
      data: {
        ruleEvaluation: evaluation as unknown as Prisma.InputJsonValue,
        approvalRoute: evaluation.approvalRoute,
        totalAmountBase:
          evaluation.totals.totalInBase === null ? null : new Prisma.Decimal(evaluation.totals.totalInBase.toFixed(2)),
      },
    });
    await writeAudit(tx, actor, {
      action: AuditAction.REQUEST_RULES_EVALUATED,
      entityType: AuditEntity.PURCHASE_REQUEST,
      entityId: request.id,
      purchaseRequestId: request.id,
      newValue: {
        passed: evaluation.passed,
        approvalRoute: evaluation.approvalRoute,
        findings: evaluation.findings.map((finding) => `${finding.severity}:${finding.ruleId}`),
      },
    });
    await transitionPurchaseRequest(tx, {
      purchaseRequestId: request.id,
      from,
      to: 'PENDING_APPROVAL',
      actor,
      metadata: { approvalRoute: evaluation.approvalRoute },
    });
    await this.routing.start(tx, request, evaluation.approvalRoute, actor);
  }

  async cancel(user: AuthUser, id: string, reason: string) {
    const request = await this.loadOwned(user, id);
    const status = request.status as PurchaseRequestStatus;
    if (!REQUESTER_CANCELLABLE_STATUSES.includes(status)) {
      throw new DomainError('PRECONDITION_FAILED', `A request that is ${status} can no longer be cancelled by the requester`);
    }
    await runInTransaction(this.prisma, async (tx) => {
      await transitionPurchaseRequest(tx, {
        purchaseRequestId: id,
        from: status,
        to: 'CANCELLED',
        actor: actorFor(user),
        reason,
      });
      await tx.approval.updateMany({ where: { purchaseRequestId: id, decision: 'PENDING' }, data: { decision: 'SKIPPED' } });
    });
    return this.detail(user, id);
  }

  private async loadOwned(user: AuthUser, id: string) {
    await this.access.assertReadable(user, id);
    const request = await this.prisma.purchaseRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Purchase request not found');
    if (request.requesterId !== user.id) throw new ForbiddenActionError('Only the requester can change this request');
    return request;
  }

  async resolveSupplier(supplierId?: string | null, supplierName?: string | null) {
    if (supplierId) {
      const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) throw new UnprocessableEntityException('Supplier not found');
      return supplier;
    }
    if (supplierName?.trim()) {
      const candidates = await this.prisma.supplier.findMany({ select: { id: true, name: true, code: true, isActive: true } });
      return findBestSupplierMatch(supplierName, candidates)?.supplier ?? null;
    }
    return null;
  }

  private async enqueueSafely(enqueue: () => Promise<void>): Promise<void> {
    try {
      await enqueue();
    } catch (error) {
      // The state is committed; the reconciler re-enqueues anything that was not queued.
      this.logger.error(`Enqueue failed; the reconciler will retry: ${(error as Error).message}`);
    }
  }
}
