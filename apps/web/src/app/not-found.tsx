import Link from 'next/link';
import { DotGrid, RadialGlow } from '@/components/atmosphere';
import { Orbi, OrchestraLogo } from '@/components/brand';

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
      <RadialGlow className="-z-10" />
      <DotGrid className="-z-10" />
      <OrchestraLogo className="absolute top-6 left-6" symbolClassName="size-8" wordmarkClassName="text-base" />
      <Orbi expression="thinking" size={132} animated />
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="font-display text-2xl font-semibold tracking-[-0.015em]">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">ORBI looked everywhere: this page does not exist or has moved.</p>
      <Link href="/dashboard" className="mt-2 text-sm font-medium text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
