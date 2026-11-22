'use client';

import { Permission } from '@orchestra/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Bot, CheckCircle2, Circle, Play, Timer, XCircle } from 'lucide-react';
import Link from 'next/link';
import { Fragment, use } from 'react';
import { toast } from 'sonner';
import { ErrorState, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { ReasonDialog, RetryButton } from '@/components/requests/action-dialogs';
import { JobStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { AutomationJobDetail, AutomationLogView } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * Queued -> started -> finished, drawn from the job's own timestamps. A step without a timestamp is
 * shown as not reached; nothing is estimated.
 */
function ExecutionTimeline({
  queuedAt,
  startedAt,
  completedAt,
  status,
}: {
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
}) {
  const failed = status === 'FAILED' || status === 'CANCELLED';
  const steps = [
    { label: 'Queued', at: queuedAt, icon: Timer },
    { label: 'Robot started', at: startedAt, icon: Play },
    { label: failed ? (status === 'FAILED' ? 'Failed' : 'Cancelled') : 'Finished', at: completedAt, icon: failed ? XCircle : CheckCircle2 },
  ];
  return (
    <Card className="mb-4 px-4 py-4 sm:px-5">
      <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-0" aria-label="Execution timeline">
        {steps.map((step, index) => {
          const reached = Boolean(step.at);
          const Icon = reached ? step.icon : Circle;
          return (
            <Fragment key={step.label}>
              {index > 0 ? (
                <li role="presentation" className="relative mx-4 hidden h-0.5 min-w-8 flex-1 overflow-hidden rounded-full bg-border sm:block">
                  {reached ? <span className="absolute inset-0 origin-left animate-grow-x rounded-full bg-primary/60" style={{ animationDelay: `${index * 150}ms` }} /> : null}
                </li>
              ) : null}
              <li className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-8 shrink-0 animate-fade-in items-center justify-center rounded-full border',
                    !reached && 'bg-card text-subtle-foreground',
                    reached && index < 2 && 'border-primary/30 bg-primary/10 text-primary dark:text-info-foreground',
                    reached &&
                      index === 2 &&
                      (failed ? 'border-destructive-border bg-destructive-soft text-destructive-foreground' : 'border-success-border bg-success-soft text-success-foreground'),
                  )}
                  style={{ animationDelay: `${index * 150}ms` }}
                >
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{step.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{reached ? formatDateTime(step.at) : 'Not reached'}</span>
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </Card>
  );
}

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

  if (job.error) return <ErrorState error={job.error} onRetry={() => void job.refetch()} title="This automation job could not be loaded" />;
  if (!job.data) return <LoadingBlock rows={8} />;
  const data = job.data;

  return (
    <>
      <Link href="/automation" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Automation jobs
      </Link>
      <PageHeader
        icon={Bot}
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

      <ExecutionTimeline queuedAt={data.queuedAt} startedAt={data.startedAt} completedAt={data.completedAt} status={data.status} />

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
          {logs.isLoading ? <LoadingBlock rows={4} /> : null}
          {logs.data && logs.data.length === 0 ? <p className="text-sm text-muted-foreground">No log entries yet.</p> : null}
          <ol className="scrollbar-thin max-h-[28rem] space-y-1.5 overflow-auto rounded-lg border bg-surface-secondary p-3 font-mono text-xs">
            {logs.data?.map((log) => (
              <li
                key={log.id}
                className={cn(
                  'flex gap-3 border-l-2 pl-2',
                  log.level === 'ERROR' ? 'border-destructive/70' : log.level === 'WARN' ? 'border-warning/70' : 'border-success/40',
                )}
              >
                <span className="shrink-0 text-muted-foreground">{formatDateTime(log.createdAt)}</span>
                <span className={cn('w-12 shrink-0', log.level === 'ERROR' ? 'text-destructive' : log.level === 'WARN' ? 'text-warning-foreground' : 'text-success-foreground')}>{log.level}</span>
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
