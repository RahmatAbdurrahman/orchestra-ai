'use client';

import { Permission } from '@orchestra/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { ReasonDialog, RetryButton } from '@/components/requests/action-dialogs';
import { JobStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { AutomationJobDetail, AutomationLogView } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function AutomationJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: ['automation', 'job', id],
    queryFn: () => api<AutomationJobDetail>(`/automation/jobs/${id}`),
    refetchInterval: (query) => (query.state.data && ['QUEUED', 'SUBMITTING', 'PENDING', 'RUNNING'].includes(query.state.data.status) ? 2_000 : 15_000),
  });
  const logs = useQuery({
    queryKey: ['automation', 'job', id, 'logs', job.data?.updatedAt ?? job.data?.lastPolledAt],
    queryFn: () => api<AutomationLogView[]>(`/automation/jobs/${id}/logs`),
    enabled: !!job.data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['automation'] });

  if (job.error) return <ErrorBlock error={job.error} />;
  if (!job.data) return <LoadingBlock rows={8} />;
  const data = job.data;

  return (
    <>
      <Link href="/automation" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Automation jobs
      </Link>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <JobStatusBadge status={data.status} />
            {data.integrationMode === 'mock' ? <Badge tone="warning">MOCK Orchestrator — not a real robot</Badge> : null}
          </span>
        }
        title={
          <>
            {data.processName} · <Link className="font-mono hover:underline" href={`/requests/${data.purchaseRequest.id}`}>{data.purchaseRequest.requestNumber}</Link>
          </>
        }
        description={data.purchaseRequest.title}
        actions={
          <>
            {data.canRetry && can(Permission.AUTOMATION_RETRY) ? <RetryButton jobId={data.id} onDone={refresh} /> : null}
            {data.status === 'FAILED' && can(Permission.AUTOMATION_EXECUTE) ? (
              <ReasonDialog
                trigger={
                  <Button variant="outline" className="text-destructive">
                    <Ban /> Abandon job
                  </Button>
                }
                title="Abandon automation job"
                description="The job and its purchase request are cancelled. Use this when the order was handled manually."
                label="Reason"
                required
                destructive
                confirmLabel="Abandon"
                onConfirm={async (reason) => {
                  await api(`/automation/jobs/${data.id}/cancel`, { body: { reason } });
                  toast.success('Job cancelled');
                  await refresh();
                }}
              />
            ) : null}
          </>
        }
      />

      {data.status === 'FAILED' ? (
        <Alert tone="danger" className="mb-4">
          <span className="font-mono text-xs">{data.errorCode}</span> {data.errorMessage}
          {data.requiresIntervention ? (
            <div className="mt-1 font-medium">Retry limit reached ({data.attemptCount}/{data.maxTotalAttempts}). Check the ERP and resolve manually.</div>
          ) : (
            <div className="mt-1 text-xs">Retrying is safe: the same idempotency key is sent, so the ERP never creates a duplicate purchase order.</div>
          )}
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <KeyValue label="PO number">{data.poNumber ? <span className="font-mono">{data.poNumber}</span> : '—'}</KeyValue>
            <KeyValue label="Attempts">{data.attemptCount} of {data.maxTotalAttempts} (auto ≤ {data.maxAutoAttempts})</KeyValue>
            <KeyValue label="Current UiPath job">{data.uipathJobId ?? '—'}</KeyValue>
            <KeyValue label="Queued">{formatDateTime(data.queuedAt)}</KeyValue>
            <KeyValue label="Started">{formatDateTime(data.startedAt)}</KeyValue>
            <KeyValue label="Completed">{formatDateTime(data.completedAt)}</KeyValue>
            <KeyValue label="Duration">{formatDuration(data.durationSeconds)}</KeyValue>
            <KeyValue label="Last status check">{formatDateTime(data.lastPolledAt)}</KeyValue>
            <KeyValue label="Next automatic attempt">{formatDateTime(data.nextAttemptAt)}</KeyValue>
            <KeyValue label="Idempotency key" className="col-span-2 md:col-span-3"><span className="font-mono text-xs">{data.idempotencyKey}</span></KeyValue>
            <KeyValue label="Correlation id" className="col-span-2 md:col-span-3"><span className="font-mono text-xs">{data.correlationId}</span></KeyValue>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Robot input</CardTitle>
            <CardDescription>Validated payload sent to UiPath</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed">{JSON.stringify(data.inputPayload, null, 2)}</pre>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>UiPath attempts</CardTitle>
          <CardDescription>Each attempt carries a unique Orchestrator reference, checked before any resubmission.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>#</TH>
                <TH>Trigger</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Reference</TH>
                <TH>UiPath job</TH>
                <TH className="hidden lg:table-cell">Submitted</TH>
                <TH className="hidden lg:table-cell">Ended</TH>
                <TH>Error</TH>
              </TR>
            </THead>
            <TBody>
              {data.attempts.map((attempt) => (
                <TR key={attempt.id}>
                  <TD>{attempt.attemptNo}</TD>
                  <TD>{attempt.triggeredBy === 'USER' ? 'Operator' : 'System'}</TD>
                  <TD>
                    <Badge tone={attempt.status === 'SUCCESSFUL' ? 'success' : ['FAULTED', 'SUBMIT_FAILED', 'STOPPED'].includes(attempt.status) ? 'danger' : 'info'}>{attempt.status}</Badge>
                  </TD>
                  <TD className="hidden font-mono text-xs md:table-cell">{attempt.reference}</TD>
                  <TD className="font-mono text-xs">{attempt.uipathJobId ?? '—'} {attempt.uipathState ? <span className="text-muted-foreground">({attempt.uipathState})</span> : null}</TD>
                  <TD className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(attempt.submittedAt)}</TD>
                  <TD className="hidden whitespace-nowrap lg:table-cell">{formatDateTime(attempt.endedAt)}</TD>
                  <TD className="max-w-72 truncate text-xs" title={attempt.errorMessage ?? undefined}>
                    {attempt.errorCode ? <span className="text-destructive">{attempt.errorCode}</span> : '—'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Execution log</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-1.5 font-mono text-xs">
            {logs.data?.map((log) => (
              <li key={log.id} className="flex gap-3">
                <span className="shrink-0 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                <span className={cn('w-12 shrink-0', log.level === 'ERROR' ? 'text-destructive' : log.level === 'WARN' ? 'text-[oklch(0.55_0.13_60)]' : 'text-success')}>{log.level}</span>
                <span className="min-w-0 break-words">
                  <span className="text-muted-foreground">[{log.eventType}{log.attemptNo ? ` #${log.attemptNo}` : ''}]</span> {log.message}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
