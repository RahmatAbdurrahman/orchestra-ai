import { decimalToNumber, type Prisma } from '@orchestra/database';
import {
  approvalBlockReason,
  lowConfidenceFields,
  Permission,
  REQUESTER_CANCELLABLE_STATUSES,
  safeParseWorkflowConfiguration,
  extractionResultSchema,
  type ApprovalGroup,
  type PurchaseRequestStatus,
  type WorkflowConfiguration,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';

export const PURCHASE_REQUEST_DETAIL_INCLUDE = {
  requester: { select: { id: true, name: true, email: true } },
  department: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, name: true, isActive: true } },
  workflow: { select: { id: true, key: true, name: true } },
  items: { orderBy: { lineNo: 'asc' } },
  documents: {
    orderBy: { createdAt: 'asc' },
    include: {
      uploadedBy: { select: { id: true, name: true } },
      verifiedBy: { select: { id: true, name: true } },
    },
  },
  approvals: {
    orderBy: { approvalLevel: 'asc' },
    include: {
      approver: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
    },
  },
  automationJob: {
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAutoAttempts: true,
      maxTotalAttempts: true,
      uipathJobId: true,
      poNumber: true,
      errorCode: true,
      errorMessage: true,
      requiresIntervention: true,
      nextAttemptAt: true,
      queuedAt: true,
      startedAt: true,
      completedAt: true,
      idempotencyKey: true,
    },
  },
} as const satisfies Prisma.PurchaseRequestInclude;

export type PurchaseRequestWithDetail = Prisma.PurchaseRequestGetPayload<{ include: typeof PURCHASE_REQUEST_DETAIL_INCLUDE }>;

export const PURCHASE_REQUEST_LIST_SELECT = {
  id: true,
  requestNumber: true,
  title: true,
  status: true,
  supplierName: true,
  currency: true,
  totalAmount: true,
  requiredDate: true,
  poNumber: true,
  createdAt: true,
  updatedAt: true,
  submittedAt: true,
  requester: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  automationJob: { select: { id: true, status: true } },
} as const satisfies Prisma.PurchaseRequestSelect;

export type PurchaseRequestListRow = Prisma.PurchaseRequestGetPayload<{ select: typeof PURCHASE_REQUEST_LIST_SELECT }>;

export function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function presentListRow(row: PurchaseRequestListRow) {
  return {
    ...row,
    totalAmount: decimalToNumber(row.totalAmount),
    requiredDate: isoDate(row.requiredDate),
  };
}

export interface AllowedActions {
  edit: boolean;
  submit: boolean;
  cancel: boolean;
  uploadDocument: boolean;
  verify: boolean;
  reprocessDocument: boolean;
  /** Approval the current user may approve or reject (null if none). */
  approvalId: string | null;
  dispatchAutomation: boolean;
  retryAutomation: boolean;
  cancelAutomation: boolean;
}

export function computeAllowedActions(
  user: AuthUser,
  request: PurchaseRequestWithDetail,
  configuration: WorkflowConfiguration | null,
  options: { adminCanApprove: boolean },
): AllowedActions {
  const status = request.status as PurchaseRequestStatus;
  const isOwner = request.requesterId === user.id && user.permissions.has(Permission.REQUESTS_CREATE);
  let approvalId: string | null = null;
  if (status === 'PENDING_APPROVAL' && user.permissions.has(Permission.APPROVALS_DECIDE)) {
    const active = request.approvals.find((approval) => approval.decision === 'PENDING' && approval.activatedAt);
    if (active) {
      const blocked = approvalBlockReason({
        user: { id: user.id, departmentId: user.departmentId, roles: user.roles },
        slot: { approverGroup: active.approverGroup as ApprovalGroup, departmentId: active.departmentId },
        requesterId: request.requesterId,
        earlierDeciderIds: request.approvals
          .filter((approval) => approval.approvalLevel < active.approvalLevel && approval.approverId)
          .map((approval) => approval.approverId!),
        requireDistinctApprovers: configuration?.approval.requireDistinctApprovers ?? true,
        options,
      });
      if (!blocked) approvalId = active.id;
    }
  }
  const job = request.automationJob;
  return {
    edit: isOwner && status === 'DRAFT',
    submit: isOwner && status === 'DRAFT',
    cancel: isOwner && REQUESTER_CANCELLABLE_STATUSES.includes(status),
    uploadDocument: isOwner && (status === 'DRAFT' || status === 'NEEDS_VERIFICATION'),
    verify: isOwner && status === 'NEEDS_VERIFICATION',
    reprocessDocument: isOwner && status === 'NEEDS_VERIFICATION',
    approvalId,
    dispatchAutomation:
      user.permissions.has(Permission.AUTOMATION_EXECUTE) &&
      status === 'APPROVED' &&
      !job &&
      Boolean(configuration?.automation.enabled),
    retryAutomation:
      user.permissions.has(Permission.AUTOMATION_RETRY) && job?.status === 'FAILED' && job.attemptCount < job.maxTotalAttempts,
    cancelAutomation: user.permissions.has(Permission.AUTOMATION_EXECUTE) && job?.status === 'FAILED',
  };
}

export function presentDocument(
  document: PurchaseRequestWithDetail['documents'][number],
  confidenceThreshold: number,
) {
  const extraction = document.extractedData ? extractionResultSchema.safeParse(document.extractedData) : null;
  return {
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    sha256: document.sha256,
    processingStatus: document.processingStatus,
    processingError: document.processingError,
    confidenceScore: decimalToNumber(document.confidenceScore),
    extraction: extraction?.success ? extraction.data : null,
    lowConfidenceFields: extraction?.success ? lowConfidenceFields(extraction.data, confidenceThreshold) : [],
    verifiedData: document.verifiedData,
    processedAt: document.processedAt,
    verifiedAt: document.verifiedAt,
    verifiedBy: document.verifiedBy,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt,
  };
}

export function presentPurchaseRequest(
  request: PurchaseRequestWithDetail,
  user: AuthUser,
  configuration: WorkflowConfiguration | null,
  options: { adminCanApprove: boolean },
) {
  const threshold = configuration?.document.confidenceThreshold ?? 0.85;
  const job = request.automationJob;
  return {
    id: request.id,
    requestNumber: request.requestNumber,
    title: request.title,
    description: request.description,
    status: request.status,
    statusReason: request.statusReason,
    requester: request.requester,
    department: request.department,
    workflow: { ...request.workflow, version: request.workflowVersion },
    supplier: request.supplier,
    supplierName: request.supplierName,
    documentNumber: request.documentNumber,
    documentDate: isoDate(request.documentDate),
    currency: request.currency,
    subtotalAmount: decimalToNumber(request.subtotalAmount),
    taxAmount: decimalToNumber(request.taxAmount),
    totalAmount: decimalToNumber(request.totalAmount),
    totalAmountBase: decimalToNumber(request.totalAmountBase),
    requiredDate: isoDate(request.requiredDate),
    poNumber: request.poNumber,
    ruleEvaluation: request.ruleEvaluation,
    approvalRoute: request.approvalRoute,
    items: request.items.map((item) => ({
      id: item.id,
      lineNo: item.lineNo,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: decimalToNumber(item.unitPrice),
      lineTotal: decimalToNumber(item.lineTotal),
    })),
    documents: request.documents.map((document) => presentDocument(document, threshold)),
    approvals: request.approvals.map((approval) => ({
      id: approval.id,
      approvalLevel: approval.approvalLevel,
      approverGroup: approval.approverGroup,
      department: approval.department,
      decision: approval.decision,
      approver: approval.approver,
      comments: approval.comments,
      activatedAt: approval.activatedAt,
      decidedAt: approval.decidedAt,
    })),
    automationJob: job ? { ...job } : null,
    documentSettings: configuration
      ? {
          required: configuration.document.required,
          confidenceThreshold: configuration.document.confidenceThreshold,
          maxFileSizeMb: configuration.document.maxFileSizeMb,
          allowedMimeTypes: configuration.document.allowedMimeTypes,
        }
      : null,
    allowedActions: computeAllowedActions(user, request, configuration, options),
    submittedAt: request.submittedAt,
    approvedAt: request.approvedAt,
    completedAt: request.completedAt,
    cancelledAt: request.cancelledAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export function parseConfiguration(raw: unknown): WorkflowConfiguration | null {
  const parsed = safeParseWorkflowConfiguration(raw);
  return parsed.success ? parsed.data : null;
}
