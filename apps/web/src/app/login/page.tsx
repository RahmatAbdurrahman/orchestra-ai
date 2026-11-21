'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ROLE_LABELS, type RoleName } from '@orchestra/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Workflow } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, Input, Label } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/auth';
import type { Me } from '@/lib/types';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
});
type FormValues = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
  ['requester@orchestra.local', 'Requester'],
  ['approver.ops@orchestra.local', 'Approver (Operations)'],
  ['approver.finance@orchestra.local', 'Approver (Finance)'],
  ['operator@orchestra.local', 'Automation operator'],
  ['admin@orchestra.local', 'Administrator'],
  ['viewer@orchestra.local', 'Management viewer'],
] as const;

type DemoAccount = { email: string; name: string; department: { code: string; name: string } | null; roles: RoleName[] };

/** Order in which the roles take part in the purchase flow, so the buttons read top to bottom. */
const ROLE_ORDER: RoleName[] = ['REQUESTER', 'APPROVER', 'OPERATOR', 'ADMIN', 'VIEWER'];
const roleRank = (account: DemoAccount) => Math.min(...account.roles.map((role) => ROLE_ORDER.indexOf(role)).filter((rank) => rank >= 0), 99);

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [demoPending, setDemoPending] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });
  // Only answered when the API runs with DEMO_LOGIN_ENABLED=true; a 404 hides the one-click list.
  const demo = useQuery({
    queryKey: ['auth', 'demo-accounts'],
    queryFn: () => api<DemoAccount[]>('/auth/demo-accounts'),
    retry: false,
    staleTime: Infinity,
  });
  const demoAccounts = [...(demo.data ?? [])].sort((a, b) => roleRank(a) - roleRank(b) || a.email.localeCompare(b.email));

  const signedIn = (me: Me) => {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    const next = params.get('next');
    router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard');
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      signedIn(await api<Me>('/auth/login', { body: values }));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  });

  const signInAs = async (email: string) => {
    setError(null);
    setDemoPending(email);
    try {
      signedIn(await api<Me>('/auth/demo-login', { body: { email } }));
    } catch (cause) {
      setError(errorMessage(cause));
      setDemoPending(null);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2 text-sidebar-accent-foreground">
          <div className="flex size-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
            <Workflow className="size-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight">Orchestra AI</span>
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-3xl font-semibold leading-tight text-sidebar-accent-foreground">
            From purchase request to purchase order, with a human in control of every decision.
          </h1>
          <p className="text-sidebar-muted">
            Document intelligence reads the invoice, business rules check it, approvers decide, and a UiPath robot enters the
            purchase order in the ERP. Every step is audited.
          </p>
          <ol className="grid grid-cols-2 gap-2 text-sm">
            {['Upload & extract', 'Verify & validate', 'Tiered approval', 'UiPath execution'].map((step, index) => (
              <li key={step} className="animate-fade-up rounded-lg border border-sidebar-border bg-sidebar-accent/50 px-3 py-2.5" style={{ animationDelay: `${index * 60}ms` }}>
                <span className="mr-2 font-mono text-xs text-sidebar-muted">0{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <p className="text-xs text-sidebar-muted">Simulation environment · synthetic data only</p>
      </aside>

      <main className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm animate-page-in space-y-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 lg:hidden">
              <Workflow className="size-5 text-primary" />
              <span className="font-semibold">Orchestra AI</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-sm text-muted-foreground">Use your Orchestra account.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" {...form.register('email')} aria-invalid={!!form.formState.errors.email} />
              {form.formState.errors.email ? <p className="text-xs text-destructive">{form.formState.errors.email.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} aria-invalid={!!form.formState.errors.password} />
            </div>
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : null}
              Sign in
            </Button>
          </form>
          {demoAccounts.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Simulation: sign in as</p>
                  <p className="text-xs text-muted-foreground">One click, no password. Seeded accounts with synthetic data.</p>
                </div>
                <ul className="divide-y overflow-hidden rounded-lg border">
                  {demoAccounts.map((account) => (
                    <li key={account.email}>
                      <button
                        type="button"
                        onClick={() => signInAs(account.email)}
                        disabled={demoPending !== null}
                        className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{account.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
                        </span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          {account.roles.map((role) => (
                            <Badge key={role}>{ROLE_LABELS[role]}</Badge>
                          ))}
                          {account.department ? <Badge tone="outline">{account.department.code}</Badge> : null}
                        </span>
                        {demoPending === account.email ? (
                          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-2 pt-4">
                <p className="text-xs font-medium text-muted-foreground">Demo accounts (password: see the README / seed)</p>
                <div className="flex flex-wrap gap-1.5">
                  {DEMO_ACCOUNTS.map(([email, label]) => (
                    <button
                      key={email}
                      type="button"
                      onClick={() => form.setValue('email', email, { shouldValidate: true })}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                      title={email}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
