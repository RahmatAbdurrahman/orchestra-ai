import {
  APPROVAL_DECISION_LABELS,
  AUTOMATION_JOB_STATUS_LABELS,
  DOCUMENT_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_LABELS,
  ROLE_LABELS,
  type ApprovalDecision,
  type AutomationJobStatus,
  type DocumentProcessingStatus,
  type PurchaseRequestStatus,
  type RoleName,
} from '@orchestra/domain';
import { Bot, Check, CheckSquare, Clock3, Eye, FilePlus2, Minus, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

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

const DECISION_STYLE: Record<ApprovalDecision, { tone: BadgeTone; icon: LucideIcon }> = {
  PENDING: { tone: 'warning', icon: Clock3 },
  APPROVED: { tone: 'success', icon: Check },
  REJECTED: { tone: 'danger', icon: X },
  SKIPPED: { tone: 'neutral', icon: Minus },
};

function Dot({ pulse }: { pulse?: boolean }) {
  return <span aria-hidden className={cn('size-1.5 rounded-full bg-current', pulse && 'animate-pulse')} />;
}

/** The label re-enters briefly whenever the status really changes (keyed on the value). */
function StatusLabel({ value, children }: { value: string; children: string }) {
  return (
    <span key={value} className="animate-status-in">
      {children}
    </span>
  );
}

export function RequestStatusBadge({ status }: { status: PurchaseRequestStatus }) {
  const active = ['PROCESSING_DOCUMENT', 'QUEUED', 'RUNNING', 'SUBMITTED'].includes(status);
  return (
    <Badge tone={REQUEST_TONES[status]} data-testid="request-status">
      <Dot pulse={active} />
      <StatusLabel value={status}>{PURCHASE_REQUEST_STATUS_LABELS[status]}</StatusLabel>
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: AutomationJobStatus }) {
  const active = ['SUBMITTING', 'PENDING', 'RUNNING'].includes(status);
  return (
    <Badge tone={JOB_TONES[status]} data-testid="job-status">
      <Dot pulse={active} />
      <StatusLabel value={status}>{AUTOMATION_JOB_STATUS_LABELS[status]}</StatusLabel>
    </Badge>
  );
}

export function DocumentStatusBadge({ status }: { status: DocumentProcessingStatus }) {
  return <Badge tone={DOCUMENT_TONES[status]}>{DOCUMENT_STATUS_LABELS[status]}</Badge>;
}

export function DecisionBadge({ decision }: { decision: ApprovalDecision }) {
  const style = DECISION_STYLE[decision];
  return (
    <Badge tone={style.tone}>
      <style.icon aria-hidden />
      {APPROVAL_DECISION_LABELS[decision]}
    </Badge>
  );
}

export function ConfidenceBadge({ value, threshold = 0.85 }: { value: number | null | undefined; threshold?: number }) {
  if (value === null || value === undefined) return <Badge tone="neutral">n/a</Badge>;
  const tone: BadgeTone = value >= threshold ? 'success' : value >= threshold - 0.2 ? 'warning' : 'danger';
  return <Badge tone={tone}>{Math.round(value * 100)}%</Badge>;
}

/** Role icons give each role a recognisable mark; colour is decorative only (the label says the role). */
const ROLE_STYLE: Record<RoleName, { icon: LucideIcon; color: string }> = {
  ADMIN: { icon: ShieldCheck, color: 'text-blue-600 dark:text-blue-400' },
  REQUESTER: { icon: FilePlus2, color: 'text-sky-600 dark:text-sky-400' },
  APPROVER: { icon: CheckSquare, color: 'text-emerald-600 dark:text-emerald-400' },
  OPERATOR: { icon: Bot, color: 'text-violet-600 dark:text-violet-400' },
  VIEWER: { icon: Eye, color: 'text-slate-500 dark:text-slate-400' },
};

export function RoleBadge({ role, className }: { role: RoleName; className?: string }) {
  const style = ROLE_STYLE[role];
  return (
    <Badge tone="neutral" className={className}>
      <style.icon aria-hidden className={style.color} />
      {ROLE_LABELS[role]}
    </Badge>
  );
}
