'use client';

import { Permission, PURCHASE_REQUEST_STATUS_LABELS, PURCHASE_REQUEST_STATUSES } from '@orchestra/domain';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Plus, SearchX, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, ErrorBlock, FetchingBar, LoadingBlock, PageHeader, Pager, Toolbar } from '@/components/page';
import { StageMeter } from '@/components/requests/progress-steps';
import { RequestStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, NativeSelect, SearchInput, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMoney, formatRelative } from '@/lib/format';
import type { Paginated, PurchaseRequestRow } from '@/lib/types';
import { cn } from '@/lib/utils';

export default function RequestsPage() {
  const { can } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const requests = useQuery({
    queryKey: ['requests', page, status, query],
    queryFn: () =>
      api<Paginated<PurchaseRequestRow>>('/purchase-requests', { query: { page, pageSize: 15, status, search: query } }),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000,
  });

  return (
    <>
      <PageHeader
        icon={FileText}
        title="Purchase requests"
        description="Track every request from draft to purchase order."
        actions={
          can(Permission.REQUESTS_CREATE) ? (
            <Button asChild>
              <Link href="/requests/new">
                <Plus /> New request
              </Link>
            </Button>
          ) : null
        }
      />
      <Toolbar>
        <form
          className="flex-1"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search request number, title or supplier — press Enter"
            aria-label="Search requests"
          />
        </form>
        <NativeSelect
          value={status}
          onChange={(event) => {
            setPage(1);
            setStatus(event.target.value);
          }}
          className="sm:w-56"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {PURCHASE_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {PURCHASE_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
        {query || status ? (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch('');
              setQuery('');
              setStatus('');
              setPage(1);
            }}
          >
            <X /> Clear filters
          </Button>
        ) : null}
      </Toolbar>

      {requests.error ? <ErrorBlock error={requests.error} onRetry={() => void requests.refetch()} /> : null}
      {requests.isLoading ? <LoadingBlock rows={6} label="Loading purchase requests" /> : null}
      {requests.data && requests.data.data.length === 0 ? (
        <EmptyState
          icon={query || status ? SearchX : FileText}
          title={query || status ? 'No matching purchase requests' : 'No purchase requests yet'}
          description={
            query || status
              ? `Nothing matches${query ? ` “${query}”` : ''}${status ? ` with status ${PURCHASE_REQUEST_STATUS_LABELS[status as keyof typeof PURCHASE_REQUEST_STATUS_LABELS]}` : ''}. Try a different search or clear the filters.`
              : 'Requests you are allowed to see will appear here as they are created.'
          }
          action={
            !query && !status && can(Permission.REQUESTS_CREATE) ? (
              <Button asChild size="sm">
                <Link href="/requests/new">
                  <Plus /> Create the first request
                </Link>
              </Button>
            ) : null
          }
        />
      ) : null}
      {requests.data && requests.data.data.length > 0 ? (
        <Card className="relative overflow-hidden">
          <FetchingBar active={requests.isFetching && requests.isPlaceholderData} />
          <Table className={cn('transition-opacity duration-200', requests.isPlaceholderData && 'opacity-60')}>
            <THead>
              <TR>
                <TH>Request</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Supplier</TH>
                <TH className="text-right">Total</TH>
                <TH className="hidden lg:table-cell">Requester</TH>
                <TH className="hidden lg:table-cell">Required</TH>
                <TH className="hidden sm:table-cell">Updated</TH>
              </TR>
            </THead>
            <TBody>
              {requests.data.data.map((row) => (
                <TR key={row.id} className="group cursor-pointer" onClick={() => router.push(`/requests/${row.id}`)}>
                  <TD>
                    <Link href={`/requests/${row.id}`} className="font-mono text-[13px] font-semibold transition-colors group-hover:text-primary hover:underline" onClick={(event) => event.stopPropagation()}>
                      {row.requestNumber}
                    </Link>
                    <div className="max-w-64 truncate text-xs text-muted-foreground">{row.title}</div>
                  </TD>
                  <TD>
                    <RequestStatusBadge status={row.status} />
                    <StageMeter status={row.status} className="mt-1.5" />
                    {row.poNumber ? <div className="mt-1 font-mono text-[11px] text-success-foreground">{row.poNumber}</div> : null}
                  </TD>
                  <TD className="hidden max-w-48 truncate md:table-cell">{row.supplierName ?? '—'}</TD>
                  <TD className="text-right tabular-nums">{row.totalAmount ? formatMoney(row.totalAmount, row.currency) : '—'}</TD>
                  <TD className="hidden lg:table-cell">
                    {row.requester.name}
                    <div className="text-xs text-muted-foreground">{row.department.name}</div>
                  </TD>
                  <TD className="hidden lg:table-cell">{formatDate(row.requiredDate)}</TD>
                  <TD className="hidden text-muted-foreground sm:table-cell">{formatRelative(row.updatedAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      {requests.data ? (
        <Pager page={page} totalPages={requests.data.meta.totalPages} total={requests.data.meta.total} onChange={setPage} />
      ) : null}
    </>
  );
}
