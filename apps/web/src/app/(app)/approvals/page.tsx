'use client';

import { APPROVAL_GROUP_LABELS } from '@orchestra/domain';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { DecisionButtons } from '@/components/requests/action-dialogs';
import { DecisionBadge } from '@/components/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Badge, Card, CardContent, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, formatMoney, formatRelative } from '@/lib/format';
import type { Paginated, PendingApproval } from '@/lib/types';

interface DecidedApproval {
  id: string;
  approvalLevel: number;
  approverGroup: keyof typeof APPROVAL_GROUP_LABELS;
  decision: 'APPROVED' | 'REJECTED';
  comments: string | null;
  decidedAt: string;
  purchaseRequest: { id: string; requestNumber: string; title: string; status: string; currency: string; totalAmount: number };
}

export default function ApprovalsPage() {
  const [page, setPage] = useState(1);
  const pending = useQuery({ queryKey: ['approvals', 'pending'], queryFn: () => api<PendingApproval[]>('/approvals/pending'), refetchInterval: 10_000 });
  const decided = useQuery({
    queryKey: ['approvals', 'decided', page],
    queryFn: () => api<Paginated<DecidedApproval>>('/approvals/decided', { query: { page, pageSize: 15 } }),
  });

  return (
    <>
      <PageHeader title="Approvals" description="Requests waiting for your decision. Levels are decided in order; you cannot approve your own requests." />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Waiting for me {pending.data?.length ? <Badge tone="warning">{pending.data.length}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="decided">My decisions</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          {pending.error ? <ErrorBlock error={pending.error} /> : null}
          {pending.isLoading ? <LoadingBlock rows={4} /> : null}
          {pending.data?.length === 0 ? <EmptyState title="Nothing to approve" description="New approval requests will appear here and in your notifications." /> : null}
          <div className="grid gap-3">
            {pending.data?.map((approval) => (
              <Card key={approval.id} data-testid="pending-approval">
                <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/requests/${approval.purchaseRequest.id}`} className="font-mono text-sm font-medium hover:underline">
                        {approval.purchaseRequest.requestNumber}
                      </Link>
                      <Badge tone="primary">
                        Level {approval.approvalLevel}/{approval.purchaseRequest.levels} · {APPROVAL_GROUP_LABELS[approval.approverGroup]}
                      </Badge>
                      {approval.purchaseRequest.warningCount ? (
                        <Badge tone="warning">
                          <TriangleAlert /> {approval.purchaseRequest.warningCount} warning(s)
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate font-medium">{approval.purchaseRequest.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {approval.purchaseRequest.requester.name} · {approval.purchaseRequest.department.name} · {approval.purchaseRequest.supplierName ?? '—'} · needed{' '}
                      {formatDate(approval.purchaseRequest.requiredDate)} · waiting {formatRelative(approval.activatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <span className="text-lg font-semibold tabular-nums">{formatMoney(approval.purchaseRequest.totalAmount, approval.purchaseRequest.currency)}</span>
                    <div className="flex gap-2">
                      <DecisionButtons approvalId={approval.id} requestId={approval.purchaseRequest.id} requestNumber={approval.purchaseRequest.requestNumber} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="decided">
          {decided.isLoading ? <LoadingBlock rows={4} /> : null}
          {decided.data?.data.length === 0 ? <EmptyState title="No decisions yet" /> : null}
          {decided.data?.data.length ? (
            <Card>
              <Table>
                <THead>
                  <TR>
                    <TH>Request</TH>
                    <TH>Level</TH>
                    <TH>Decision</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="hidden md:table-cell">Comment</TH>
                    <TH>Decided</TH>
                  </TR>
                </THead>
                <TBody>
                  {decided.data.data.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Link href={`/requests/${row.purchaseRequest.id}`} className="font-mono hover:underline">
                          {row.purchaseRequest.requestNumber}
                        </Link>
                        <div className="max-w-56 truncate text-xs text-muted-foreground">{row.purchaseRequest.title}</div>
                      </TD>
                      <TD>{row.approvalLevel}</TD>
                      <TD><DecisionBadge decision={row.decision} /></TD>
                      <TD className="text-right tabular-nums">{formatMoney(row.purchaseRequest.totalAmount, row.purchaseRequest.currency)}</TD>
                      <TD className="hidden max-w-64 truncate md:table-cell">{row.comments ?? '—'}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.decidedAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          ) : null}
          {decided.data ? <Pager page={page} totalPages={decided.data.meta.totalPages} total={decided.data.meta.total} onChange={setPage} /> : null}
        </TabsContent>
      </Tabs>
    </>
  );
}
