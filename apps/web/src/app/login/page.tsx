'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type RoleName } from '@orchestra/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CheckSquare, ChevronDown, ChevronRight, FileScan, Loader2, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type CSSProperties } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DotGrid, NetworkPattern, RadialGlow } from '@/components/atmosphere';
import { Orbi, OrchestraLogo } from '@/components/brand';
import { Collapse } from '@/components/motion';
import { RoleBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, FieldMessage, Input, Label, Skeleton } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY } from '@/lib/auth';
import { BRAND } from '@/lib/brand-art';
import type { Me } from '@/lib/types';
import { cn } from '@/lib/utils';

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

/** The four stages of the product, shown as an illustration of how work flows (no data). */
const FLOW_STEPS: Array<{ title: string; detail: string; icon: LucideIcon; left: number; top: number }> = [
  { title: 'Document intelligence', detail: 'Reads the supplier invoice', icon: FileScan, left: 0, top: 0 },
  { title: 'Business rules', detail: 'Limits, budget, duplicates', icon: ShieldCheck, left: 246, top: 46 },
  { title: 'Tiered approval', detail: 'People make every decision', icon: CheckSquare, left: 10, top: 136 },
  { title: 'UiPath robot', detail: 'Enters the PO in the ERP', icon: Bot, left: 246, top: 206 },
];
const FLOW_PATH = 'M224 30 C238 30 232 76 246 76 M358 122 C358 150 272 166 234 166 M122 212 C122 236 196 236 246 236';
const FLOW_JOINTS: Array<[number, number]> = [
  [224, 30],
  [246, 76],
  [358, 122],
  [234, 166],
  [122, 212],
  [246, 236],
];

/** Theme-aware (hero-* tokens): white translucent cards in light, deep navy cards in dark. */
function WorkflowIllustration() {
  return (
    <div aria-hidden className="relative h-[284px] w-[470px] origin-top-left scale-[0.92] select-none xl:scale-100">
      <svg viewBox="0 0 470 284" className="absolute inset-0 h-full w-full overflow-visible">
        <path d={FLOW_PATH} fill="none" strokeWidth={1.25} strokeDasharray="3 5" className="stroke-[var(--hero-path)]" />
        <path d={FLOW_PATH} fill="none" strokeWidth={2} strokeLinecap="round" pathLength={1} className="decor-travel stroke-[var(--hero-pulse)]" />
        {FLOW_JOINTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={3} className="fill-[var(--hero-joint)]" />
        ))}
      </svg>
      {FLOW_STEPS.map((step, index) => (
        <div
          key={step.title}
          className="absolute w-56 animate-fade-up"
          style={{ left: step.left, top: step.top, animationDelay: `${200 + index * 120}ms` } as CSSProperties}
        >
          <div
            className="animate-float rounded-xl border border-hero-card-border bg-hero-card p-3 shadow-[var(--hero-shadow)] inset-shadow-[0_1px_0_0_var(--surface-highlight)]"
            style={{ animationDelay: `${index * -2.2}s` }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hero-icon-bg text-hero-icon-fg ring-1 ring-hero-icon-ring ring-inset">
                <step.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-wider text-hero-subtle uppercase">Step 0{index + 1}</p>
                <p className="truncate text-[13px] font-semibold text-hero-foreground">{step.title}</p>
              </div>
            </div>
            <p className="mt-1.5 truncate text-[11px] text-hero-muted">{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Expressive atmosphere for the brand panel: white-blue in light, deep navy in dark (hero-* tokens). */
function BrandAtmosphere() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-[radial-gradient(closest-side,var(--hero-glow-a),transparent)]" />
      <div className="absolute -right-40 -bottom-48 size-[36rem] rounded-full bg-[radial-gradient(closest-side,var(--hero-glow-b),transparent)]" />
      <div className="absolute top-1/3 left-1/2 size-72 rounded-full bg-[radial-gradient(closest-side,var(--hero-glow-c),transparent)]" />
      <div className="decor-hero-grid absolute inset-0" />
      <div className="absolute -right-10 bottom-16 opacity-70 [--atmo-line:var(--hero-line)] [--atmo-node-soft:var(--hero-node-soft)] [--atmo-node:var(--hero-node)]">
        <NetworkPattern className="h-52 w-[28rem]" />
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const DEMO_OPEN_KEY = 'orchestra-demo-accounts-open';

/** Minimised by default so the sign-in form fits without scrolling; the choice is remembered per browser. */
function useDemoListOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(DEMO_OPEN_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () =>
    setOpen((current) => {
      const next = !current;
      try {
        localStorage.setItem(DEMO_OPEN_KEY, next ? '1' : '0');
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  return { open, toggle };
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [demoPending, setDemoPending] = useState<string | null>(null);
  const demoList = useDemoListOpen();
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
      <aside className="relative isolate hidden flex-col justify-between gap-8 overflow-hidden border-r border-hero-card-border bg-hero p-10 text-hero-foreground lg:flex xl:p-12 dark:border-transparent">
        <BrandAtmosphere />
        <OrchestraLogo
          className="animate-fade-in"
          symbolClassName="size-10"
          wordmarkClassName="text-xl leading-6"
          tagline={BRAND.tagline}
          taglineClassName="text-xs text-hero-subtle opacity-100"
        />
        {/* ORBI greets visitors: an onboarding moment only, never a status indicator. */}
        <div className="pointer-events-none absolute top-5 right-5 z-10 hidden items-start gap-3 lg:flex xl:top-8 xl:right-10">
          <div className="relative mt-6 hidden animate-fade-up rounded-2xl rounded-tr-sm border border-hero-card-border bg-hero-card px-3.5 py-2.5 shadow-[var(--hero-shadow)] [animation-delay:600ms] xl:block">
            <p className="font-display text-sm font-semibold text-hero-foreground">Hi, I&apos;m {BRAND.mascot.name}.</p>
            <p className="text-xs text-hero-muted">Your automation co-pilot.</p>
          </div>
          <Orbi expression="greeting" size={124} animated title={`${BRAND.mascot.name}, the ${BRAND.name} mascot, waving hello`} />
        </div>

        <div className="max-w-lg space-y-8">
          <div className="animate-fade-up space-y-4">
            <Badge className="border-hero-badge-border bg-hero-badge-bg text-hero-badge-fg">
              <span className="size-1.5 rounded-full bg-[var(--hero-pulse)]" aria-hidden /> Purchase request → purchase order
            </Badge>
            <h1 className="font-display text-3xl leading-tight font-semibold tracking-[-0.02em] text-balance text-hero-foreground xl:text-[2.125rem]">
              From purchase request to purchase order, with a human in control of every decision.
            </h1>
            <p className="max-w-md text-hero-muted">
              Document intelligence reads the invoice, business rules check it, approvers decide, and a UiPath robot enters the purchase order in the ERP. Every step is
              audited.
            </p>
          </div>
          <ol className="sr-only">
            {FLOW_STEPS.map((step) => (
              <li key={step.title}>
                {step.title}: {step.detail}
              </li>
            ))}
          </ol>
          <WorkflowIllustration />
        </div>

        <p className="flex items-center gap-2 text-xs text-hero-subtle">
          <span className="size-1.5 rounded-full bg-hero-subtle" aria-hidden />
          Simulation environment · synthetic data only
        </p>
      </aside>

      <main className="relative isolate flex items-center justify-center overflow-hidden bg-background p-4 sm:p-6">
        <RadialGlow className="-z-10 opacity-80" />
        <DotGrid className="-z-10 opacity-60" />
        <div className="w-full max-w-[26rem] animate-page-in space-y-4">
          <Card className="p-6 shadow-sm sm:p-7">
            <div className="mb-6 space-y-1.5">
              <OrchestraLogo className="mb-5 lg:hidden" symbolClassName="size-8" wordmarkClassName="text-base" tagline={BRAND.tagline} taglineClassName="text-muted-foreground opacity-100" />
              <h2 className="font-display text-2xl font-semibold tracking-[-0.015em]">Sign in</h2>
              <p className="text-sm text-muted-foreground">Use your Orchestra account.</p>
            </div>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {error ? <Alert tone="danger">{error}</Alert> : null}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="username" {...form.register('email')} aria-invalid={!!form.formState.errors.email} />
                {form.formState.errors.email ? <FieldMessage>{form.formState.errors.email.message}</FieldMessage> : null}
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
          </Card>

          {demo.isLoading ? (
            <Skeleton className="h-[62px] rounded-xl" />
          ) : demoAccounts.length > 0 ? (
            <Card className="animate-fade-up overflow-hidden [animation-delay:120ms]">
              <button
                type="button"
                onClick={demoList.toggle}
                aria-expanded={demoList.open}
                aria-controls="demo-accounts"
                className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary ring-1 ring-border-interactive ring-inset dark:text-info-foreground dark:ring-primary/20">
                  <Users className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Simulation: sign in as</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {demoAccounts.length} accounts · no password needed
                  </span>
                </span>
                {!demoList.open ? (
                  <span aria-hidden className="hidden -space-x-2 min-[420px]:flex">
                    {demoAccounts.slice(0, 4).map((account) => (
                      <span
                        key={account.email}
                        className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card"
                      >
                        {initials(account.name)}
                      </span>
                    ))}
                    {demoAccounts.length > 4 ? (
                      <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-[10px] font-semibold text-primary ring-2 ring-card dark:text-info-foreground">
                        +{demoAccounts.length - 4}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary dark:text-info-foreground">
                  {demoList.open ? 'Minimize' : 'Show'}
                  <ChevronDown className={cn('size-4 transition-transform duration-200', demoList.open && 'rotate-180')} aria-hidden />
                </span>
              </button>
              <Collapse open={demoList.open} id="demo-accounts">
                <CardContent className="border-t px-3 pt-3 pb-3">
                  <ul className="divide-y overflow-hidden rounded-lg border">
                    {demoAccounts.map((account) => (
                      <li key={account.email}>
                        <button
                          type="button"
                          onClick={() => signInAs(account.email)}
                          disabled={demoPending !== null}
                          className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60"
                        >
                          <span
                            aria-hidden
                            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border transition-colors group-hover:bg-primary-soft group-hover:text-primary"
                          >
                            {initials(account.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{account.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {account.department ? <span className="font-medium text-foreground/70">{account.department.code} · </span> : null}
                              {account.email}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-wrap justify-end gap-1">
                            {account.roles.map((role) => (
                              <RoleBadge key={role} role={role} />
                            ))}
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
              </Collapse>
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
                      className="rounded-md border px-2 py-1 text-xs transition-colors hover:bg-accent"
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
