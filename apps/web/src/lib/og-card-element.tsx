import type { ReactElement, ReactNode } from 'react';
import { BRAND, orbiSvg, symbolSvg } from '@/lib/brand-art';

/**
 * The social preview card (Open Graph and Twitter) as a plain element tree, plus a content version.
 *
 * This module has no Node or next/og imports, so the root layout can use it to compute the version
 * that goes into the og:image URL. The image itself is rendered by lib/og-card.tsx in the
 * /og-image route. Any change to what the card shows (text, styles, brand art, fonts) changes the
 * version, so the URL changes and link-preview caches fetch the new image.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_ALT = `${BRAND.name}, ${BRAND.tagline}. ${BRAND.slogan}`;
export const OG_PATH = '/og-image';

/** Satori reads TTF/OTF/WOFF (not WOFF2), so the brand fonts come from @fontsource. */
export const OG_FONTS = [
  { name: 'Sora', pkg: 'sora', file: 'sora-latin-700-normal.woff', weight: 700 },
  { name: 'Sora', pkg: 'sora', file: 'sora-latin-600-normal.woff', weight: 600 },
  { name: 'Inter', pkg: 'inter', file: 'inter-latin-400-normal.woff', weight: 400 },
  { name: 'Inter', pkg: 'inter', file: 'inter-latin-500-normal.woff', weight: 500 },
] as const;

const CAPABILITIES = ['Purchase requests', 'Document AI', 'Approvals', 'UiPath robots'];

const svgSrc = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

export function ogCardElement(): ReactElement {
  const { colors } = BRAND;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        backgroundColor: colors.navy,
        backgroundImage: `radial-gradient(circle at 82% 38%, rgba(6,182,212,0.28), transparent 42%), radial-gradient(circle at 8% 100%, rgba(37,99,235,0.35), transparent 50%)`,
        fontFamily: 'Inter',
        color: colors.white,
      }}
    >
      {/* Orbit motif behind ORBI */}
      <div
        style={{
          position: 'absolute',
          right: 18,
          top: 70,
          width: 520,
          height: 520,
          borderRadius: 9999,
          border: '1.5px solid rgba(34,211,238,0.18)',
          display: 'flex',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 78,
          top: 130,
          width: 400,
          height: 400,
          borderRadius: 9999,
          border: '1.5px dashed rgba(96,165,250,0.18)',
          display: 'flex',
        }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '64px 0 60px 72px', width: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <img src={svgSrc(symbolSvg({ id: 'og-symbol' }))} width={68} height={68} alt="" />
          <div style={{ display: 'flex', fontFamily: 'Sora', fontWeight: 700, fontSize: 44, letterSpacing: '-0.02em' }}>
            <span>Orchestra</span>
            <span
              style={{
                marginLeft: 12,
                backgroundImage: `linear-gradient(90deg, ${colors.blue}, ${colors.cyanLight})`,
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              AI
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 20, fontWeight: 500, color: colors.cyanLight, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            {BRAND.tagline}
          </div>
          {/* The slogan, one sentence per line; the second one carries the brand gradient. */}
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 16, fontFamily: 'Sora', fontWeight: 600, fontSize: 56, lineHeight: 1.1, letterSpacing: '-0.025em' }}>
            {BRAND.slogan.split('. ').map((sentence, index, all) => (
              <span
                key={sentence}
                style={
                  index === all.length - 1
                    ? { backgroundImage: `linear-gradient(90deg, ${colors.sky}, ${colors.cyanLight})`, backgroundClip: 'text', color: 'transparent' }
                    : {}
                }
              >
                {index < all.length - 1 ? `${sentence}.` : sentence}
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', marginTop: 20, fontSize: 25, lineHeight: 1.45, color: '#b6c2d6' }}>
            From purchase request to purchase order: documents read, approvals routed, UiPath robots in motion.
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {CAPABILITIES.map((label) => (
            <div
              key={label}
              style={{
                display: 'flex',
                padding: '8px 16px',
                borderRadius: 9999,
                fontSize: 18,
                fontWeight: 500,
                color: '#dbe7f7',
                backgroundColor: 'rgba(148,163,184,0.10)',
                border: '1px solid rgba(148,163,184,0.24)',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: 'absolute', right: 58, top: 108, display: 'flex' }}>
        <img src={svgSrc(orbiSvg('greeting'))} width={440} height={440} alt="" />
      </div>
    </div>
  );
}

/** Serializes only what is drawn: element types, props and text, never React internals. */
function serialize(node: ReactNode): unknown {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(serialize);
  if (typeof node === 'object' && 'type' in node && 'props' in node) {
    const { children, ...props } = (node.props ?? {}) as { children?: ReactNode } & Record<string, unknown>;
    return [typeof node.type === 'string' ? node.type : String(node.type), props, serialize(children)];
  }
  return String(node);
}

/** FNV-1a, 32 bit: tiny, dependency-free and deterministic. Not for security. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Changes whenever the card's content, size or fonts change. */
export const OG_VERSION = fnv1a(JSON.stringify([OG_SIZE, OG_FONTS, serialize(ogCardElement())]));

/** Relative image URL with the content version; metadataBase makes it absolute. */
export const OG_IMAGE = {
  url: `${OG_PATH}?v=${OG_VERSION}`,
  width: OG_SIZE.width,
  height: OG_SIZE.height,
  alt: OG_ALT,
  type: 'image/png',
};
