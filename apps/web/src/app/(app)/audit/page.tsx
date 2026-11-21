'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { Badge, Card, NativeSelect, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { describeEvent } from '@/lib/events';
import { formatDateTime } from '@/lib/format';
import type { AuditEvent, Paginated } from '@/lib/types';

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
      {audit.error ? <ErrorBlock error={audit.error} /> : null}
      {audit.isLoading ? <LoadingBlock rows={8} /> : null}
      {audit.data?.data.length === 0 ? <EmptyState title="No audit events" /> : null}
      {audit.data?.data.length ? (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Event</TH>
                <TH className="hidden md:table-cell">Actor</TH>
                <TH className="hidden lg:table-cell">Entity</TH>
              </TR>
            </THead>
            <TBody>
              {audit.data.data.map((event) => (
                <Fragment key={event.id}>
                  <TR className="cursor-pointer" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                    <TD className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</TD>
                    <TD>
                      <div className="text-sm">{describeEvent(event)}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{event.action}</div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {event.actor?.name ?? <Badge tone="neutral">{event.actorType === 'ROBOT' ? 'UiPath robot' : event.actorType === 'SYSTEM' ? 'System' : 'Anonymous'}</Badge>}
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
                    <TR className="bg-muted/30 hover:bg-muted/30">
                      <TD colSpan={4}>
                        <pre className="overflow-auto text-[11px] leading-relaxed">
                          {JSON.stringify(
                            { old: event.oldValue, new: event.newValue, metadata: event.metadata, correlationId: event.correlationId, ip: event.ipAddress },
                            null,
                            2,
                          )}
                        </pre>
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
