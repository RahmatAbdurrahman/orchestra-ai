import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND, orbiSvg, symbolSvg } from '@/lib/brand-art';

/** Shared social preview card (Open Graph and Twitter), rendered once at build time. */
export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT = `${BRAND.name}: ${BRAND.concept}. ${BRAND.description}`;

const svgSrc = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

// Satori reads TTF/OTF/WOFF (not WOFF2), so the brand fonts come from @fontsource.
const font = (pkg: string, file: string) => readFile(join(process.cwd(), 'node_modules/@fontsource', pkg, 'files', file));

const CAPABILITIES = ['Purchase requests', 'Document AI', 'Approvals', 'UiPath robots'];

export async function renderOgCard() {
  const [sora700, sora600, inter400, inter500] = await Promise.all([
    font('sora', 'sora-latin-700-normal.woff'),
    font('sora', 'sora-latin-600-normal.woff'),
    font('inter', 'inter-latin-400-normal.woff'),
    font('inter', 'inter-latin-500-normal.woff'),
  ]);
  const { colors } = BRAND;

  return new ImageResponse(
    (
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
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 500, color: colors.cyanLight, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {BRAND.concept}
            </div>
            <div style={{ display: 'flex', marginTop: 16, fontFamily: 'Sora', fontWeight: 600, fontSize: 58, lineHeight: 1.08, letterSpacing: '-0.025em' }}>
              Intelligent enterprise automation
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
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: 'Sora', data: sora700, weight: 700, style: 'normal' },
        { name: 'Sora', data: sora600, weight: 600, style: 'normal' },
        { name: 'Inter', data: inter400, weight: 400, style: 'normal' },
        { name: 'Inter', data: inter500, weight: 500, style: 'normal' },
      ],
    },
  );
}
