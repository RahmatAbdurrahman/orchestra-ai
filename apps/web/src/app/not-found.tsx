import { Compass } from 'lucide-react';
import Link from 'next/link';
import { DotGrid, RadialGlow } from '@/components/atmosphere';

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
      <RadialGlow className="-z-10" />
      <DotGrid className="-z-10" />
      <span aria-hidden className="mb-2 flex size-14 items-center justify-center rounded-2xl border bg-card text-primary shadow-sm dark:text-info-foreground">
        <Compass className="size-6" />
      </span>
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The page you were looking for does not exist or has moved.</p>
      <Link href="/dashboard" className="mt-2 text-sm font-medium text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
