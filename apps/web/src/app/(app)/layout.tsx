'use client';

import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { AuthProvider } from '@/lib/auth';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider
      fallback={
        <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      }
    >
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
