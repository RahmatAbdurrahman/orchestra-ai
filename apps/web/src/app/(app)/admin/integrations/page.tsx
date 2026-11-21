'use client';

import { Permission } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle2, Loader2, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Alert, Badge, type BadgeTone, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { SystemHealth, UiPathHealth } from '@/lib/types';
import { cn } from '@/lib/utils';

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors duration-300">
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300',
          ok ? 'bg-success/10 text-success-foreground' : 'bg-destructive/10 text-destructive-foreground',
        )}
      >
        {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      <span className={cn('text-xs font-medium', ok ? 'text-success-foreground' : 'text-destructive-foreground')}>{ok ? 'OK' : 'Failed'}</span>
    </div>
  );
}

function latencyTone(ms: number): BadgeTone {
  if (ms < 800) return 'success';
  if (ms < 2500) return 'warning';
  return 'danger';
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
      <PageHeader title="Integrations" description="UiPath Orchestrator connectivity and platform health. Credentials stay on the server and are never shown." />
      <div className="stagger grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary dark:text-info-foreground">
                <PlugZap className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  UiPath Orchestrator
                  {uipath.data ? (
                    <Badge tone={uipath.data.ok ? (uipath.data.isMock ? 'warning' : 'success') : 'danger'}>
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
                <div className="grid gap-2 sm:grid-cols-2" aria-live="polite">
                  <Check ok={uipath.data.configured} label="Configured" detail="Client credentials present" />
                  <Check ok={uipath.data.authenticated} label="Authenticated" detail="Access token issued" />
                  <Check ok={uipath.data.folderAccessible} label="Folder accessible" detail={uipath.data.folderId ? `Folder ${uipath.data.folderId}` : undefined} />
                  <Check ok={uipath.data.processFound} label="Process found" detail={uipath.data.processName} />
                </div>
                {uipath.data.message ? (
                  <Alert tone="danger">
                    <XCircle className="size-4" />
                    <div>{uipath.data.message}</div>
                  </Alert>
                ) : null}
                <dl className="grid grid-cols-2 gap-4 border-t pt-4">
                  <KeyValue label="Mode">
                    <Badge tone={uipath.data.isMock ? 'warning' : 'primary'}>{uipath.data.mode}</Badge>
                  </KeyValue>
                  <KeyValue label="Latency">
                    <Badge tone={latencyTone(uipath.data.latencyMs)} className="tabular-nums">
                      {uipath.data.latencyMs} ms
                    </Badge>
                  </KeyValue>
                  <KeyValue label="Orchestrator URL" className="col-span-2">
                    <span className="font-mono text-xs">{uipath.data.orchestratorUrl ?? '—'}</span>
                  </KeyValue>
                  <KeyValue label="Folder (OrganizationUnitId)">{uipath.data.folderId ?? '—'}</KeyValue>
                  <KeyValue label="Last health check">
                    <span title={formatDateTime(uipath.data.checkedAt)}>{formatRelative(uipath.data.checkedAt)}</span>
                  </KeyValue>
                </dl>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden /> Platform health
            </CardTitle>
            <CardDescription>Dependencies reported by the API health endpoint</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {system.error ? <ErrorBlock error={system.error} onRetry={() => void system.refetch()} /> : null}
            {system.data ? (
              <div className="space-y-2" aria-live="polite">
                <Check ok={system.data.checks.database === 'up'} label="PostgreSQL" detail="Primary database" />
                <Check
                  ok={system.data.checks.queue.status === 'up'}
                  label="Job queue"
                  detail={system.data.checks.queue.driver === 'inline' ? 'In-process, development only' : 'Redis / BullMQ'}
                />
                <Check ok={system.data.checks.documentIntelligence === 'up'} label="Document intelligence" detail="OCR and field extraction service" />
                <Check ok={system.data.checks.uipath === 'configured'} label="UiPath configured" detail="Credentials present on the server" />
                <p className="pt-1 text-xs text-muted-foreground">
                  Checked <span title={formatDateTime(system.data.time)}>{formatRelative(system.data.time)}</span> · refreshes every 15 s
                </p>
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
