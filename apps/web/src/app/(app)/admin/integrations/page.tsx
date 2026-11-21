'use client';

import { Permission } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PlugZap, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { SystemHealth, UiPathHealth } from '@/lib/types';

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-destructive" />}
      {label}
    </div>
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
      <PageHeader title="Integrations" description="UiPath Orchestrator connectivity and platform health. Credentials stay on the server and are never shown." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><PlugZap className="size-4" /> UiPath Orchestrator</CardTitle>
              <CardDescription>OAuth client credentials (External Application)</CardDescription>
            </div>
            {can(Permission.INTEGRATIONS_MANAGE) ? (
              <Button size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="animate-spin" /> : null}
                Test connection
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {uipath.error ? <ErrorBlock error={uipath.error} /> : null}
            {uipath.isLoading ? <LoadingBlock rows={3} /> : null}
            {uipath.data ? (
              <>
                {uipath.data.isMock ? (
                  <Alert tone="warning">
                    Connected to the <strong>development mock</strong> of Orchestrator. Its simulated robot drives the ERP simulation; results do not demonstrate a real UiPath robot.
                  </Alert>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Check ok={uipath.data.configured} label="Configured" />
                  <Check ok={uipath.data.authenticated} label="Authenticated" />
                  <Check ok={uipath.data.folderAccessible} label="Folder accessible" />
                  <Check ok={uipath.data.processFound} label={`Process “${uipath.data.processName}” found`} />
                </div>
                {uipath.data.message ? <p className="text-sm text-destructive">{uipath.data.message}</p> : null}
                <div className="grid grid-cols-2 gap-4">
                  <KeyValue label="Mode"><Badge tone={uipath.data.isMock ? 'warning' : 'primary'}>{uipath.data.mode}</Badge></KeyValue>
                  <KeyValue label="Latency">{uipath.data.latencyMs} ms</KeyValue>
                  <KeyValue label="Orchestrator URL" className="col-span-2"><span className="font-mono text-xs">{uipath.data.orchestratorUrl ?? '—'}</span></KeyValue>
                  <KeyValue label="Folder (OrganizationUnitId)">{uipath.data.folderId ?? '—'}</KeyValue>
                  <KeyValue label="Checked">{formatDateTime(uipath.data.checkedAt)}</KeyValue>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Platform health</CardTitle>
            <CardDescription>API dependencies</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {system.data ? (
              <>
                <Check ok={system.data.checks.database === 'up'} label="PostgreSQL" />
                <Check ok={system.data.checks.queue.status === 'up'} label={`Queue (${system.data.checks.queue.driver === 'inline' ? 'in-process, development only' : 'Redis / BullMQ'})`} />
                <Check ok={system.data.checks.documentIntelligence === 'up'} label="Document intelligence service" />
                <Check ok={system.data.checks.uipath === 'configured'} label="UiPath configured" />
                <p className="text-xs text-muted-foreground">Checked {formatDateTime(system.data.time)}</p>
              </>
            ) : (
              <LoadingBlock rows={3} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
