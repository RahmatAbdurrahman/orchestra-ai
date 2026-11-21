'use client';

/**
 * Shared motion patterns. They are thin wrappers over CSS animations defined in globals.css, so
 * there is no animation runtime; prefers-reduced-motion collapses every one of them to an instant
 * state change (see the media query at the end of globals.css).
 *
 * Patterns provided elsewhere: modal, dropdown and tooltip transitions (components/ui/overlays.tsx),
 * toasts (sonner, app/providers.tsx), skeleton shimmer (Skeleton), hover lift (`hover-lift` utility),
 * chart reveal (recharts animation tuned with MOTION.chart).
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Motion tokens for JavaScript consumers (charts, count-up). Mirrors the CSS tokens. */
export const MOTION = Object.freeze({
  micro: 150,
  dropdown: 160,
  card: 260,
  modal: 220,
  page: 220,
  chart: 550,
  countUp: 700,
  easeOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
});

const delayStyle = (delay?: number, style?: CSSProperties): CSSProperties | undefined =>
  delay ? { ...style, animationDelay: `${delay}ms` } : style;

/** Opacity-only entrance. */
export function FadeIn({ delay, className, style, children }: { delay?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={cn('animate-fade-in', className)} style={delayStyle(delay, style)}>
      {children}
    </div>
  );
}

/** Short upward entrance for cards and sections. */
export function SlideUp({ delay, className, style, children }: { delay?: number; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={cn('animate-fade-up', className)} style={delayStyle(delay, style)}>
      {children}
    </div>
  );
}

/** Children enter one after another (40 ms apart, capped). */
export function Stagger({ className, children, as: Tag = 'div' }: { className?: string; children: ReactNode; as?: 'div' | 'ol' | 'ul' | 'section' }) {
  return <Tag className={cn('stagger', className)}>{children}</Tag>;
}

/** Height transition between collapsed and expanded without measuring (CSS grid rows). */
export function Collapse({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: ReactNode }) {
  return (
    <div
      id={id}
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-[260ms] ease-[var(--ease-out)]',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/** Expands its content right after mounting, for details that are rendered on demand. */
export function ExpandOnMount({ className, children }: { className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <Collapse open={open} className={className}>
      {children}
    </Collapse>
  );
}
