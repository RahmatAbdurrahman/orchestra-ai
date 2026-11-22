/**
 * Orchestra AI brand artwork: the orbital "O" symbol and the ORBI mascot, as plain SVG markup.
 *
 * This module is the single source of truth for brand graphics. It has no imports and no JSX so it
 * can be used by React components (components/brand.tsx), by metadata routes (app/apple-icon.tsx)
 * and by the asset export script (scripts/export-brand-assets.mjs, run with Node type stripping).
 * Every function takes an id prefix so several copies on one page never share gradient/mask ids.
 */

export const BRAND = Object.freeze({
  name: 'Orchestra AI',
  shortName: 'Orchestra',
  /** Internal design concept behind the identity (not shown as a tagline). */
  concept: 'The Intelligent Conductor',
  /** Public tagline and slogan, identical to the product showcase end card. */
  tagline: 'Intelligent Workflow Orchestration Platform',
  taglineShort: 'Workflow orchestration',
  slogan: 'Orchestrate Intelligence. Empower Decisions.',
  description:
    'Intelligent workflow orchestration platform for procurement: purchase requests, document intelligence, approvals and UiPath automation.',
  mascot: { name: 'ORBI', meaning: "Orchestra's Robotic Intelligence" },
  colors: {
    blue: '#2563EB',
    sky: '#0EA5E9',
    cyan: '#06B6D4',
    cyanLight: '#22D3EE',
    navy: '#0B1120',
    navyDeep: '#172554',
    ink: '#172033',
    white: '#F8FAFC',
  },
  fonts: { wordmark: 'Sora 700', headings: 'Sora 600', interface: 'Inter' },
});

const C = BRAND.colors;

// ---------------------------------------------------------------- Symbol

export interface SymbolOptions {
  /** Single colour (currentColor) instead of the blue-to-cyan gradient. */
  mono?: boolean;
  /** Orbit stroke width in symbol units (48 x 48); thicker for small favicons. */
  orbitWidth?: number;
}

const ORBIT = 'translate(24 24) rotate(-28)';
const ORBIT_FRONT = 'M-21 0 A21 7.5 0 0 0 21 0';
const ORBIT_BACK = 'M-21 0 A21 7.5 0 0 1 21 0';

function sparkle(x: number, y: number, r: number): string {
  const w = r * 0.26;
  return `M${x} ${y - r} C${x + w * 0.6} ${y - w} ${x + w} ${y - w * 0.6} ${x + r} ${y} C${x + w} ${y + w * 0.6} ${x + w * 0.6} ${y + w} ${x} ${y + r} C${x - w * 0.6} ${y + w} ${x - w} ${y + w * 0.6} ${x - r} ${y} C${x - w} ${y - w * 0.6} ${x - w * 0.6} ${y - w} ${x} ${y - r} Z`;
}

/**
 * Inner markup of the orbital O for viewBox="0 0 48 48": a geometric ring, an orbit that passes
 * behind the ring at the top and in front of it at the bottom (the ring is masked where the front
 * orbit crosses), a node on the left end of the orbit and the intelligence star top right.
 */
export function symbolInner(id: string, options: SymbolOptions = {}): string {
  const orbitWidth = options.orbitWidth ?? 2;
  const ring = options.mono ? 'currentColor' : `url(#${id}-ring)`;
  const orbit = options.mono ? 'currentColor' : `url(#${id}-orbit)`;
  const star = options.mono ? 'currentColor' : C.cyan;
  const node = options.mono ? 'currentColor' : C.blue;
  const defs = options.mono
    ? ''
    : `<linearGradient id="${id}-ring" x1="9" y1="7" x2="39" y2="41" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.blue}"/><stop offset="0.55" stop-color="${C.sky}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient><linearGradient id="${id}-orbit" x1="4" y1="34" x2="44" y2="14" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.cyanLight}"/><stop offset="1" stop-color="${C.blue}"/></linearGradient>`;
  return [
    `<defs>${defs}<mask id="${id}-weave" maskUnits="userSpaceOnUse" x="0" y="0" width="48" height="48"><rect width="48" height="48" fill="#fff"/><g transform="${ORBIT}"><path d="${ORBIT_FRONT}" fill="none" stroke="#000" stroke-width="${orbitWidth + 3.4}" stroke-linecap="round"/></g></mask></defs>`,
    `<g transform="${ORBIT}"><path d="${ORBIT_BACK}" fill="none" stroke="${orbit}" stroke-width="${orbitWidth}" stroke-linecap="round" opacity="0.42"/></g>`,
    `<circle cx="24" cy="24" r="13" fill="none" stroke="${ring}" stroke-width="5.6" mask="url(#${id}-weave)"/>`,
    `<g transform="${ORBIT}"><path d="${ORBIT_FRONT}" fill="none" stroke="${orbit}" stroke-width="${orbitWidth}" stroke-linecap="round"/></g>`,
    `<circle cx="5.6" cy="33.8" r="${(orbitWidth * 0.9).toFixed(2)}" fill="${node}"/>`,
    `<path d="${sparkle(41.6, 8.6, 3.6)}" fill="${star}"/>`,
    options.mono ? '' : `<path d="${sparkle(41.6, 8.6, 1.5)}" fill="#fff" opacity="0.9"/>`,
  ].join('');
}

export function symbolSvg(options: SymbolOptions & { id?: string; title?: string } = {}): string {
  const id = options.id ?? 'orchestra-symbol';
  const title = options.title ?? `${BRAND.name} symbol`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="${title}"><title>${title}</title>${symbolInner(id, options)}</svg>\n`;
}

/** App icon / favicon: the symbol on a deep navy tile (legible in light and dark browser chrome). */
export function appIconInner(id: string): string {
  return [
    `<defs><linearGradient id="${id}-tile" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.navyDeep}"/><stop offset="1" stop-color="${C.navy}"/></linearGradient><radialGradient id="${id}-glow" cx="0.3" cy="0.2" r="0.8"><stop offset="0" stop-color="${C.blue}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.blue}" stop-opacity="0"/></radialGradient></defs>`,
    `<rect width="64" height="64" rx="15" fill="url(#${id}-tile)"/>`,
    `<rect width="64" height="64" rx="15" fill="url(#${id}-glow)"/>`,
    `<g transform="translate(7.5 7.5) scale(1.0625)">${symbolInner(`${id}-s`, { orbitWidth: 2.7 })}</g>`,
  ].join('');
}

export function appIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">${appIconInner('orchestra-icon')}</svg>\n`;
}

/**
 * Logo lockup (symbol + wordmark) as a standalone file. The wordmark is live text in Sora 700 with
 * fallbacks; in the application the wordmark is rendered as HTML text with the loaded Sora font.
 */
export function logoSvg(variant: 'light' | 'dark' | 'mono'): string {
  const id = `orchestra-logo-${variant}`;
  const ink = variant === 'light' ? C.ink : variant === 'dark' ? '#FFFFFF' : 'currentColor';
  const ai = variant === 'mono' ? 'currentColor' : `url(#${id}-ai)`;
  const aiGradient =
    variant === 'mono'
      ? ''
      : `<defs><linearGradient id="${id}-ai" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient></defs>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 232 48" width="232" height="48" role="img" aria-label="${BRAND.name}">`,
    `<title>${BRAND.name}</title>${aiGradient}`,
    `<g>${symbolInner(`${id}-s`, { mono: variant === 'mono' })}</g>`,
    `<text x="60" y="33" font-family="Sora, Inter, 'Segoe UI', Arial, sans-serif" font-size="25" font-weight="700" letter-spacing="-0.6" fill="${ink}">Orchestra<tspan fill="${ai}" dx="7">AI</tspan></text>`,
    `</svg>\n`,
  ].join('');
}

// ---------------------------------------------------------------- ORBI

export const ORBI_EXPRESSIONS = ['default', 'greeting', 'thinking', 'document', 'approval', 'success', 'error'] as const;
export type OrbiExpression = (typeof ORBI_EXPRESSIONS)[number];

export const ORBI_LABELS: Record<OrbiExpression, string> = {
  default: 'ORBI, the Orchestra AI assistant',
  greeting: 'ORBI waving hello',
  thinking: 'ORBI thinking',
  document: 'ORBI reading a document',
  approval: 'ORBI holding an approval check',
  success: 'ORBI celebrating',
  error: 'ORBI showing a warning',
};

const OUTLINE = '#CBD5E1';
const EYE = C.cyanLight;

function arm(id: string, d: string): string {
  return `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="10.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="url(#${id}-shell)" stroke-width="8.6" stroke-linecap="round"/>`;
}

function hand(id: string, x: number, y: number, r = 4.6): string {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}-accent)"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.35}" r="${r * 0.35}" fill="#fff" opacity="0.55"/>`;
}

function eyes(expression: OrbiExpression, id: string): string {
  const fill = `url(#${id}-eye)`;
  switch (expression) {
    case 'greeting':
    case 'approval':
      return `<path d="M44.5 46.5 q5.5 -7 11 0" fill="none" stroke="${EYE}" stroke-width="3.2" stroke-linecap="round"/><path d="M64.5 46.5 q5.5 -7 11 0" fill="none" stroke="${EYE}" stroke-width="3.2" stroke-linecap="round"/>`;
    case 'thinking':
      return `<rect x="50" y="37.5" width="7" height="8.5" rx="3.5" fill="${fill}"/><rect x="69.5" y="38.5" width="7" height="6.5" rx="3.2" fill="${fill}"/>`;
    case 'document':
      return `<rect x="44.5" y="41.5" width="11" height="5" rx="2.5" fill="${fill}"/><rect x="64.5" y="41.5" width="11" height="5" rx="2.5" fill="${fill}"/>`;
    case 'success':
      return `<path d="${sparkle(50, 44, 5.6)}" fill="${fill}"/><path d="${sparkle(70, 44, 5.6)}" fill="${fill}"/>`;
    case 'error':
      return `<path d="M44.5 37.8 l9 2.2" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/><path d="M75.5 37.8 l-9 2.2" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/><rect x="46" y="42" width="8" height="7" rx="3.5" fill="${fill}"/><rect x="66" y="42" width="8" height="7" rx="3.5" fill="${fill}"/>`;
    default:
      return `<rect x="46" y="39" width="8" height="10" rx="4" fill="${fill}"/><rect x="66" y="39" width="8" height="10" rx="4" fill="${fill}"/>`;
  }
}

function mouth(expression: OrbiExpression, id: string): string {
  switch (expression) {
    case 'greeting':
      return `<path d="M53.5 51.5 q6.5 6.5 13 0" fill="none" stroke="${EYE}" stroke-width="2.4" stroke-linecap="round"/>`;
    case 'success':
      return `<path d="M53.5 50.5 q6.5 7.5 13 0 z" fill="url(#${id}-eye)"/>`;
    case 'thinking':
      return `<path d="M56 53.5 q4 -1.6 8 0" fill="none" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'document':
      return `<path d="M57 53.5 h6" fill="none" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'error':
      return `<path d="M55 55 q5 -4.5 10 0" fill="none" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/>`;
    default:
      return `<path d="M55 52 q5 4.2 10 0" fill="none" stroke="${EYE}" stroke-width="2.2" stroke-linecap="round"/>`;
  }
}

function antennaColor(expression: OrbiExpression): string {
  if (expression === 'success' || expression === 'approval') return '#4ADE80';
  if (expression === 'error') return '#F59E0B';
  return EYE;
}

/** Arms, hands and the props each expression holds. */
function limbs(expression: OrbiExpression, id: string): { back: string; front: string } {
  const left = arm(id, 'M37 78 Q30 86 31 95') + hand(id, 31, 96.5);
  const right = arm(id, 'M83 78 Q90 86 89 95') + hand(id, 89, 96.5);
  switch (expression) {
    case 'greeting':
      return {
        back: '',
        front:
          left +
          arm(id, 'M83 77 Q95 70 99 58') +
          hand(id, 99.5, 55.5, 4.8) +
          `<path d="M105.5 48 q3.2 3.4 2.2 7.6" fill="none" stroke="${EYE}" stroke-width="1.6" stroke-linecap="round" opacity="0.85"/><path d="M109.5 43.5 q4.4 4.6 3.2 11" fill="none" stroke="${EYE}" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>`,
      };
    case 'thinking':
      return {
        back: '',
        front:
          left +
          arm(id, 'M83 78 Q93 73 85.5 64.5') +
          hand(id, 84.5, 63.5, 4.4) +
          `<circle cx="96" cy="21" r="1.6" fill="#fff" stroke="${OUTLINE}" stroke-width="0.8"/><circle cx="100" cy="15.5" r="2.4" fill="#fff" stroke="${OUTLINE}" stroke-width="0.8"/>` +
          `<rect x="95" y="1.5" width="23" height="11.5" rx="5.75" fill="#fff" stroke="${OUTLINE}" stroke-width="0.9"/><circle cx="101" cy="7.25" r="1.4" fill="${C.sky}"/><circle cx="106.5" cy="7.25" r="1.4" fill="${C.sky}"/><circle cx="112" cy="7.25" r="1.4" fill="${C.sky}"/>`,
      };
    case 'document':
      return {
        back: '',
        front:
          `<g transform="rotate(-4 60 93)"><rect x="43" y="79" width="34" height="27" rx="3.5" fill="#fff" stroke="${OUTLINE}" stroke-width="1"/><rect x="47.5" y="83.5" width="14" height="3.2" rx="1.6" fill="${C.blue}"/><path d="M47.5 90.5 h25 M47.5 95 h20 M47.5 99.5 h23" stroke="${OUTLINE}" stroke-width="1.7" stroke-linecap="round"/><rect x="43" y="92.4" width="34" height="1.8" fill="${C.cyanLight}" opacity="0.85"/><rect x="43" y="91.4" width="34" height="3.8" fill="${C.cyanLight}" opacity="0.18"/></g>` +
          arm(id, 'M37 79 Q37.5 90 45.5 93.5') +
          hand(id, 46, 93.5, 4.3) +
          arm(id, 'M83 79 Q82.5 90 74.5 93.5') +
          hand(id, 74, 93.5, 4.3),
      };
    case 'approval':
      return {
        back: '',
        front:
          left +
          arm(id, 'M83 78 Q93 71 96 62') +
          `<circle cx="98" cy="52.5" r="10.5" fill="#22C55E" opacity="0.18"/><circle cx="98" cy="52.5" r="8.4" fill="#16A34A"/><path d="M93.8 52.8 l3 3.1 l5.6 -6.4" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` +
          hand(id, 96.5, 62, 4.4),
      };
    case 'success':
      return {
        back: '',
        front:
          arm(id, 'M37 77 Q26 70 22 59') +
          hand(id, 21.5, 56.5, 4.8) +
          arm(id, 'M83 77 Q94 70 98 59') +
          hand(id, 98.5, 56.5, 4.8) +
          `<path d="${sparkle(14, 42, 3.6)}" fill="${C.cyanLight}"/><path d="${sparkle(106, 38, 4.2)}" fill="${C.sky}"/><path d="${sparkle(16, 26, 2.4)}" fill="${C.blue}" opacity="0.7"/><path d="${sparkle(103, 24, 2.2)}" fill="${C.cyanLight}" opacity="0.8"/>`,
      };
    case 'error':
      return {
        back: '',
        front:
          arm(id, 'M37 79 Q31 88 33.5 97.5') +
          hand(id, 34, 98.5) +
          arm(id, 'M83 79 Q89 88 86.5 97.5') +
          hand(id, 86, 98.5) +
          `<path d="M100 12.5 L108.6 27.5 H91.4 Z" fill="#F59E0B" stroke="#F59E0B" stroke-width="2.4" stroke-linejoin="round"/><path d="M100 17.8 v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="100" cy="25.4" r="1.2" fill="#fff"/>`,
      };
    default:
      return { back: '', front: left + right };
  }
}

/**
 * Inner markup of ORBI for viewBox="0 0 120 120". Groups carry classes (orbi-body, orbi-eyes,
 * orbi-glow) so the application can add restrained idle animation with CSS; static files ignore them.
 */
export function orbiInner(expression: OrbiExpression, id: string): string {
  const parts = limbs(expression, id);
  const antenna = antennaColor(expression);
  return [
    `<defs>`,
    `<linearGradient id="${id}-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.62" stop-color="#F1F5F9"/><stop offset="1" stop-color="#D9E2EC"/></linearGradient>`,
    `<radialGradient id="${id}-shine" cx="0.32" cy="0.22" r="0.65"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${id}-visor" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#13204A"/><stop offset="1" stop-color="${C.navy}"/></linearGradient>`,
    `<linearGradient id="${id}-gloss" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.28"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>`,
    `<linearGradient id="${id}-accent" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.blue}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>`,
    `<radialGradient id="${id}-eye" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="#CFFAFE"/><stop offset="0.45" stop-color="${C.cyanLight}"/><stop offset="1" stop-color="${C.cyan}"/></radialGradient>`,
    `</defs>`,
    `<ellipse cx="60" cy="113.5" rx="25" ry="3.8" fill="#0F172A" opacity="0.14"/>`,
    `<g class="orbi-body">`,
    parts.back,
    // antenna
    `<path d="M60 21 V13.5" stroke="${OUTLINE}" stroke-width="2.6" stroke-linecap="round"/>`,
    `<circle class="orbi-glow" cx="60" cy="11" r="6.2" fill="${antenna}" opacity="0.35"/>`,
    `<circle cx="60" cy="11" r="3.6" fill="${antenna}"/><circle cx="58.9" cy="9.9" r="1.1" fill="#fff" opacity="0.85"/>`,
    // head
    `<circle cx="27" cy="44" r="6.3" fill="url(#${id}-accent)"/><circle cx="27" cy="44" r="2.8" fill="#E0F2FE" opacity="0.9"/>`,
    `<circle cx="93" cy="44" r="6.3" fill="url(#${id}-accent)"/><circle cx="93" cy="44" r="2.8" fill="#E0F2FE" opacity="0.9"/>`,
    `<rect x="27" y="19" width="66" height="48" rx="22" fill="url(#${id}-shell)" stroke="${OUTLINE}" stroke-width="1"/>`,
    `<rect x="27" y="19" width="66" height="48" rx="22" fill="url(#${id}-shine)"/>`,
    // face
    `<rect x="35" y="28" width="50" height="31" rx="14" fill="url(#${id}-visor)"/>`,
    `<rect x="38.5" y="30" width="43" height="9" rx="4.5" fill="url(#${id}-gloss)"/>`,
    `<g class="orbi-eyes">${eyes(expression, id)}</g>`,
    mouth(expression, id),
    // neck and torso
    `<rect x="53" y="65.5" width="14" height="5.5" rx="2.2" fill="${OUTLINE}"/>`,
    `<rect x="36" y="69" width="48" height="36" rx="16" fill="url(#${id}-shell)" stroke="${OUTLINE}" stroke-width="1"/>`,
    `<ellipse cx="48" cy="76.5" rx="8.5" ry="3.4" fill="#fff" opacity="0.85"/>`,
    // chest emblem: the orbital O
    `<g transform="translate(60 87) rotate(-28)"><path d="M-10.5 0 A10.5 3.8 0 0 1 10.5 0" fill="none" stroke="${C.cyanLight}" stroke-width="1.2" opacity="0.5"/></g>`,
    `<circle cx="60" cy="87" r="6.2" fill="none" stroke="url(#${id}-accent)" stroke-width="2.7"/>`,
    `<g transform="translate(60 87) rotate(-28)"><path d="M-10.5 0 A10.5 3.8 0 0 0 10.5 0" fill="none" stroke="${C.cyanLight}" stroke-width="1.2"/></g>`,
    `<path d="${sparkle(68.6, 80.6, 1.9)}" fill="${C.cyan}"/>`,
    parts.front,
    `</g>`,
  ].join('');
}

export function orbiSvg(expression: OrbiExpression): string {
  const label = ORBI_LABELS[expression];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240" role="img" aria-label="${label}"><title>${label}</title>${orbiInner(expression, `orbi-${expression}`)}</svg>\n`;
}
