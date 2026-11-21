import type {
  ApprovalDecision,
  ApprovalGroup,
  AutomationAttemptStatus,
  AutomationJobStatus,
  DocumentProcessingStatus,
  ExtractionResult,
  NotificationType,
  Permission,
  PurchaseRequestStatus,
  RoleName,
  RuleEvaluationResult,
  VerifiableField,
  WorkflowConfiguration,
} from '@orchestra/domain';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Me {
  id: string;
  name: string;
  email: string;
  department: { id: string; code: string; name: string; isFinance: boolean } | null;
  roles: RoleName[];
  permissions: Permission[];
  lastLoginAt: string | null;
  policy: { adminCanApprove: boolean; adminCanOperateAutomation: boolean };
}

export interface Ref {
  id: string;
  name: string;
}

export interface PurchaseRequestRow {
  id: string;
  requestNumber: string;
  title: string;
  status: PurchaseRequestStatus;
  supplierName: string | null;
  currency: string;
  totalAmount: number;
  requiredDate: string | null;
  poNumber: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  requester: Ref;
  department: Ref;
  automationJob: { id: string; status: AutomationJobStatus } | null;
}

export interface DocumentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: DocumentProcessingStatus;
  processingError: string | null;
  confidenceScore: number | null;
  extraction: ExtractionResult | null;
  lowConfidenceFields: VerifiableField[];
  verifiedData: VerifiedData | null;
  processedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: Ref | null;
  uploadedBy: Ref;
  createdAt: string;
}

export interface VerifiedData {
  supplierId: string | null;
  supplierName: string;
  documentNumber: string | null;
  documentDate: string | null;
  currency: string;
  requiredDate: string;
  taxAmount: number;
  items: Array<{ description: string; quantity: number; unitPrice: number; unit?: string }>;
  acknowledgedFields: string[];
}

export interface ApprovalView {
  id: string;
  approvalLevel: number;
  approverGroup: ApprovalGroup;
  department: Ref | null;
  decision: ApprovalDecision;
  approver: Ref | null;
  comments: string | null;
  activatedAt: string | null;
  decidedAt: string | null;
}

export interface AllowedActions {
  edit: boolean;
  submit: boolean;
  cancel: boolean;
  uploadDocument: boolean;
  verify: boolean;
  reprocessDocument: boolean;
  approvalId: string | null;
  dispatchAutomation: boolean;
  retryAutomation: boolean;
  cancelAutomation: boolean;
}

export interface PurchaseRequestDetail {
  id: string;
  requestNumber: string;
  title: string;
  description: string | null;
  status: PurchaseRequestStatus;
  statusReason: string | null;
  requester: Ref & { email: string };
  department: Ref & { code: string };
  workflow: { id: string; key: string; name: string; version: number };
  supplier: { id: string; code: string; name: string; isActive: boolean } | null;
  supplierName: string | null;
  documentNumber: string | null;
  documentDate: string | null;
  currency: string;
  subtotalAmount: number;
  taxAmount: number;
  totalAmount: number;
  totalAmountBase: number | null;
  requiredDate: string | null;
  poNumber: string | null;
  ruleEvaluation: RuleEvaluationResult | null;
  approvalRoute: ApprovalGroup[];
  items: Array<{ id: string; lineNo: number; description: string; quantity: number; unit: string | null; unitPrice: number; lineTotal: number }>;
  documents: DocumentView[];
  approvals: ApprovalView[];
  automationJob: {
    id: string;
    status: AutomationJobStatus;
    attemptCount: number;
    maxAutoAttempts: number;
    maxTotalAttempts: number;
    uipathJobId: string | null;
    poNumber: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    requiresIntervention: boolean;
    nextAttemptAt: string | null;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    idempotencyKey: string;
  } | null;
  documentSettings: { required: boolean; confidenceThreshold: number; maxFileSizeMb: number; allowedMimeTypes: string[] } | null;
  allowedActions: AllowedActions;
  submittedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  purchaseRequestId?: string | null;
  actorType: 'USER' | 'SYSTEM' | 'ROBOT';
  actor: (Ref & { email?: string }) | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  correlationId: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

export interface PendingApproval {
  id: string;
  approvalLevel: number;
  approverGroup: ApprovalGroup;
  department: Ref | null;
  activatedAt: string;
  purchaseRequest: {
    id: string;
    requestNumber: string;
    title: string;
    supplierName: string | null;
    currency: string;
    totalAmount: number;
    totalAmountBase: number | null;
    requiredDate: string | null;
    submittedAt: string | null;
    requester: Ref;
    department: Ref;
    levels: number;
    warningCount: number;
  };
}

export interface AutomationJobRow {
  id: string;
  status: AutomationJobStatus;
  processName: string;
  idempotencyKey: string;
  correlationId: string;
  attemptCount: number;
  maxAutoAttempts: number;
  maxTotalAttempts: number;
  uipathJobId: string | null;
  poNumber: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  requiresIntervention: boolean;
  canRetry: boolean;
  nextAttemptAt: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastPolledAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  purchaseRequest: { id: string; requestNumber: string; title: string; status: PurchaseRequestStatus; currency: string; totalAmount: number };
}

export interface AutomationAttemptView {
  id: string;
  attemptNo: number;
  reference: string;
  status: AutomationAttemptStatus;
  triggeredBy: 'USER' | 'SYSTEM' | 'ROBOT';
  uipathJobId: string | null;
  uipathState: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pollCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean | null;
  outputArguments: Record<string, unknown> | null;
  screenshotRef: string | null;
  createdAt: string;
}

export interface AutomationJobDetail extends AutomationJobRow {
  workflow: { id: string; name: string; key: string };
  inputPayload: Record<string, unknown>;
  outputData: Record<string, unknown> | null;
  attempts: AutomationAttemptView[];
  integrationMode: string;
}

export interface AutomationLogView {
  id: string;
  attemptNo: number | null;
  level: 'INFO' | 'WARN' | 'ERROR';
  eventType: string;
  message: string;
  metadata: Record<string, unknown> | null;
  correlationId: string | null;
  createdAt: string;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface DashboardSummary {
  period: { from: string; to: string };
  scope: string;
  totals: {
    activeWorkflows: number;
    requests: number;
    pendingApprovals: number;
    runningJobs: number;
    completedJobs: number;
    failedJobs: number;
    jobsNeedingAttention: number;
    successRate: number | null;
    avgExecutionSeconds: number | null;
  };
  requestsByStatus: Partial<Record<PurchaseRequestStatus, number>>;
}

export interface AutomationMetrics {
  daily: Array<{ date: string; completed: number; failed: number; avgDurationSeconds: number | null }>;
  statusBreakdown: Record<string, number>;
  attempts: { total: number; automaticRetries: number; operatorRetries: number };
  failureReasons: Array<{ code: string; count: number }>;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  isFinance: boolean;
}

export interface UserView {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  department: (Ref & { code: string }) | null;
  roles: RoleName[];
  lastLoginAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
}

export interface WorkflowView {
  id: string;
  key: string;
  name: string;
  description: string | null;
  workflowType: string;
  configuration: WorkflowConfiguration;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  _count?: { purchaseRequests: number };
  versions?: Array<{ id: string; version: number; changeNote: string | null; createdAt: string; createdBy: Ref | null }>;
}

export interface UiPathHealth {
  ok: boolean;
  configured: boolean;
  mode: 'cloud' | 'onprem' | 'mock';
  isMock: boolean;
  authenticated: boolean;
  folderAccessible: boolean;
  processFound: boolean;
  processName: string;
  latencyMs: number;
  checkedAt: string;
  message: string | null;
  orchestratorUrl: string | null;
  folderId: string | null;
}

export interface SystemHealth {
  status: 'ok' | 'degraded';
  checks: {
    database: 'up' | 'down';
    queue: { driver: string; status: 'up' | 'down' };
    documentIntelligence: 'up' | 'down';
    uipath: 'configured' | 'not-configured';
  };
  time: string;
}
