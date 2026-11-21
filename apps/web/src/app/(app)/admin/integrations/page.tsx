'use client';

import { Permission } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, CheckCircle2, FolderOpen, KeyRound, Loader2, MinusCircle, PlugZap, RefreshCw, Server, ShieldCheck, XCircle, type LucideIcon } from 'lucide-react';
import { Fragment } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Alert, Badge, type BadgeTone, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SystemHealth, UiPathHealth } from '@/lib/types';
import { cn } from '@/lib/utils';

type StepState = 'ok' | 'failed' | 'skipped';

const STATE_TEXT: Record<StepState, string> = { ok: 'OK', failed: 'Failed', skipped: 'Not checked' };

/**
 * The API checks UiPath in order (configured -> token -> folder -> process) and stops at the first
 * failure, so the steps after a failure were not checked rather than failed.
 */
function chainStates(health: UiPathHealth): StepState[] {
  let blocked = false;
  return [health.configured, health.authenticated, health.folderAccessible, health.processFound].map((ok) => {
    if (blocked) return 'skipped';
    if (ok) return 'ok';
    blocked = true;
    return 'failed';
  });
}

function StateIcon({ state, className }: { state: StepState; className?: string }) {
  const Icon = state === 'ok' ? CheckCircle2 : state === 'failed' ? XCircle : MinusCircle;
  return <Icon aria-hidden className={cn('size-3.5', state === 'ok' ? 'text-success-foreground' : state === 'failed' ? 'text-destructive-foreground' : 'text-subtle-foreground', className)} />;
}

/** Connected-node view of the UiPath connection, coloured only by the states the API returned. */
function ConnectionChain({ health }: { health: UiPathHealth }) {
  const states = chainStates(health);
  const nodes: Array<{ label: string; detail: string; icon: LucideIcon; state: StepState | 'origin' }> = [
    { label: 'Orchestra API', detail: 'This server', icon: Server, state: 'origin' },
    { label: 'Credentials', detail: 'Client ID and secret', icon: KeyRound, state: states[0]! },
    { label: 'Access token', detail: 'OAuth client credentials', icon: ShieldCheck, state: states[1]! },
    { label: 'Folder', detail: health.folderId ? `Folder ${health.folderId}` : 'Not set', icon: FolderOpen, state: states[2]! },
    { label: 'Process', detail: health.processName, icon: Bot, state: states[3]! },
  ];
  return (
    <div key={health.checkedAt} className="relative rounded-xl border bg-surface-tint p-3">
      <div aria-hidden className="decor-dots decor-fade-radial pointer-events-none absolute inset-0 rounded-xl opacity-60" />
      <ol className="relative flex flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0" aria-label="UiPath connection steps">
      {nodes.map((node, index) => (
        <Fragment key={node.label}>
          {index > 0 ? (
            <li role="presentation" className="relative hidden w-5 flex-none items-center sm:flex">
              <span
                className={cn(
                  'h-0.5 w-full origin-left animate-grow-x rounded-full',
                  node.state === 'ok' ? 'bg-success/60' : node.state === 'failed' ? 'bg-destructive/50' : 'bg-[repeating-linear-gradient(90deg,var(--border-strong)_0_4px,transparent_4px_8px)]',
                )}
                style={{ animationDelay: `${index * 120}ms` }}
              />
            </li>
          ) : null}
          <li
            className={cn(
              'relative flex min-w-0 animate-fade-up items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 sm:flex-1 sm:flex-col sm:items-start sm:gap-1.5',
              node.state === 'failed' && 'border-destructive-border',
            )}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-md',
                node.state === 'origin' && 'bg-primary/10 text-primary dark:text-info-foreground',
                node.state === 'ok' && 'bg-success-soft text-success-foreground',
                node.state === 'failed' && 'bg-destructive-soft text-destructive-foreground',
                node.state === 'skipped' && 'bg-muted text-subtle-foreground',
              )}
            >
              <node.icon className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 sm:w-full">
              <span className="block truncate text-[13px] leading-4 font-medium sm:whitespace-normal">{node.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground" title={node.detail}>
                {node.detail}
              </span>
            </span>
            {node.state === 'origin' ? null : (
              <span className="flex items-center gap-1 text-[11px] font-medium sm:mt-0.5">
                <StateIcon state={node.state} />
                <span className={node.state === 'ok' ? 'text-success-foreground' : node.state === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground'}>
                  {STATE_TEXT[node.state]}
                </span>
              </span>
            )}
          </li>
        </Fragment>
      ))}
      </ol>
    </div>
  );
}

function latencyTone(ms: number): BadgeTone {
  if (ms < 800) return 'success';
  if (ms < 2500) return 'warning';
  return 'danger';
}

/** Measured round-trip of the last health check on a 0–3 s scale. */
function LatencyMeter({ ms }: { ms: number }) {
  const tone = latencyTone(ms);
  return (
    <div className="space-y-1.5">
      <Badge tone={tone} className="tabular-nums">
        {ms} ms
      </Badge>
      <div aria-hidden className="h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full origin-left animate-grow-x rounded-full', tone === 'success' ? 'bg-success' : tone === 'warning' ? 'bg-warning' : 'bg-destructive')}
          style={{ width: `${Math.max(4, Math.min(100, (ms / 3000) * 100))}%` }}
        />
      </div>
    </div>
  );
}

/** One dependency in the platform health tree. */
function DependencyRow({ ok, label, detail, last }: { ok: boolean; label: string; detail: string; last?: boolean }) {
  return (
    <li className="relative pl-7">
      <span aria-hidden className={cn('absolute top-0 left-3 w-px bg-border', last ? 'h-1/2' : 'h-full')} />
      <span aria-hidden className="absolute top-1/2 left-3 h-px w-3 bg-border" />
      <span aria-hidden className={cn('absolute top-1/2 left-[22px] size-1.5 -translate-y-1/2 rounded-full', ok ? 'bg-success' : 'bg-destructive')} />
      <div className="my-1 flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors duration-300">
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', ok ? 'bg-success-soft text-success-foreground' : 'bg-destructive-soft text-destructive-foreground')}>
          {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <span className={cn('text-xs font-medium', ok ? 'text-success-foreground' : 'text-destructive-foreground')}>{ok ? 'OK' : 'Failed'}</span>
      </div>
    </li>
  );
}

export default function IntegrationsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const uipath = useQuery({ queryKey: ['integrations', 'uipath'], queryFn: () => api<UiPathHealth>('/integrations/uipath/health') });
  const system = useQuery({ queryKey: ['health'], queryFn: () => api<SystemHealth>('/health'), refetchInterval: 15_000 });
  const test = useMutation({
    mutationFn: () => api<UiPathHealth>('/integrations/uipath/test-connection', { method: 'POST' }),
    onSuccess: (result) => {
      queryClient.setQueryData(['integrations', 'uipath'], result);
      if (result.ok) toast.success('UiPath connection verified');
      else toast.error(result.message ?? 'UiPath connection failed');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        icon={PlugZap}
        title="Integrations"
        description="UiPath Orchestrator connectivity and platform health. Credentials stay on the server and are never shown."
      />
      <div className="stagger grid gap-4 2xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:text-info-foreground">
                <PlugZap className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  UiPath Orchestrator
                  {uipath.data ? (
                    <Badge key={`${uipath.data.ok}`} tone={uipath.data.ok ? (uipath.data.isMock ? 'warning' : 'success') : 'danger'} className="animate-status-in">
                      <span className="size-1.5 rounded-full bg-current" aria-hidden />
                      {uipath.data.ok ? 'Connected' : 'Not connected'}
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>OAuth client credentials (External Application)</CardDescription>
              </div>
            </div>
            {can(Permission.INTEGRATIONS_MANAGE) ? (
              <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {test.isPending ? 'Testing…' : 'Test connection'}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {uipath.error ? <ErrorBlock error={uipath.error} onRetry={() => void uipath.refetch()} /> : null}
            {uipath.isLoading ? <LoadingBlock rows={4} label="Checking UiPath" /> : null}
            {uipath.data ? (
              <>
                {uipath.data.isMock ? (
                  <Alert tone="warning">
                    Connected to the <strong>development mock</strong> of Orchestrator. Its simulated robot drives the ERP simulation; results do not demonstrate a real UiPath robot.
                  </Alert>
                ) : null}
                <div className={cn('transition-opacity duration-200', test.isPending && 'opacity-60')} aria-live="polite">
                  <ConnectionChain health={uipath.data} />
                </div>
                {uipath.data.message ? (
                  <Alert tone="danger">
                    <XCircle className="size-4" />
                    <div>{uipath.data.message}</div>
                  </Alert>
                ) : null}
                <dl className="grid grid-cols-2 gap-4 border-t pt-4 md:grid-cols-3">
                  <KeyValue label="Mode">
                    <Badge tone={uipath.data.isMock ? 'warning' : 'primary'}>{uipath.data.mode}</Badge>
                  </KeyValue>
                  <div className="min-w-0 space-y-1">
                    <dt className="text-xs text-muted-foreground">Latency</dt>
                    <dd>
                      <LatencyMeter ms={uipath.data.latencyMs} />
                    </dd>
                  </div>
                  <KeyValue label="Last health check">
                    <span title={formatDateTime(uipath.data.checkedAt)}>{formatRelative(uipath.data.checkedAt)}</span>
                  </KeyValue>
                  <KeyValue label="Orchestrator URL" className="col-span-2 md:col-span-3">
                    <span className="font-mono text-xs">{uipath.data.orchestratorUrl ?? '—'}</span>
                  </KeyValue>
                  <KeyValue label="Folder (OrganizationUnitId)">{uipath.data.folderId ?? '—'}</KeyValue>
                  <KeyValue label="Process" className="col-span-1 md:col-span-2">
                    <span className="font-mono text-xs">{uipath.data.processName}</span>
                  </KeyValue>
                </dl>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden /> Platform health
            </CardTitle>
            <CardDescription>Dependencies reported by the API health endpoint</CardDescription>
          </CardHeader>
          <CardContent>
            {system.error ? <ErrorBlock error={system.error} onRetry={() => void system.refetch()} /> : null}
            {system.data ? (
              <div aria-live="polite">
                <div className="flex items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary dark:text-info-foreground">
                    <Server className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Orchestra API</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Responded <span title={formatDateTime(system.data.time)}>{formatRelative(system.data.time)}</span> · refreshes every 15 s
                    </span>
                  </span>
                  {/* The API reports "ok" when the database and the queue are up; other checks are listed below. */}
                  <Badge tone={system.data.status === 'ok' ? 'success' : 'warning'} title="Database and job queue">
                    {system.data.status === 'ok' ? 'Core services OK' : 'Degraded'}
                  </Badge>
                </div>
                <ul className="mt-1" aria-label="Dependencies">
                  <DependencyRow ok={system.data.checks.database === 'up'} label="PostgreSQL" detail="Primary database" />
                  <DependencyRow
                    ok={system.data.checks.queue.status === 'up'}
                    label="Job queue"
                    detail={system.data.checks.queue.driver === 'inline' ? 'In-process, development only' : 'Redis / BullMQ'}
                  />
                  <DependencyRow ok={system.data.checks.documentIntelligence === 'up'} label="Document intelligence" detail="OCR and field extraction service" />
                  <DependencyRow ok={system.data.checks.uipath === 'configured'} label="UiPath configured" detail="Credentials present on the server" last />
                </ul>
              </div>
            ) : !system.error ? (
              <LoadingBlock rows={4} label="Checking platform health" />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
