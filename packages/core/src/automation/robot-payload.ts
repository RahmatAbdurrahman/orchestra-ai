import type { Prisma } from '@orchestra/database';
import {
  DomainError,
  type RobotInputArguments,
  type RobotPurchaseOrderPayload,
} from '@orchestra/domain';

export interface PurchaseRequestForAutomation {
  id: string;
  requestNumber: string;
  workflowId: string;
  supplierName: string | null;
  currency: string;
  requiredDate: Date | null;
  documentNumber: string | null;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  supplier: { code: string; name: string } | null;
  department: { name: string };
  items: Array<{ lineNo: number; description: string; quantity: number; unitPrice: Prisma.Decimal }>;
}

/** Prisma include that loads everything buildRobotPayload needs. */
export const PURCHASE_REQUEST_AUTOMATION_INCLUDE = {
  supplier: { select: { code: true, name: true } },
  department: { select: { name: true } },
  items: { select: { lineNo: true, description: true, quantity: true, unitPrice: true }, orderBy: { lineNo: 'asc' } },
} as const satisfies Prisma.PurchaseRequestInclude;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Builds the validated purchase order payload sent to the robot. Only the
 * data needed to create the purchase order is included (no personal data).
 */
export function buildRobotPayload(request: PurchaseRequestForAutomation): RobotPurchaseOrderPayload {
  const supplierName = request.supplier?.name ?? request.supplierName;
  if (!supplierName) throw new DomainError('PRECONDITION_FAILED', 'A supplier is required before automation');
  if (!request.requiredDate) throw new DomainError('PRECONDITION_FAILED', 'A required date is required before automation');
  if (request.items.length === 0) throw new DomainError('PRECONDITION_FAILED', 'At least one line item is required before automation');
  return {
    requestNumber: request.requestNumber,
    supplierCode: request.supplier?.code ?? null,
    supplierName,
    currency: request.currency,
    requiredDate: isoDate(request.requiredDate),
    documentNumber: request.documentNumber,
    department: request.department.name,
    taxAmount: Number(request.taxAmount.toString()),
    totalAmount: Number(request.totalAmount.toString()),
    items: [...request.items]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((item) => ({
        lineNo: item.lineNo,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice.toString()),
      })),
  };
}

export function buildRobotInputArguments(
  job: { id: string; purchaseRequestId: string; workflowId: string; correlationId: string; idempotencyKey: string },
  payload: RobotPurchaseOrderPayload,
): RobotInputArguments {
  return {
    in_ExecutionId: job.id,
    in_PurchaseRequestId: job.purchaseRequestId,
    in_RequestNumber: payload.requestNumber,
    in_WorkflowId: job.workflowId,
    in_CorrelationId: job.correlationId,
    in_IdempotencyKey: job.idempotencyKey,
    in_PurchaseOrderJson: JSON.stringify(payload),
  };
}
