import { renderOgCard } from '@/lib/og-card';

// Rendered once at build time. The page metadata links here with ?v=<content version>
// (lib/og-card-element.tsx), so a changed card gets a new URL and link-preview caches refresh.
export const dynamic = 'force-static';

export function GET() {
  return renderOgCard();
}
