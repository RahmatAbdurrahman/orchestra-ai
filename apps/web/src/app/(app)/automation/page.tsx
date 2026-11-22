'use client';

import { AUTOMATION_JOB_STATUS_LABELS, AUTOMATION_JOB_STATUSES, type AutomationJobStatus } from '@orchestra/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bot, ChevronRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { EmptyState, ErrorBlock, FetchingBar, LoadingBlock, PageHeader, Pager, Toolbar } from '@/components/page';
import { JobStatusBadge } from '@/components/status-badge';
import { Badge, Card, NativeSelect, Skeleton, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDuration, formatRelative } from '@/lib/format';
import type { AutomationJobRow, Paginated, UiPathHealth } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The job lifecycle as UiPath reports it; FAILED and CANCELLED are terminal branches. */
const LIFECYCLE: AutomationJobStatus[] = ['QUEUED', 'SUBMITTING', 'PENDING', 'RUNNING', 'COMPLETED'];
const TERMINAL: AutomationJobStatus[] = ['FAILED', 'CANCELLED'];

/**
 * Status filter drawn as the job lifecycle. It only changes the existing status filter; it shows no
 * counts, so nothing here is inferred beyond the list the API returns.
 */
function LifecycleFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const chip = (status: string, label: string) => {
    const active = value === status;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onChange(status)}
        className={cn(
          'relative h-8 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 outline-none focus-visible:shadow-[var(--focus-ring)]',
          active
            ? 'border-primary/40 bg-primary/10 text-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_10%,transparent)] dark:text-info-foreground'
            : 'bg-card text-muted-foreground hover:border-border-strong hover:text-foreground',
        )}
      >
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Filter by job status" className="hidden flex-wrap items-center gap-x-1 gap-y-2 md:flex">
      {chip('', 'All')}
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
      {LIFECYCLE.map((status, index) => (
        <Fragment key={status}>
          {index > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" /> : null}
          {chip(status, AUTOMATION_JOB_STATUS_LABELS[status])}
        </Fragment>
      ))}
      <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />
      {TERMINAL.map((status) => (
        <Fragment key={status}>{chip(status, AUTOMATION_JOB_STATUS_LABELS[status])}</Fragment>
      ))}
    </div>
  );
}

/** Attempts used out of the allowed total, as dots plus the exact numbers. */
function AttemptDots({ count, max }: { count: number; max: number }) {
  const shown = Math.min(max, 8);
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="flex gap-0.5">
        {Array.from({ length: shown }, (_, index) => (
          <span key={index} className={cn('size-1.5 rounded-full', index < count ? 'bg-primary' : 'bg-border')} />
        ))}
      </span>
      <span className="text-xs tabular-nums">
        {count}/{max}
      </span>
    </span>
  );
}

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
  const changeStatus = (value: string) => {
    setPage(1);
    setStatus(value);
  };

  return (
    <>
      <PageHeader
        icon={Bot}
        title="Automation jobs"
        description="Purchase order creation jobs executed by UiPath robots. Statuses come from UiPath Orchestrator and refresh every few seconds."
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
      <Toolbar>
        <LifecycleFilter value={status} onChange={changeStatus} />
        <NativeSelect className="md:hidden" value={status} aria-label="Filter by job status" onChange={(event) => changeStatus(event.target.value)}>
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
          mascot={status ? 'thinking' : 'default'}
          icon={Bot}
          title={status ? 'No jobs with this status' : 'No automation jobs yet'}
          description={status ? 'Choose another status to see more jobs.' : 'A UiPath job is created when a purchase request is fully approved.'}
        />
      ) : null}
      {jobs.data?.data.length ? (
        <Card className="relative overflow-hidden">
          <FetchingBar active={jobs.isFetching && jobs.isPlaceholderData} />
          <Table className={cn('transition-opacity duration-200', jobs.isPlaceholderData && 'opacity-60')}>
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
                <TR key={job.id} className="group cursor-pointer" onClick={() => router.push(`/automation/${job.id}`)}>
                  <TD>
                    <Link
                      href={`/automation/${job.id}`}
                      className="font-mono text-[13px] font-semibold transition-colors group-hover:text-primary hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
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
                  <TD>
                    <AttemptDots count={job.attemptCount} max={job.maxTotalAttempts} />
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
                  <TD className="hidden tabular-nums lg:table-cell">{formatDuration(job.durationSeconds)}</TD>
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
