import { PURCHASE_REQUEST_STATUS_LABELS, type PurchaseRequestStatus } from '@orchestra/domain';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const STEPS: Array<{ label: string; statuses: PurchaseRequestStatus[] }> = [
  { label: 'Draft', statuses: ['DRAFT'] },
  { label: 'Document', statuses: ['SUBMITTED', 'PROCESSING_DOCUMENT'] },
  { label: 'Verification', statuses: ['NEEDS_VERIFICATION'] },
  { label: 'Approval', statuses: ['PENDING_APPROVAL'] },
  { label: 'Automation', statuses: ['APPROVED', 'QUEUED', 'RUNNING', 'FAILED'] },
  { label: 'PO created', statuses: ['COMPLETED'] },
];

/** Where a status sits in the PR -> PO workflow (derived from the status only). */
function stageOf(status: PurchaseRequestStatus) {
  const stopped = status === 'REJECTED' || status === 'CANCELLED';
  return {
    stopped,
    failed: status === 'FAILED',
    completed: status === 'COMPLETED',
    currentIndex: stopped ? -1 : STEPS.findIndex((step) => step.statuses.includes(status)),
  };
}

/** Visual position of the request in the PR -> PO workflow. */
export function ProgressSteps({ status }: { status: PurchaseRequestStatus }) {
  const { stopped, failed, completed, currentIndex } = stageOf(status);
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto pb-1" aria-label="Workflow progress">
      {STEPS.map((step, index) => {
        const done = !stopped && (index < currentIndex || completed);
        const current = index === currentIndex && !completed;
        return (
          <li key={step.label} className="flex min-w-24 flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 animate-fade-in items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-300',
                current && 'ring-4 ring-primary/15',
                done && 'border-success bg-success text-white',
                current && !failed && 'border-primary bg-primary text-primary-foreground',
                current && failed && 'border-destructive bg-destructive text-white ring-destructive/15',
                !done && !current && 'bg-card text-muted-foreground',
              )}
              style={{ animationDelay: `${index * 70}ms` }}
            >
              {done ? <Check className="size-3.5" /> : current && failed ? <X className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('text-xs whitespace-nowrap', current ? 'font-semibold' : 'text-muted-foreground')}>
              {step.label}
              <span className="sr-only">{done ? ' (done)' : current ? (failed ? ' (failed)' : ' (current)') : ''}</span>
            </span>
            {index < STEPS.length - 1 ? (
              <span className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-border" aria-hidden>
                <span
                  className={cn(
                    'absolute inset-0 origin-left rounded-full bg-success transition-transform duration-500 ease-[var(--ease-out)]',
                    done ? 'scale-x-100' : 'scale-x-0',
                  )}
                  style={{ transitionDelay: `${index * 80}ms` }}
                />
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Compact six-segment meter of the same workflow position, for table rows. Decorative: the status
 * badge next to it states the status in words.
 */
export function StageMeter({ status, className }: { status: PurchaseRequestStatus; className?: string }) {
  const { stopped, failed, completed, currentIndex } = stageOf(status);
  return (
    <span aria-hidden className={cn('flex items-center gap-0.5', className)} title={`Workflow stage: ${PURCHASE_REQUEST_STATUS_LABELS[status]}`}>
      {STEPS.map((step, index) => (
        <span
          key={step.label}
          className={cn(
            'h-1 w-2.5 rounded-full transition-colors duration-300',
            stopped
              ? 'bg-border'
              : completed || index < currentIndex
                ? 'bg-success/80'
                : index === currentIndex
                  ? failed
                    ? 'bg-destructive'
                    : 'bg-primary'
                  : 'bg-border',
          )}
        />
      ))}
    </span>
  );
}
