import {
  APPROVAL_DECISION_LABELS,
  AUTOMATION_JOB_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  type ApprovalDecision,
  type AutomationJobStatus,
  type DocumentProcessingStatus,
  type PurchaseRequestStatus,
} from '@orchestra/domain';
import { Badge, type BadgeTone } from '@/components/ui/primitives';

const REQUEST_TONES: Record<PurchaseRequestStatus, BadgeTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  PROCESSING_DOCUMENT: 'info',
  NEEDS_VERIFICATION: 'warning',
  PENDING_APPROVAL: 'warning',
  REJECTED: 'danger',
  APPROVED: 'primary',
  QUEUED: 'primary',
  RUNNING: 'primary',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const JOB_TONES: Record<AutomationJobStatus, BadgeTone> = {
  QUEUED: 'neutral',
  SUBMITTING: 'info',
  PENDING: 'info',
  RUNNING: 'primary',
  COMPLETED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

const DOCUMENT_TONES: Record<DocumentProcessingStatus, BadgeTone> = {
  UPLOADED: 'neutral',
  QUEUED: 'info',
  PROCESSING: 'info',
  COMPLETED: 'warning',
  FAILED: 'danger',
  VERIFIED: 'success',
};

const DECISION_TONES: Record<ApprovalDecision, BadgeTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SKIPPED: 'neutral',
};

function Dot({ pulse }: { pulse?: boolean }) {
  return <span className={`size-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} />;
}

export function RequestStatusBadge({ status }: { status: PurchaseRequestStatus }) {
  const active = ['PROCESSING_DOCUMENT', 'QUEUED', 'RUNNING', 'SUBMITTED'].includes(status);
  return (
    <Badge tone={REQUEST_TONES[status]} data-testid="request-status">
      <Dot pulse={active} />
      {PURCHASE_REQUEST_STATUS_LABELS[status]}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: AutomationJobStatus }) {
  const active = ['SUBMITTING', 'PENDING', 'RUNNING'].includes(status);
  return (
    <Badge tone={JOB_TONES[status]} data-testid="job-status">
      <Dot pulse={active} />
      {AUTOMATION_JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

export function DocumentStatusBadge({ status }: { status: DocumentProcessingStatus }) {
  return <Badge tone={DOCUMENT_TONES[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

export function DecisionBadge({ decision }: { decision: ApprovalDecision }) {
  return <Badge tone={DECISION_TONES[decision]}>{APPROVAL_DECISION_LABELS[decision]}</Badge>;
}

export function ConfidenceBadge({ value, threshold = 0.85 }: { value: number | null | undefined; threshold?: number }) {
  if (value === null || value === undefined) return <Badge tone="neutral">n/a</Badge>;
  const tone: BadgeTone = value >= threshold ? 'success' : value >= threshold - 0.2 ? 'warning' : 'danger';
  return <Badge tone={tone}>{Math.round(value * 100)}%</Badge>;
}
