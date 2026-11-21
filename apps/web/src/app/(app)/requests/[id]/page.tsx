'use client';

import { APPROVAL_GROUP_LABELS, Permission } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Check, Clock3, ExternalLink, FileText, Loader2, Minus, PackageCheck, RefreshCw, Rocket, X } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EventIcon } from '@/components/event-icon';
import { EmptyState, ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { DecisionButtons, ReasonDialog, RetryButton } from '@/components/requests/action-dialogs';
import { ProgressSteps } from '@/components/requests/progress-steps';
import { RuleFindings } from '@/components/requests/rule-findings';
import { useSuppliers, VerificationForm } from '@/components/requests/verification-form';
import { ConfidenceBadge, DecisionBadge, DocumentStatusBadge, JobStatusBadge, RequestStatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeEvent } from '@/lib/events';
import { formatBytes, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import type { AuditEvent, DocumentView, PurchaseRequestDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

const ACTIVE_STATUSES = new Set(['SUBMITTED', 'PROCESSING_DOCUMENT', 'APPROVED', 'QUEUED', 'RUNNING']);

function DocumentCard({ document, threshold, onReprocess, canReprocess }: { document: DocumentView; threshold: number; onReprocess: () => void; canReprocess: boolean }) {
  const extraction = document.extraction;
  const fields = extraction
    ? ([
        ['Supplier', extraction.fields.supplierName],
        ['Invoice number', extraction.fields.documentNumber],
        ['Invoice date', extraction.fields.documentDate],
        ['Currency', extraction.fields.currency],
        ['Subtotal', extraction.fields.subtotal],
        ['Tax', extraction.fields.taxAmount],
        ['Total', extraction.fields.totalAmount],
      ] as const)
    : [];
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 truncate">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{document.fileName}</span>
          </CardTitle>
          <CardDescription>
            {formatBytes(document.sizeBytes)} · uploaded by {document.uploadedBy.name} · {formatDateTime(document.createdAt)}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DocumentStatusBadge status={document.processingStatus} />
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/v1/documents/${document.id}/file`} target="_blank" rel="noreferrer">
              <ExternalLink /> Open
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {document.processingStatus === 'QUEUED' || document.processingStatus === 'PROCESSING' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Document intelligence is reading the document…
          </p>
        ) : null}
        {extraction ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Overall confidence <ConfidenceBadge value={extraction.overallConfidence} threshold={threshold} /> · method {extraction.extractionMethod}
              {extraction.pageCount ? ` · ${extraction.pageCount} page(s)` : ''}
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Field</TH>
                  <TH>Extracted value</TH>
                  <TH className="text-right">Confidence</TH>
                </TR>
              </THead>
              <TBody>
                {fields.map(([label, field]) => (
                  <TR key={label}>
                    <TD className="text-muted-foreground">{label}</TD>
                    <TD className="font-medium">{field.value === null ? <span className="text-muted-foreground">not found</span> : String(field.value)}</TD>
                    <TD className="text-right">
                      <ConfidenceBadge value={field.value === null ? 0 : field.confidence} threshold={threshold} />
                    </TD>
                  </TR>
                ))}
                <TR>
                  <TD className="text-muted-foreground">Line items</TD>
                  <TD className="font-medium">{extraction.items.length} line(s)</TD>
                  <TD className="text-right">
                    <ConfidenceBadge
                      value={extraction.items.length ? Math.min(...extraction.items.map((item) => item.confidence)) : 0}
                      threshold={threshold}
                    />
                  </TD>
                </TR>
              </TBody>
            </Table>
          </>
        ) : null}
        {document.processingError ? <Alert tone="warning">Extraction failed: {document.processingError}</Alert> : null}
        {canReprocess && document.processingStatus !== 'QUEUED' && document.processingStatus !== 'PROCESSING' ? (
          <Button variant="outline" size="sm" onClick={onReprocess}>
            <RefreshCw /> Run extraction again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const request = useQuery({
    queryKey: ['request', id],
    queryFn: () => api<PurchaseRequestDetail>(`/purchase-requests/${id}`),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      const jobActive = data.automationJob && ['QUEUED', 'SUBMITTING', 'PENDING', 'RUNNING'].includes(data.automationJob.status);
      return ACTIVE_STATUSES.has(data.status) || jobActive ? 2_000 : 15_000;
    },
  });
  const timeline = useQuery({
    queryKey: ['request', id, 'timeline', request.data?.updatedAt],
    queryFn: () => api<AuditEvent[]>(`/purchase-requests/${id}/timeline`),
    enabled: !!request.data,
  });
  const suppliers = useSuppliers();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['request', id] });
  const [tab, setTab] = useState<string | null>(null);
  const canVerify = request.data?.allowedActions.verify ?? false;
  // Jump to the verification form as soon as document intelligence has finished.
  useEffect(() => {
    if (canVerify) setTab('document');
  }, [canVerify]);

  const reprocess = useMutation({
    mutationFn: (documentId: string) => api(`/documents/${documentId}/process`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Extraction restarted');
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const dispatch = useMutation({
    mutationFn: () => api('/automation/jobs', { body: { purchaseRequestId: id } }),
    onSuccess: () => {
      toast.success('Dispatched to UiPath');
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (request.error) return <ErrorBlock error={request.error} />;
  if (!request.data) return <LoadingBlock rows={8} />;
  const pr = request.data;
  const actions = pr.allowedActions;
  const threshold = pr.documentSettings?.confidenceThreshold ?? 0.85;
  const verifiable = pr.documents.find((document) => ['COMPLETED', 'FAILED', 'UPLOADED'].includes(document.processingStatus));
  const job = pr.automationJob;
  const defaultTab = actions.verify ? 'document' : pr.status === 'PENDING_APPROVAL' ? 'approvals' : job ? 'automation' : 'overview';

  return (
    <>
      <Link href="/requests" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Purchase requests
      </Link>
      <PageHeader
        icon={FileText}
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="font-mono" data-testid="request-number">{pr.requestNumber}</span>
            <RequestStatusBadge status={pr.status} />
          </span>
        }
        title={pr.title}
        description={`${pr.requester.name} · ${pr.department.name} · workflow ${pr.workflow.name} v${pr.workflow.version}`}
        actions={
          <>
            {actions.approvalId ? <DecisionButtons approvalId={actions.approvalId} requestId={pr.id} requestNumber={pr.requestNumber} /> : null}
            {actions.dispatchAutomation ? (
              <Button onClick={() => dispatch.mutate()} disabled={dispatch.isPending}>
                <Rocket /> Dispatch to UiPath
              </Button>
            ) : null}
            {actions.retryAutomation && job ? <RetryButton jobId={job.id} onDone={refresh} /> : null}
            {actions.cancel ? (
              <ReasonDialog
                trigger={<Button variant="outline">Cancel request</Button>}
                title={`Cancel ${pr.requestNumber}`}
                description="The request is withdrawn and will not be processed further."
                label="Reason"
                required
                destructive
                confirmLabel="Cancel request"
                onConfirm={async (reason) => {
                  await api(`/purchase-requests/${pr.id}/cancel`, { body: { reason } });
                  toast.success('Request cancelled');
                  await refresh();
                }}
              />
            ) : null}
          </>
        }
      />

      <Card className="mb-4 px-4 py-3">
        <ProgressSteps status={pr.status} />
      </Card>

      {pr.status === 'COMPLETED' && pr.poNumber ? (
        <Alert tone="success" className="mb-4">
          <PackageCheck className="size-4" />
          <div>
            Purchase order <span className="font-mono font-semibold" data-testid="po-number">{pr.poNumber}</span> was created in the ERP by the UiPath robot
            {pr.completedAt ? ` on ${formatDateTime(pr.completedAt)}` : ''}.
          </div>
        </Alert>
      ) : null}
      {pr.statusReason && ['REJECTED', 'CANCELLED', 'FAILED', 'NEEDS_VERIFICATION'].includes(pr.status) ? (
        <Alert tone={pr.status === 'NEEDS_VERIFICATION' ? 'warning' : 'danger'} className="mb-4">
          {pr.status === 'REJECTED' ? 'Rejected: ' : pr.status === 'CANCELLED' ? 'Cancelled: ' : pr.status === 'FAILED' ? 'Automation failed: ' : ''}
          {pr.statusReason}
        </Alert>
      ) : null}
      {actions.verify ? (
        <Alert tone="warning" className="mb-4">
          Document intelligence finished. Check the extracted data in the <strong>Document</strong> tab and send the request for approval.
        </Alert>
      ) : null}

      <Tabs value={tab ?? defaultTab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="document">Document{actions.verify ? ' •' : ''}</TabsTrigger>
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="automation">Automation</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-5 md:grid-cols-4">
              <KeyValue label="Supplier">{pr.supplier?.name ?? pr.supplierName ?? '—'}</KeyValue>
              <KeyValue label="Supplier code">{pr.supplier?.code ?? '—'}</KeyValue>
              <KeyValue label="Invoice number">{pr.documentNumber ?? '—'}</KeyValue>
              <KeyValue label="Invoice date">{formatDate(pr.documentDate)}</KeyValue>
              <KeyValue label="Required by">{formatDate(pr.requiredDate)}</KeyValue>
              <KeyValue label="Total">{formatMoney(pr.totalAmount, pr.currency)}</KeyValue>
              <KeyValue label="Approval route">{pr.approvalRoute.length ? pr.approvalRoute.map((group) => APPROVAL_GROUP_LABELS[group]).join(' → ') : '—'}</KeyValue>
              <KeyValue label="PO number">{pr.poNumber ?? '—'}</KeyValue>
            </CardContent>
          </Card>
          {pr.description ? (
            <Card>
              <CardContent className="pt-5 text-sm whitespace-pre-wrap">{pr.description}</CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              {pr.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Items are taken from the verified document.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>#</TH>
                      <TH>Description</TH>
                      <TH className="text-right">Qty</TH>
                      <TH className="text-right">Unit price</TH>
                      <TH className="text-right">Line total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {pr.items.map((item) => (
                      <TR key={item.id}>
                        <TD>{item.lineNo}</TD>
                        <TD>{item.description}</TD>
                        <TD className="text-right tabular-nums">{item.quantity}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(item.unitPrice, pr.currency)}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(item.lineTotal, pr.currency)}</TD>
                      </TR>
                    ))}
                    <TR>
                      <TD colSpan={4} className="text-right text-muted-foreground">Subtotal</TD>
                      <TD className="text-right tabular-nums">{formatMoney(pr.subtotalAmount, pr.currency)}</TD>
                    </TR>
                    <TR>
                      <TD colSpan={4} className="text-right text-muted-foreground">Tax</TD>
                      <TD className="text-right tabular-nums">{formatMoney(pr.taxAmount, pr.currency)}</TD>
                    </TR>
                    <TR>
                      <TD colSpan={4} className="text-right font-semibold">Total</TD>
                      <TD className="text-right font-semibold tabular-nums">{formatMoney(pr.totalAmount, pr.currency)}</TD>
                    </TR>
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
          {pr.ruleEvaluation ? <RuleFindings evaluation={pr.ruleEvaluation} /> : null}
        </TabsContent>

        <TabsContent value="document" className="space-y-4">
          {pr.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents uploaded.</p> : null}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="space-y-4">
              {pr.documents.map((document) => (
                <DocumentCard
                  key={document.id}
                  document={document}
                  threshold={threshold}
                  canReprocess={actions.reprocessDocument}
                  onReprocess={() => reprocess.mutate(document.id)}
                />
              ))}
            </div>
            {actions.verify && verifiable && suppliers.data ? (
              <VerificationForm key={`${verifiable.id}-${verifiable.processedAt}`} request={pr} document={verifiable} suppliers={suppliers.data} />
            ) : null}
          </div>
        </TabsContent>

        <TabsContent value="approvals">
          <Card>
            <CardContent className="pt-5">
              {pr.approvals.length === 0 ? (
                <p className="text-sm text-muted-foreground">The approval route is decided by the business rules after verification.</p>
              ) : (
                <ol className="space-y-3">
                  {pr.approvals.map((approval, index) => (
                    <li key={approval.id} className="relative flex animate-fade-up gap-3" style={{ animationDelay: `${index * 90}ms` }}>
                      {index < pr.approvals.length - 1 ? <span aria-hidden className="absolute top-9 -bottom-3 left-[15px] w-px bg-border" /> : null}
                      <span
                        aria-hidden
                        className={cn(
                          'relative mt-2 flex size-8 shrink-0 items-center justify-center rounded-full border',
                          approval.decision === 'APPROVED' && 'border-success-border bg-success-soft text-success-foreground',
                          approval.decision === 'REJECTED' && 'border-destructive-border bg-destructive-soft text-destructive-foreground',
                          approval.decision === 'PENDING' && (approval.activatedAt ? 'border-warning-border bg-warning-soft text-warning-foreground' : 'bg-card text-subtle-foreground'),
                          approval.decision === 'SKIPPED' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {approval.decision === 'APPROVED' ? <Check className="size-4" /> : approval.decision === 'REJECTED' ? <X className="size-4" /> : approval.decision === 'SKIPPED' ? <Minus className="size-4" /> : approval.activatedAt ? <Clock3 className="size-4" /> : <span className="text-xs font-semibold">{approval.approvalLevel}</span>}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          Level {approval.approvalLevel} · {APPROVAL_GROUP_LABELS[approval.approverGroup]}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {approval.department?.name ?? '—'}
                          {approval.approver ? ` · decided by ${approval.approver.name} on ${formatDateTime(approval.decidedAt)}` : approval.activatedAt ? ' · waiting for decision' : ' · not yet active'}
                        </p>
                        {approval.comments ? <p className="mt-1 text-sm">“{approval.comments}”</p> : null}
                      </div>
                      <DecisionBadge decision={approval.decision} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="automation">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4" /> UiPath automation
              </CardTitle>
              {job && can(Permission.AUTOMATION_READ) ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/automation/${job.id}`}>Job details</Link>
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {!job ? (
                <p className="text-sm text-muted-foreground">The automation job is created when the request is fully approved.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    <KeyValue label="Status"><JobStatusBadge status={job.status} /></KeyValue>
                    <KeyValue label="Attempts">{job.attemptCount} / {job.maxTotalAttempts}</KeyValue>
                    <KeyValue label="UiPath job">{job.uipathJobId ?? '—'}</KeyValue>
                    <KeyValue label="PO number">{job.poNumber ?? '—'}</KeyValue>
                    <KeyValue label="Queued">{formatDateTime(job.queuedAt)}</KeyValue>
                    <KeyValue label="Started">{formatDateTime(job.startedAt)}</KeyValue>
                    <KeyValue label="Completed">{formatDateTime(job.completedAt)}</KeyValue>
                    <KeyValue label="Idempotency key"><span className="font-mono text-xs">{job.idempotencyKey}</span></KeyValue>
                  </div>
                  {job.errorMessage && job.status !== 'COMPLETED' ? (
                    <Alert tone={job.status === 'FAILED' ? 'danger' : 'warning'}>
                      <span className="font-mono text-xs">{job.errorCode}</span> {job.errorMessage}
                      {job.requiresIntervention ? ' — retry limit reached, manual intervention required.' : ''}
                    </Alert>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-5">
              {timeline.isLoading ? <LoadingBlock rows={4} /> : null}
              {timeline.data && timeline.data.length === 0 ? <EmptyState compact icon={FileText} title="No events yet" description="Every step of this request is recorded here." /> : null}
              <ol className="stagger">
                {timeline.data?.map((event, index) => (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < timeline.data!.length - 1 ? <span aria-hidden className="absolute top-8 bottom-0.5 left-[13.5px] w-px bg-gradient-to-b from-border to-transparent" /> : null}
                    <EventIcon action={event.action} className="relative mt-0.5" />
                    <div className="min-w-0">
                    <p className="text-sm">{describeEvent(event)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)} · {event.actor?.name ?? (event.actorType === 'ROBOT' ? 'UiPath robot' : 'System')}
                      {typeof event.metadata?.reason === 'string' ? ` · “${event.metadata.reason}”` : ''}
                    </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
