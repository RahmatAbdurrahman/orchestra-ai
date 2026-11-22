import { ImageResponse } from 'next/og';
import { appIconSvg } from '@/lib/brand-art';

// Generated once at build time from the same artwork as icon.svg (iOS needs a PNG).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const src = `data:image/svg+xml;base64,${Buffer.from(appIconSvg()).toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#0B1120' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> */}
        <img src={src} width={180} height={180} alt="" />
      </div>
    ),
    { ...size },
  );
}
