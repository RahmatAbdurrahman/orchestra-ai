import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="font-mono text-sm text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
