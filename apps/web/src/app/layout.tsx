import type { Metadata, Viewport } from 'next';
import { Inter, Sora } from 'next/font/google';
import type { ReactNode } from 'react';
import { BRAND } from '@/lib/brand-art';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
// Only the two weights the identity uses: 700 for the wordmark, 600 for major headings.
const sora = Sora({ subsets: ['latin'], weight: ['600', '700'], display: 'swap', variable: '--font-sora' });

// Icons come from the file conventions next to this layout (icon.svg, apple-icon.tsx) and manifest.ts.
export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
  applicationName: BRAND.name,
  appleWebApp: { title: BRAND.name, statusBarStyle: 'black-translucent' },
  openGraph: { type: 'website', siteName: BRAND.name, title: `${BRAND.name} · ${BRAND.concept}`, description: BRAND.description },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
};

const themeScript = `(() => { try { const t = localStorage.getItem('orchestra-theme'); const d = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark', d); } catch {} })();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${sora.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
