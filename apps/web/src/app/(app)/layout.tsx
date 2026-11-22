'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { BrandLoader } from '@/components/brand';
import { AuthProvider } from '@/lib/auth';

export default function AuthenticatedLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <BrandLoader label="Loading Orchestra AI" />
        </div>
      }
    >
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
