'use client';

import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RotateCw, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Orbi, type OrbiExpression } from '@/components/brand';
import { MOTION } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Icon tile used by page headers; shares the sidebar icon for the same module. */
function HeaderIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="relative hidden size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card text-primary shadow-sm inset-shadow-[0_1px_0_0_var(--surface-highlight)] sm:flex dark:text-info-foreground">
      <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary/14 via-primary/4 to-transparent" />
      <Icon className="relative size-5" aria-hidden />
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  icon,
  leading,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  /** Module icon (decorative), shown from the sm breakpoint. */
  icon?: LucideIcon;
  /** Custom leading visual (e.g. ORBI on the dashboard); replaces the icon tile. */
  leading?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
      <div className="flex min-w-0 items-start gap-4">
        {leading ? <div className="hidden shrink-0 sm:block">{leading}</div> : icon ? <HeaderIcon icon={icon} /> : null}
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? <div className="text-xs font-medium tracking-wide text-muted-foreground">{eyebrow}</div> : null}
          <h1 className="font-display text-xl leading-tight font-semibold tracking-[-0.015em] text-balance sm:text-2xl">{title}</h1>
          {description ? <p className="max-w-3xl text-sm leading-6 text-pretty text-muted-foreground">{description}</p> : null}
        </div>
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

/** Small uppercase label that groups a row of related content (e.g. KPI groups). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('mb-2.5 flex items-center gap-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase', className)}>
      <span aria-hidden className="h-px w-4 bg-gradient-to-r from-primary/60 to-transparent" />
      {children}
    </p>
  );
}

/** A filter/search strip that sits above a table, on its own quiet surface. */
export function Toolbar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('mb-4 flex flex-col gap-2 rounded-xl border bg-card/70 p-2 shadow-xs sm:flex-row sm:items-center', className)}>{children}</div>
  );
}

/**
 * Thin indeterminate bar for a list that is refetching after a filter or page change. It shows only
 * while a request is actually in flight and never implies a percentage.
 */
export function FetchingBar({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden rounded-t-xl transition-opacity duration-200',
        active ? 'opacity-100' : 'opacity-0',
      )}
    >
      {active ? <div className="h-full w-1/3 animate-indeterminate bg-gradient-to-r from-transparent via-primary to-transparent" /> : null}
    </div>
  );
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

const EMPTY_TONES = {
  default: 'text-muted-foreground',
  success: 'text-success-foreground',
  primary: 'text-primary dark:text-info-foreground',
} as const;

/** Icon composition for empty states: the module icon inside soft rings with orbiting dots. */
function EmptyIllustration({ icon: Icon, tone }: { icon: LucideIcon; tone: keyof typeof EMPTY_TONES }) {
  return (
    <span aria-hidden className="relative mb-2 flex size-20 items-center justify-center">
      <span className="absolute inset-0 rounded-full border border-dashed border-border-strong/70" />
      <span className="absolute inset-2.5 rounded-full border bg-gradient-to-b from-muted/80 to-transparent" />
      <span className="absolute top-1 right-3 size-1.5 rounded-full bg-primary/50" />
      <span className="absolute bottom-3 left-1 size-1 rounded-full bg-primary/35" />
      <span className="absolute top-1/2 -right-0.5 size-1 rounded-full bg-border-strong" />
      <span className={cn('relative flex size-10 items-center justify-center rounded-full border bg-card shadow-sm', EMPTY_TONES[tone])}>
        <Icon className="size-[18px]" />
      </span>
    </span>
  );
}

/** ORBI on a soft brand glow, for empty states and onboarding moments. */
function MascotIllustration({ expression }: { expression: OrbiExpression }) {
  return (
    <span aria-hidden className="relative mb-1 flex size-28 items-center justify-center">
      <span className="absolute inset-2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand-cyan)_16%,transparent),transparent)]" />
      <Orbi expression={expression} size={104} className="relative" />
    </span>
  );
}

/**
 * Page-level failure (the page's own data could not be loaded). Shows the real error message;
 * ORBI only sets the tone. Inline errors inside a page keep using ErrorBlock.
 */
export function ErrorState({ error, onRetry, title = 'This page could not be loaded' }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <Card className="relative overflow-hidden border-destructive-border">
      <CardContent className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <Orbi expression="error" size={104} />
        <h1 className="font-display text-base font-semibold">{title}</h1>
        <p className="max-w-md text-sm text-muted-foreground" role="alert">
          {errorMessage(error)}
        </p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RotateCw /> Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = Inbox,
  tone = 'default',
  mascot,
  compact,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof EMPTY_TONES;
  /** Show ORBI with this expression instead of the icon composition (full-size empty states). */
  mascot?: OrbiExpression;
  compact?: boolean;
  className?: string;
}) {
  const body = (
    <div className={cn('flex animate-fade-up flex-col items-center gap-1.5 text-center', compact ? 'py-6' : mascot ? 'py-9' : 'py-12')}>
      {mascot ? <MascotIllustration expression={mascot} /> : <EmptyIllustration icon={icon} tone={tone} />}
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-[13px] leading-5 text-pretty text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
  if (compact) return <div className={className}>{body}</div>;
  return (
    <Card className={cn('relative overflow-hidden border-dashed bg-card/70 shadow-none inset-shadow-none', className)}>
      <div aria-hidden className="decor-dots decor-fade-radial pointer-events-none absolute inset-0 opacity-60" />
      <CardContent className="relative px-6 pb-0">{body}</CardContent>
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
export function useCountUp(target: number | null | undefined, duration: number = MOTION.countUp): number | null {
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

const STAT_TONES: Record<StatTone, { tile: string; color: string }> = {
  default: { tile: 'bg-primary-soft text-primary dark:text-info-foreground', color: 'var(--primary)' },
  success: { tile: 'bg-success-soft text-success-foreground', color: 'var(--success)' },
  danger: { tile: 'bg-destructive-soft text-destructive-foreground', color: 'var(--destructive)' },
  warning: { tile: 'bg-warning-soft text-warning-foreground', color: 'var(--warning)' },
};

/**
 * KPI tile. `value` is the real metric (null = not available, rendered as "—" with a reason),
 * `format` renders it; values count up when data arrives.
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
  const style = STAT_TONES[tone];
  return (
    <Card className="group relative overflow-hidden transition-[box-shadow,border-color,transform] duration-200 hover:-translate-y-px hover:border-border-interactive hover:shadow-md" style={{ '--tone': style.color } as CSSProperties}>
      {/* Decorative depth: a tone-coloured corner glow and a top hairline that brightens on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-12 size-36 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--tone)_16%,transparent),transparent)] opacity-70 transition-opacity duration-300 group-hover:opacity-100"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_oklab,var(--tone)_55%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <CardContent className="relative flex items-start justify-between gap-3 px-4 pt-4 pb-4 sm:px-5 sm:pt-5 sm:pb-5">
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
            'hidden size-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ring-current/15 transition-transform duration-200 group-hover:scale-105 min-[480px]:flex',
            style.tile,
          )}
        >
          <Icon className="size-[18px]" aria-hidden />
        </span>
      </CardContent>
    </Card>
  );
}
