'use client';

/**
 * Orchestra AI brand components. The artwork itself lives in lib/brand-art.ts (the single source of
 * truth shared with the static files in public/brand and the app icons); these components only add
 * unique ids, sizing, theming and accessibility.
 */
import { useId } from 'react';
import { ORBI_LABELS, orbiInner, symbolInner, type OrbiExpression } from '@/lib/brand-art';
import { cn } from '@/lib/utils';

export type { OrbiExpression } from '@/lib/brand-art';

/** Gradient and mask ids must be unique per instance; React ids contain characters SVG urls dislike. */
function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

function a11y(title: string | undefined) {
  return title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
}

/** The orbital O. Decorative unless a title is given. `mono` follows the current text colour. */
export function OrchestraSymbol({ className, mono, title }: { className?: string; mono?: boolean; title?: string }) {
  const id = useSvgId('oa');
  return (
    <svg
      viewBox="0 0 48 48"
      focusable="false"
      className={cn('shrink-0', className)}
      {...a11y(title)}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + symbolInner(id, { mono }) }}
    />
  );
}

/** "Orchestra AI" in Sora 700; "AI" carries the brand gradient. Real text, so it is read and translated. */
export function Wordmark({ className, mono }: { className?: string; mono?: boolean }) {
  return (
    <span className={cn('font-display font-bold tracking-[-0.02em] whitespace-nowrap', className)}>
      Orchestra <span className={mono ? undefined : 'text-brand-gradient'}>AI</span>
    </span>
  );
}

/** Primary logo: symbol + wordmark, with an optional tagline. Colour of the wordmark follows the context. */
export function OrchestraLogo({
  className,
  symbolClassName,
  wordmarkClassName,
  tagline,
  taglineClassName,
  mono,
}: {
  className?: string;
  symbolClassName?: string;
  wordmarkClassName?: string;
  tagline?: string;
  taglineClassName?: string;
  mono?: boolean;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <OrchestraSymbol className={cn('size-9', symbolClassName)} mono={mono} />
      <span className="min-w-0 leading-none">
        <Wordmark className={cn('block text-[17px] leading-5', wordmarkClassName)} mono={mono} />
        {tagline ? <span className={cn('mt-0.5 block text-[11px] leading-4 opacity-70', taglineClassName)}>{tagline}</span> : null}
      </span>
    </span>
  );
}

/**
 * ORBI, Orchestra's Robotic Intelligence. Use it for empty states, onboarding and contextual moments,
 * never as a stand-in for real operational information. Decorative by default (the surrounding text
 * carries the meaning); pass `title` when ORBI is the only content. `animated` adds a gentle idle
 * float and blink, which prefers-reduced-motion turns off.
 */
export function Orbi({
  expression = 'default',
  size = 96,
  className,
  animated,
  title,
}: {
  expression?: OrbiExpression;
  size?: number;
  className?: string;
  animated?: boolean;
  title?: string | boolean;
}) {
  const id = useSvgId(`orbi-${expression}`);
  const label = title === true ? ORBI_LABELS[expression] : title || undefined;
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      focusable="false"
      className={cn('shrink-0 overflow-visible', animated && 'orbi-animated', className)}
      {...a11y(label)}
      dangerouslySetInnerHTML={{ __html: (label ? `<title>${label}</title>` : '') + orbiInner(expression, id) }}
    />
  );
}

/** Branded loading indicator: the symbol inside a spinning orbit track. */
export function BrandLoader({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex flex-col items-center gap-4', className)}>
      <span className="relative block size-16">
        <svg viewBox="0 0 64 64" aria-hidden className="absolute inset-0 size-full animate-spin [animation-duration:1.6s]">
          <circle cx="32" cy="32" r="29" fill="none" strokeWidth="2" className="stroke-border" />
          <path d="M32 3 A29 29 0 0 1 61 32" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-[var(--brand-cyan)]" />
        </svg>
        <OrchestraSymbol className="absolute inset-3.5 size-9" />
      </span>
      <span className="text-sm text-muted-foreground">
        {label}…
      </span>
    </div>
  );
}
