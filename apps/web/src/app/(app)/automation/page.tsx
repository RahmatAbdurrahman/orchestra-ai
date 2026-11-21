'use client';

import { AUTOMATION_JOB_STATUS_LABELS, AUTOMATION_JOB_STATUSES } from '@orchestra/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bot, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager, Toolbar } from '@/components/page';
import { JobStatusBadge } from '@/components/status-badge';
import { Badge, Card, NativeSelect, Skeleton, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDuration, formatRelative } from '@/lib/format';
import type { AutomationJobRow, Paginated, UiPathHealth } from '@/lib/types';

export default function AutomationPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const jobs = useQuery({
    queryKey: ['automation', 'jobs', page, status],
    queryFn: () => api<Paginated<AutomationJobRow>>('/automation/jobs', { query: { page, pageSize: 20, status } }),
    placeholderData: keepPreviousData,
    refetchInterval: 5_000,
  });
  const health = useQuery({
    queryKey: ['integrations', 'uipath'],
    queryFn: () => api<UiPathHealth>('/integrations/uipath/health'),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <>
      <PageHeader
        title="Automation jobs"
        description="Purchase order creation jobs executed by UiPath robots."
        actions={
          health.data ? (
            <Badge tone={health.data.ok ? (health.data.isMock ? 'warning' : 'success') : 'danger'} className="px-2.5 py-1">
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              UiPath {health.data.ok ? 'connected' : 'unavailable'}
              {health.data.isMock ? ' · MOCK Orchestrator' : ''}
            </Badge>
          ) : health.isLoading ? (
            <Skeleton className="h-6 w-36 rounded-full" />
          ) : null
        }
      />
      <Toolbar className="sm:justify-between">
        <p className="text-[13px] text-muted-foreground">
          Statuses come from UiPath Orchestrator and refresh every few seconds.
        </p>
        <NativeSelect
          className="sm:w-56"
          value={status}
          aria-label="Filter by job status"
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
        >
          <option value="">All statuses</option>
          {AUTOMATION_JOB_STATUSES.map((value) => (
            <option key={value} value={value}>
              {AUTOMATION_JOB_STATUS_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </Toolbar>
      {jobs.error ? <ErrorBlock error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}
      {jobs.isLoading ? <LoadingBlock rows={6} label="Loading automation jobs" /> : null}
      {jobs.data?.data.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={status ? 'No jobs with this status' : 'No automation jobs yet'}
          description={status ? 'Choose another status to see more jobs.' : 'A UiPath job is created when a purchase request is fully approved.'}
        />
      ) : null}
      {jobs.data?.data.length ? (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>Request</TH>
                <TH>Status</TH>
                <TH>Attempts</TH>
                <TH className="hidden md:table-cell">UiPath job</TH>
                <TH>PO / error</TH>
                <TH className="hidden lg:table-cell">Duration</TH>
                <TH className="hidden sm:table-cell">Updated</TH>
              </TR>
            </THead>
            <TBody>
              {jobs.data.data.map((job) => (
                <TR key={job.id} className="cursor-pointer" onClick={() => router.push(`/automation/${job.id}`)}>
                  <TD>
                    <Link href={`/automation/${job.id}`} className="font-mono text-[13px] font-semibold hover:text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
                      {job.purchaseRequest.requestNumber}
                    </Link>
                    <div className="max-w-56 truncate text-xs text-muted-foreground">{job.purchaseRequest.title}</div>
                  </TD>
                  <TD>
                    <JobStatusBadge status={job.status} />
                    {job.requiresIntervention ? (
                      <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-destructive-foreground">
                        <TriangleAlert className="size-3" aria-hidden /> Needs intervention
                      </div>
                    ) : null}
                  </TD>
                  <TD className="tabular-nums">
                    {job.attemptCount}/{job.maxTotalAttempts}
                  </TD>
                  <TD className="hidden font-mono text-xs text-muted-foreground md:table-cell">{job.uipathJobId ?? '—'}</TD>
                  <TD className="max-w-64 truncate">
                    {job.poNumber ? (
                      <span className="font-mono text-[13px] font-medium text-success-foreground">{job.poNumber}</span>
                    ) : job.errorCode ? (
                      <span className="font-mono text-xs text-destructive-foreground">{job.errorCode}</span>
                    ) : (
                      <span className="text-subtle-foreground">—</span>
                    )}
                  </TD>
                  <TD className="hidden lg:table-cell">{formatDuration(job.durationSeconds)}</TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{formatRelative(job.completedAt ?? job.lastPolledAt ?? job.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      {jobs.data ? <Pager page={page} totalPages={jobs.data.meta.totalPages} total={jobs.data.meta.total} onChange={setPage} /> : null}
    </>
  );
}
