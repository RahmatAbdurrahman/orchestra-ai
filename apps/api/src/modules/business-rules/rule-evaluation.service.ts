import { Injectable } from '@nestjs/common';
import { Prisma, type DbClient } from '@orchestra/database';
import {
  ACTIVE_PURCHASE_REQUEST_STATUSES,
  BUDGET_COMMITTED_STATUSES,
  computeTotals,
  evaluatePurchaseRequestRules,
  type RuleEvaluationResult,
  type RuleRequestInput,
  type WorkflowConfiguration,
} from '@orchestra/domain';

export interface RuleEvaluationParams {
  purchaseRequestId: string;
  requesterId: string;
  departmentId: string;
  input: RuleRequestInput;
  configuration: WorkflowConfiguration;
  now?: Date;
}

/**
 * Loads everything the (pure) rule engine needs - supplier master, budget
 * already committed this month, duplicate candidates - and evaluates the
 * configured rules.
 */
@Injectable()
export class RuleEvaluationService {
  async evaluate(db: DbClient, params: RuleEvaluationParams): Promise<RuleEvaluationResult> {
    const now = params.now ?? new Date();
    const { input, configuration } = params;
    const supplierName = input.supplierName?.trim() || null;

    const supplier = input.supplierId
      ? await db.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, name: true, isActive: true } })
      : null;

    const department = await db.department.findUniqueOrThrow({
      where: { id: params.departmentId },
      select: { id: true, name: true, monthlyBudget: true },
    });
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const committed = await db.purchaseRequest.aggregate({
      _sum: { totalAmountBase: true },
      where: {
        departmentId: params.departmentId,
        id: { not: params.purchaseRequestId },
        status: { in: [...BUDGET_COMMITTED_STATUSES] },
        submittedAt: { gte: monthStart },
      },
    });

    const supplierMatch: Prisma.PurchaseRequestWhereInput[] = [];
    if (input.supplierId) supplierMatch.push({ supplierId: input.supplierId });
    if (supplierName) supplierMatch.push({ supplierName: { equals: supplierName, mode: 'insensitive' } });

    const duplicateDocumentRequests =
      input.documentNumber && supplierMatch.length > 0
        ? await db.purchaseRequest.findMany({
            where: {
              id: { not: params.purchaseRequestId },
              documentNumber: { equals: input.documentNumber, mode: 'insensitive' },
              status: { in: [...ACTIVE_PURCHASE_REQUEST_STATUSES] },
              OR: supplierMatch,
            },
            select: { id: true, requestNumber: true },
            take: 5,
          })
        : [];

    const totals = computeTotals(input.items, Math.max(0, input.taxAmount || 0));
    const similarRecentRequests =
      supplierMatch.length > 0 && totals.total > 0
        ? await db.purchaseRequest.findMany({
            where: {
              id: { not: params.purchaseRequestId },
              requesterId: params.requesterId,
              status: { in: [...ACTIVE_PURCHASE_REQUEST_STATUSES] },
              totalAmount: new Prisma.Decimal(totals.total.toFixed(2)),
              createdAt: { gte: new Date(now.getTime() - configuration.rules.duplicateLookbackDays * 86_400_000) },
              OR: supplierMatch,
            },
            select: { id: true, requestNumber: true },
            take: 5,
          })
        : [];

    return evaluatePurchaseRequestRules(
      input,
      {
        supplier,
        department: {
          id: department.id,
          name: department.name,
          monthlyBudget: department.monthlyBudget === null ? null : Number(department.monthlyBudget.toString()),
          committedAmount: Number(committed._sum.totalAmountBase?.toString() ?? 0),
        },
        duplicateDocumentRequests,
        similarRecentRequests,
      },
      configuration.rules,
      configuration.approval,
      now,
    );
  }
}
