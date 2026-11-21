import type { PurchaseRequestStatus } from '@orchestra/domain';
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

/** Visual position of the request in the PR -> PO workflow. */
export function ProgressSteps({ status }: { status: PurchaseRequestStatus }) {
  const stopped = status === 'REJECTED' || status === 'CANCELLED';
  const currentIndex = stopped ? -1 : STEPS.findIndex((step) => step.statuses.includes(status));
  const failed = status === 'FAILED';
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto pb-1" aria-label="Workflow progress">
      {STEPS.map((step, index) => {
        const done = !stopped && (index < currentIndex || status === 'COMPLETED');
        const current = index === currentIndex && status !== 'COMPLETED';
        return (
          <li key={step.label} className="flex min-w-24 flex-1 items-center gap-2">
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors duration-300',
                current && 'ring-4 ring-primary/15',
                done && 'border-success bg-success text-white',
                current && !failed && 'border-primary bg-primary text-primary-foreground',
                current && failed && 'border-destructive bg-destructive text-white',
                !done && !current && 'text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : current && failed ? <X className="size-3.5" /> : index + 1}
            </span>
            <span className={cn('text-xs whitespace-nowrap', current ? 'font-semibold' : 'text-muted-foreground')}>
              {step.label}
              <span className="sr-only">{done ? ' (done)' : current ? (failed ? ' (failed)' : ' (current)') : ''}</span>
            </span>
            {index < STEPS.length - 1 ? <span className={cn('h-0.5 flex-1 rounded-full transition-colors duration-500', done ? 'bg-success' : 'bg-border')} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
