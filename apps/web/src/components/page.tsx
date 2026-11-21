'use client';

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RotateCw, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <div className="text-xs font-medium tracking-wide text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description ? <p className="max-w-3xl text-sm leading-6 text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">{actions}</div> : null}
    </div>
  );
}

export function SectionHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex flex-wrap items-end justify-between gap-2', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/** A filter/search strip that sits above a table. */
export function Toolbar({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:items-center', className)}>{children}</div>;
}

export function LoadingBlock({ rows = 4, className, label = 'Loading' }: { rows?: number; className?: string; label?: string }) {
  return (
    <div className={cn('space-y-2.5', className)} aria-busy="true" role="status">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" style={{ opacity: 1 - index * (0.5 / Math.max(rows, 1)) }} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <Alert tone="danger" className={cn('mb-4', className)}>
      <AlertTriangle className="size-4" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{errorMessage(error)}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw /> Try again
          </Button>
        ) : null}
      </div>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  compact,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  className?: string;
}) {
  const body = (
    <div className={cn('flex animate-fade-up flex-col items-center gap-2 text-center', compact ? 'py-8' : 'py-14')}>
      <span className="mb-1 flex size-11 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
  if (compact) return <div className={className}>{body}</div>;
  return (
    <Card className={cn('border-dashed shadow-none', className)}>
      <CardContent className="px-6 pb-0">{body}</CardContent>
    </Card>
  );
}

export function KeyValue({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const records = `${total.toLocaleString('en-US')} record${total === 1 ? '' : 's'}`;
  if (totalPages <= 1) return <p className="mt-3 px-1 text-xs text-muted-foreground">{records}</p>;
  return (
    <nav className="mt-3 flex items-center justify-between gap-3 px-1 text-sm" aria-label="Pagination">
      <span className="text-xs text-muted-foreground">
        Page <span className="font-medium text-foreground tabular-nums">{page}</span> of <span className="tabular-nums">{totalPages}</span> · {records}
      </span>
      <div className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft /> Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
          Next <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- Metrics

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Animates from the previously shown value to `target`. Only runs for real numbers;
 * null/undefined stay null so the caller can render "unavailable".
 */
export function useCountUp(target: number | null | undefined, duration = 700): number | null {
  const [value, setValue] = useState<number | null>(target ?? null);
  const from = useRef<number>(0);
  useEffect(() => {
    if (target === null || target === undefined || !Number.isFinite(target)) {
      setValue(null);
      return;
    }
    if (prefersReducedMotion()) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(origin + (target - origin) * eased);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

export type StatTone = 'default' | 'success' | 'danger' | 'warning';

const STAT_TONES: Record<StatTone, string> = {
  default: 'bg-primary/10 text-primary dark:text-info-foreground',
  success: 'bg-success/10 text-success-foreground',
  danger: 'bg-destructive/10 text-destructive-foreground',
  warning: 'bg-warning/12 text-warning-foreground',
};

/**
 * KPI tile. `value` is the real metric (null = not available, rendered as "—" with an explanation),
 * `format` renders it; integers count up when data arrives.
 */
export function StatCard({
  label,
  value,
  format = (n) => Math.round(n).toLocaleString('en-US'),
  hint,
  unavailableHint = 'Not enough data yet',
  icon: Icon,
  tone = 'default',
  testId,
}: {
  label: string;
  value: number | null;
  format?: (value: number) => string;
  hint?: ReactNode;
  unavailableHint?: string;
  icon: LucideIcon;
  tone?: StatTone;
  testId?: string;
}) {
  const animated = useCountUp(value);
  const unavailable = value === null;
  return (
    <Card className="group relative overflow-hidden transition-[box-shadow,border-color] duration-200 hover:border-border-strong hover:shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 px-4 pt-4 pb-4 sm:px-5 sm:pt-5 sm:pb-5">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate text-[13px] font-medium text-muted-foreground" title={label}>
            {label}
          </p>
          <p
            className={cn('text-[1.625rem] leading-none font-semibold tracking-tight tabular-nums', unavailable && 'text-subtle-foreground')}
            data-testid={testId}
            aria-label={unavailable ? `${label}: not available` : undefined}
          >
            {unavailable || animated === null ? '—' : format(animated)}
          </p>
          <p className="line-clamp-2 text-xs text-muted-foreground sm:truncate">{unavailable ? unavailableHint : hint}</p>
        </div>
        <span
          className={cn(
            'hidden size-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 min-[480px]:flex',
            STAT_TONES[tone],
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}
