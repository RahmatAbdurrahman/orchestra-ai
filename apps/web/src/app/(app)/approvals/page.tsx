'use client';

import { APPROVAL_GROUP_LABELS } from '@orchestra/domain';
import { useQuery } from '@tanstack/react-query';
import { Check, CheckCheck, CheckSquare, History, TriangleAlert } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface DecidedApproval {
  id: string;
  approvalLevel: number;
  approverGroup: keyof typeof APPROVAL_GROUP_LABELS;
  decision: 'APPROVED' | 'REJECTED';
  comments: string | null;
  decidedAt: string;
  purchaseRequest: { id: string; requestNumber: string; title: string; status: string; currency: string; totalAmount: number };
}

/**
 * Where this decision sits in the ordered approval chain. Levels are decided strictly in order, so
 * every level before the one waiting here has been approved (presentation of the existing rule).
 */
function ApprovalLevels({ level, levels, group }: { level: number; levels: number; group: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ol className="flex items-center" aria-label={`Approval level ${level} of ${levels}`}>
        {Array.from({ length: levels }, (_, index) => {
          const step = index + 1;
          const state = step < level ? 'done' : step === level ? 'current' : 'upcoming';
          return (
            <li key={step} className="flex items-center">
              {index > 0 ? (
                <span aria-hidden className="relative mx-1 h-0.5 w-7 overflow-hidden rounded-full bg-border">
                  {step <= level ? (
                    <span className="absolute inset-0 origin-left animate-grow-x rounded-full bg-primary/50" style={{ animationDelay: `${index * 140}ms` }} />
                  ) : null}
                </span>
              ) : null}
              <span
                className={cn(
                  'flex size-6 animate-fade-in items-center justify-center rounded-full border text-[11px] font-semibold',
                  state === 'done' && 'border-success bg-success text-white',
                  state === 'current' && 'border-warning-border bg-warning-soft text-warning-foreground ring-4 ring-warning/10',
                  state === 'upcoming' && 'bg-card text-muted-foreground',
                )}
                style={{ animationDelay: `${index * 140}ms` }}
              >
                {state === 'done' ? <Check className="size-3" aria-hidden /> : step}
                <span className="sr-only">
                  {state === 'done' ? `Level ${step} approved` : state === 'current' ? `Level ${step} waiting for you` : `Level ${step} later`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <span className="text-xs font-medium text-muted-foreground">
        Level {level} of {levels} · {group}
      </span>
    </div>
  );
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
      <PageHeader icon={CheckSquare} title="Approvals" description="Requests waiting for your decision. Levels are decided in order; you cannot approve your own requests." />
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Waiting for me {pending.data?.length ? <Badge tone="warning" className="tabular-nums">{pending.data.length}</Badge> : null}</TabsTrigger>
          <TabsTrigger value="decided">My decisions</TabsTrigger>
        </TabsList>
        <TabsContent value="pending">
          {pending.error ? <ErrorBlock error={pending.error} onRetry={() => void pending.refetch()} /> : null}
          {pending.isLoading ? <LoadingBlock rows={4} label="Loading approvals" /> : null}
          {pending.data?.length === 0 ? (
            <EmptyState mascot="success" icon={CheckCheck} tone="success" title="You're all caught up" description="Nothing is waiting for your decision. New approval requests will appear here and in your notifications." />
          ) : null}
          <div className="stagger grid gap-3">
            {pending.data?.map((approval) => (
              <Card key={approval.id} data-testid="pending-approval" interactive className="relative overflow-hidden">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-warning/80 via-warning/40 to-transparent" />
                <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <ApprovalLevels level={approval.approvalLevel} levels={approval.purchaseRequest.levels} group={APPROVAL_GROUP_LABELS[approval.approverGroup]} />
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/requests/${approval.purchaseRequest.id}`} className="font-mono text-[13px] font-semibold hover:text-primary hover:underline">
                        {approval.purchaseRequest.requestNumber}
                      </Link>
                      {approval.purchaseRequest.warningCount ? (
                        <Badge tone="warning">
                          <TriangleAlert /> {approval.purchaseRequest.warningCount} warning(s)
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate font-semibold tracking-tight">{approval.purchaseRequest.title}</p>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                      <div className="flex gap-1"><dt className="sr-only">Requester</dt><dd className="text-foreground">{approval.purchaseRequest.requester.name}</dd><span aria-hidden>·</span><dd>{approval.purchaseRequest.department.name}</dd></div>
                      <div className="flex gap-1"><dt>Supplier</dt><dd className="text-foreground">{approval.purchaseRequest.supplierName ?? '—'}</dd></div>
                      <div className="flex gap-1"><dt>Needed</dt><dd className="text-foreground">{formatDate(approval.purchaseRequest.requiredDate)}</dd></div>
                      <div className="flex gap-1"><dt>Waiting</dt><dd className="text-foreground">{formatRelative(approval.activatedAt)}</dd></div>
                    </dl>
                  </div>
                  <div className="flex flex-col items-start gap-2 border-t pt-4 lg:items-end lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                    <span className="text-xs text-muted-foreground">Total amount</span>
                    <span className="-mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{formatMoney(approval.purchaseRequest.totalAmount, approval.purchaseRequest.currency)}</span>
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
          {decided.error ? <ErrorBlock error={decided.error} onRetry={() => void decided.refetch()} /> : null}
          {decided.isLoading ? <LoadingBlock rows={4} /> : null}
          {decided.data?.data.length === 0 ? <EmptyState mascot="approval" icon={History} title="No decisions yet" description="Requests you approve or reject are listed here with your comments." /> : null}
          {decided.data?.data.length ? (
            <Card className="overflow-hidden">
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
                        <Link href={`/requests/${row.purchaseRequest.id}`} className="font-mono text-[13px] font-semibold hover:text-primary hover:underline">
                          {row.purchaseRequest.requestNumber}
                        </Link>
                        <div className="max-w-56 truncate text-xs text-muted-foreground">{row.purchaseRequest.title}</div>
                      </TD>
                      <TD className="tabular-nums">Level {row.approvalLevel}</TD>
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
