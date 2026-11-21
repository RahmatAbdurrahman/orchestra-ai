import {
  Bot,
  Building2,
  CheckSquare,
  FileScan,
  FileText,
  KeyRound,
  PlugZap,
  Settings2,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'info' | 'primary' | 'success' | 'warning' | 'danger';

const CATEGORIES: Array<{ prefix: string; label: string; icon: LucideIcon; tone: Tone }> = [
  { prefix: 'AUTH.', label: 'Authentication', icon: KeyRound, tone: 'neutral' },
  { prefix: 'USER.', label: 'User management', icon: UserCog, tone: 'primary' },
  { prefix: 'WORKFLOW.', label: 'Workflow', icon: Settings2, tone: 'primary' },
  { prefix: 'SUPPLIER.', label: 'Supplier', icon: Building2, tone: 'neutral' },
  { prefix: 'PURCHASE_REQUEST.', label: 'Purchase request', icon: FileText, tone: 'info' },
  { prefix: 'DOCUMENT.', label: 'Document', icon: FileScan, tone: 'info' },
  { prefix: 'APPROVAL.', label: 'Approval', icon: CheckSquare, tone: 'warning' },
  { prefix: 'AUTOMATION.', label: 'Automation', icon: Bot, tone: 'primary' },
  { prefix: 'INTEGRATION.', label: 'Integration', icon: PlugZap, tone: 'neutral' },
];

const TONES: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground ring-border',
  info: 'bg-info/10 text-info-foreground ring-info/20',
  primary: 'bg-primary/10 text-primary ring-primary/20 dark:text-info-foreground',
  success: 'bg-success/10 text-success-foreground ring-success/25',
  warning: 'bg-warning/12 text-warning-foreground ring-warning/25',
  danger: 'bg-destructive/10 text-destructive-foreground ring-destructive/25',
};

/** Category of an audit action code, e.g. "APPROVAL.APPROVED" -> Approval. */
export function eventCategory(action: string) {
  return CATEGORIES.find((category) => action.startsWith(category.prefix)) ?? { prefix: '', label: 'Event', icon: FileText, tone: 'neutral' as Tone };
}

function outcomeTone(action: string, fallback: Tone): Tone {
  if (/(FAILED|REJECTED|CANCELLED|DEACTIVATED)$/.test(action)) return 'danger';
  if (/(COMPLETED|APPROVED|SUCCEEDED|VERIFIED|ACTIVATED)$/.test(action)) return 'success';
  return fallback;
}

/**
 * Icon tile for an audit event, derived only from its action code. Decorative: the event text next
 * to it carries the meaning, so the tile is hidden from assistive technology.
 */
export function EventIcon({ action, className }: { action: string; className?: string }) {
  const category = eventCategory(action);
  const Icon = category.icon;
  return (
    <span
      aria-hidden
      title={category.label}
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONES[outcomeTone(action, category.tone)], className)}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
