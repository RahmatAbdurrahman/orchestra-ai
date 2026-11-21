/**
 * Decorative layers for the Orchestra AI visual identity. Everything here is aria-hidden,
 * pointer-events: none and low contrast: it adds depth and context but never carries information,
 * so screen readers and interaction are unaffected.
 */
import type { ComponentType, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

export type AtmosphereVariant = 'subtle' | 'default' | 'expressive';
export type AtmosphereMotif = 'none' | 'network' | 'flow' | 'geometric';

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** Soft blue radial lighting, theme aware via the --atmo-glow-* tokens. */
export function RadialGlow({ className }: { className?: string }) {
  return <div aria-hidden className={cn('decor-glow pointer-events-none absolute inset-0', className)} />;
}

/** Dot lattice that fades out from the top centre. */
export function DotGrid({ className }: { className?: string }) {
  return <div aria-hidden className={cn('decor-dots decor-fade-radial pointer-events-none absolute inset-0', className)} />;
}

/** Fine square grid, used where a "blueprint" feel helps (login, chart areas). */
export function LineGrid({ className }: { className?: string }) {
  return <div aria-hidden className={cn('decor-grid decor-fade-radial pointer-events-none absolute inset-0', className)} />;
}

const LINE = 'fill-none stroke-[var(--atmo-line)]';
const NODE = 'fill-[var(--atmo-node)]';
const NODE_SOFT = 'fill-[var(--atmo-node-soft)] stroke-[var(--atmo-line)]';

/** Connected nodes: system connectivity (automation, integrations). */
export function NetworkPattern({ className }: { className?: string }) {
  const nodes: Array<[number, number, number]> = [
    [36, 70, 3],
    [132, 34, 4],
    [214, 112, 3.5],
    [322, 54, 5],
    [414, 138, 3.5],
    [482, 62, 3],
    [290, 196, 3],
    [146, 176, 2.5],
  ];
  const links: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 5],
    [3, 4],
    [2, 6],
    [6, 4],
    [7, 2],
    [4, 5],
    [1, 3],
  ];
  return (
    <svg aria-hidden viewBox="0 0 520 240" className={cn('pointer-events-none', className)}>
      {links.map(([a, b], index) => (
        <path
          key={`${a}-${b}`}
          d={`M${nodes[a]![0]} ${nodes[a]![1]} L${nodes[b]![0]} ${nodes[b]![1]}`}
          pathLength={1}
          strokeWidth={1}
          className={cn(LINE, 'decor-draw')}
          style={delay(120 + index * 70)}
        />
      ))}
      <circle cx={322} cy={54} r={14} strokeWidth={1} className={cn(NODE_SOFT, 'animate-fade-in')} style={delay(500)} />
      <circle cx={214} cy={112} r={9} strokeWidth={1} className={cn(NODE_SOFT, 'animate-fade-in')} style={delay(650)} />
      {nodes.map(([x, y, r], index) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className={cn(NODE, 'animate-fade-in')} style={delay(300 + index * 60)} />
      ))}
    </svg>
  );
}

/** Orthogonal connectors with step nodes: workflows, approvals, requests. */
export function FlowPattern({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 520 240" className={cn('pointer-events-none', className)}>
      <path
        d="M16 64 H178 Q192 64 192 78 V136 Q192 150 206 150 H338 Q352 150 352 136 V102 Q352 88 366 88 H504"
        pathLength={1}
        strokeWidth={1.25}
        className={cn(LINE, 'decor-draw')}
        style={delay(100)}
      />
      <path
        d="M192 64 H298 Q312 64 312 50 V38 Q312 24 326 24 H452"
        pathLength={1}
        strokeWidth={1}
        className={cn(LINE, 'decor-draw opacity-70')}
        style={delay(450)}
      />
      {(
        [
          [96, 64],
          [192, 108],
          [272, 150],
          [430, 88],
          [388, 24],
        ] as Array<[number, number]>
      ).map(([x, y], index) => (
        <rect
          key={`${x}-${y}`}
          x={x - 6}
          y={y - 6}
          width={12}
          height={12}
          rx={3.5}
          strokeWidth={1}
          className={cn(NODE_SOFT, 'animate-fade-in')}
          style={delay(350 + index * 110)}
        />
      ))}
      <circle cx={16} cy={64} r={3.5} className={cn(NODE, 'animate-fade-in')} style={delay(200)} />
      <circle cx={504} cy={88} r={4} className={cn(NODE, 'animate-fade-in')} style={delay(900)} />
      <circle cx={452} cy={24} r={3} className={cn(NODE, 'animate-fade-in')} style={delay(1000)} />
    </svg>
  );
}

/** Concentric arcs and a crosshair: restrained geometry for data-heavy pages (dashboard). */
export function GeometricAccent({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 260 260" className={cn('pointer-events-none', className)}>
      <circle cx={170} cy={90} r={44} strokeWidth={1} pathLength={1} className={cn(LINE, 'decor-draw')} style={delay(100)} />
      <circle cx={170} cy={90} r={78} strokeWidth={1} pathLength={1} className={cn(LINE, 'decor-draw opacity-70')} style={delay(250)} />
      <circle cx={170} cy={90} r={112} strokeWidth={1} strokeDasharray="2 7" className={cn(LINE, 'animate-fade-in opacity-60')} style={delay(400)} />
      <path d="M170 20 V160 M100 90 H240" strokeWidth={1} pathLength={1} className={cn(LINE, 'decor-draw opacity-50')} style={delay(500)} />
      <circle cx={225} cy={35} r={4} className={cn(NODE, 'animate-fade-in')} style={delay(700)} />
      <circle cx={92} cy={90} r={3} className={cn(NODE, 'animate-fade-in')} style={delay(800)} />
      <circle cx={170} cy={168} r={2.5} className={cn(NODE, 'animate-fade-in')} style={delay(900)} />
    </svg>
  );
}

const MOTIFS: Record<Exclude<AtmosphereMotif, 'none'>, ComponentType<{ className?: string }>> = {
  network: NetworkPattern,
  flow: FlowPattern,
  geometric: GeometricAccent,
};

/**
 * Page-level atmosphere: radial lighting, a fading dot lattice and an optional motif behind the page
 * header. Intensity follows the variant; the motif only shows on desktop widths.
 */
export function Atmosphere({
  variant = 'default',
  motif = 'none',
  className,
}: {
  variant?: AtmosphereVariant;
  motif?: AtmosphereMotif;
  className?: string;
}) {
  const Motif = motif === 'none' ? null : MOTIFS[motif];
  return (
    <div
      aria-hidden
      className={cn(
        'decor-layer pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden select-none',
        variant === 'subtle' ? 'h-72' : 'h-[30rem]',
        className,
      )}
    >
      <RadialGlow className={variant === 'subtle' ? 'opacity-60' : variant === 'expressive' ? 'opacity-100 [transform:scale(1.15)]' : 'opacity-90'} />
      <DotGrid className={cn('hidden sm:block', variant === 'subtle' ? 'opacity-45' : 'opacity-90')} />
      {Motif ? (
        <div
          className={cn(
            'absolute hidden [mask-image:radial-gradient(ellipse_at_70%_30%,#000_35%,transparent_75%)] lg:block',
            // The geometric accent sits further out so it never competes with header actions.
            motif === 'geometric' ? 'top-2 -right-28' : 'top-16 -right-6',
            variant === 'subtle' ? 'opacity-40' : 'opacity-70',
          )}
        >
          <Motif className={motif === 'geometric' ? 'h-64 w-64' : 'h-56 w-[30rem]'} />
        </div>
      ) : null}
    </div>
  );
}
