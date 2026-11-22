'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { EventIcon } from '@/components/event-icon';
import { ExpandOnMount } from '@/components/motion';
import { EmptyState, ErrorBlock, FetchingBar, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { Badge, Card, NativeSelect, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { describeEvent } from '@/lib/events';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { AuditEvent, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';

const ACTION_FILTERS = [
  ['', 'All events'],
  ['PURCHASE_REQUEST.', 'Purchase requests'],
  ['DOCUMENT.', 'Documents'],
  ['APPROVAL.', 'Approvals'],
  ['AUTOMATION.', 'Automation'],
  ['AUTH.', 'Authentication'],
  ['USER.', 'User management'],
  ['WORKFLOW.', 'Workflows'],
] as const;

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const audit = useQuery({
    queryKey: ['audit', page, action],
    queryFn: () => api<Paginated<AuditEvent>>('/audit-logs', { query: { page, pageSize: 25, action } }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        icon={ScrollText}
        title="Audit trail"
        description="Append-only record of user activity, workflow transitions, approvals and robot executions. Your role determines which events you see."
        actions={
          <NativeSelect
            className="w-52"
            value={action}
            aria-label="Filter events"
            onChange={(event) => {
              setPage(1);
              setAction(event.target.value);
            }}
          >
            {ACTION_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        }
      />
      {audit.error ? <ErrorBlock error={audit.error} onRetry={() => void audit.refetch()} /> : null}
      {audit.isLoading ? <LoadingBlock rows={8} label="Loading audit events" /> : null}
      {audit.data?.data.length === 0 ? (
        <EmptyState
          mascot={action ? 'thinking' : 'default'}
          icon={ScrollText}
          title={action ? 'No events in this category' : 'No audit events'}
          description={action ? 'Choose another category, or show all events.' : 'Events you are allowed to see are recorded here as work happens.'}
        />
      ) : null}
      {audit.data?.data.length ? (
        <Card className="relative overflow-hidden">
          <FetchingBar active={audit.isFetching && audit.isPlaceholderData} />
          <Table className={cn('transition-opacity duration-200', audit.isPlaceholderData && 'opacity-60')}>
            <THead>
              <TR>
                <TH className="w-8 pr-0"><span className="sr-only">Details</span></TH>
                <TH>Time</TH>
                <TH>Event</TH>
                <TH className="hidden md:table-cell">Actor</TH>
                <TH className="hidden lg:table-cell">Entity</TH>
              </TR>
            </THead>
            <TBody>
              {audit.data.data.map((event) => (
                <Fragment key={event.id}>
                  <TR className={cn('cursor-pointer', expanded === event.id && 'bg-surface-secondary')} onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                    <TD className="w-8 pr-0">
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                        aria-expanded={expanded === event.id}
                        aria-label={expanded === event.id ? 'Hide event details' : 'Show event details'}
                        onClick={(clickEvent) => {
                          clickEvent.stopPropagation();
                          setExpanded(expanded === event.id ? null : event.id);
                        }}
                      >
                        <ChevronRight className={cn('size-4 transition-transform duration-200', expanded === event.id && 'rotate-90')} />
                      </button>
                    </TD>
                    <TD className="whitespace-nowrap">
                      <div className="text-[13px] tabular-nums">{formatDateTime(event.createdAt)}</div>
                      <div className="text-[11px] text-subtle-foreground">{formatRelative(event.createdAt)}</div>
                    </TD>
                    <TD>
                      <div className="flex items-start gap-3">
                        <EventIcon action={event.action} className="mt-0.5" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{describeEvent(event)}</div>
                          <code className="mt-0.5 inline-block rounded bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">{event.action}</code>
                        </div>
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {event.actor?.name ? <span className="text-[13px]">{event.actor.name}</span> : <Badge tone="neutral">{event.actorType === 'ROBOT' ? 'UiPath robot' : event.actorType === 'SYSTEM' ? 'System' : 'Anonymous'}</Badge>}
                    </TD>
                    <TD className="hidden lg:table-cell">
                      {event.purchaseRequestId ? (
                        <Link href={`/requests/${event.purchaseRequestId}`} className="text-xs text-primary hover:underline" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                          {event.entityType}
                        </Link>
                      ) : (
                        <span className="text-xs">{event.entityType}</span>
                      )}
                    </TD>
                  </TR>
                  {expanded === event.id ? (
                    <TR className="bg-surface-tint hover:bg-surface-tint">
                      <TD colSpan={5} className="pt-0">
                        <ExpandOnMount>
                        <div className="space-y-2 py-1 pl-8">
                          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            <div className="flex gap-1.5"><dt className="text-muted-foreground">Correlation ID</dt><dd className="font-mono">{event.correlationId ?? '—'}</dd></div>
                            <div className="flex gap-1.5"><dt className="text-muted-foreground">IP</dt><dd className="font-mono">{event.ipAddress ?? '—'}</dd></div>
                            <div className="flex gap-1.5"><dt className="text-muted-foreground">Actor type</dt><dd>{event.actorType}</dd></div>
                          </dl>
                        <pre className="scrollbar-thin max-h-80 overflow-auto rounded-md border bg-card p-3 font-mono text-[11px] leading-relaxed">
                          {JSON.stringify(
                            { old: event.oldValue, new: event.newValue, metadata: event.metadata, correlationId: event.correlationId, ip: event.ipAddress },
                            null,
                            2,
                          )}
                        </pre>
                        </div>
                        </ExpandOnMount>
                      </TD>
                    </TR>
                  ) : null}
                </Fragment>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      {audit.data ? <Pager page={page} totalPages={audit.data.meta.totalPages} total={audit.data.meta.total} onChange={setPage} /> : null}
    </>
  );
}
