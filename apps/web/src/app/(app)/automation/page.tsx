'use client';

import { AUTOMATION_JOB_STATUS_LABELS, AUTOMATION_JOB_STATUSES } from '@orchestra/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { JobStatusBadge } from '@/components/status-badge';
import { Badge, Card, NativeSelect, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
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
            <Badge tone={health.data.ok ? (health.data.isMock ? 'warning' : 'success') : 'danger'}>
              UiPath {health.data.ok ? 'connected' : 'unavailable'}
              {health.data.isMock ? ' · MOCK Orchestrator' : ''}
            </Badge>
          ) : null
        }
      />
      <div className="mb-4 flex justify-end">
        <NativeSelect
          className="w-56"
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
      </div>
      {jobs.error ? <ErrorBlock error={jobs.error} /> : null}
      {jobs.isLoading ? <LoadingBlock rows={6} /> : null}
      {jobs.data?.data.length === 0 ? <EmptyState title="No automation jobs" description="Jobs are created when requests are fully approved." /> : null}
      {jobs.data?.data.length ? (
        <Card>
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
                    <Link href={`/automation/${job.id}`} className="font-mono font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
                      {job.purchaseRequest.requestNumber}
                    </Link>
                    <div className="max-w-56 truncate text-xs text-muted-foreground">{job.purchaseRequest.title}</div>
                  </TD>
                  <TD>
                    <JobStatusBadge status={job.status} />
                    {job.requiresIntervention ? <div className="mt-1 text-[11px] text-destructive">Needs intervention</div> : null}
                  </TD>
                  <TD className="tabular-nums">
                    {job.attemptCount}/{job.maxTotalAttempts}
                  </TD>
                  <TD className="hidden font-mono text-xs md:table-cell">{job.uipathJobId ?? '—'}</TD>
                  <TD className="max-w-64 truncate">
                    {job.poNumber ? <span className="font-mono">{job.poNumber}</span> : job.errorCode ? <span className="text-xs text-destructive">{job.errorCode}</span> : '—'}
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
