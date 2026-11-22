'use client';

import { PURCHASE_REQUEST_STATUS_LABELS, Permission, type PurchaseRequestStatus } from '@orchestra/domain';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, BarChart3, Bot, CheckCircle2, Clock, FileText, Gauge, Hourglass, LayoutDashboard, Plus, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Orbi } from '@/components/brand';
import { EventIcon } from '@/components/event-icon';
import { MOTION } from '@/components/motion';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, SectionLabel, StatCard } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeEvent } from '@/lib/events';
import { formatDateTime, formatDuration, formatPercent, formatRelative } from '@/lib/format';
import type { AuditEvent, AutomationMetrics, DashboardSummary } from '@/lib/types';

const PERIODS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const STATUS_ORDER: PurchaseRequestStatus[] = [
  'DRAFT',
  'PROCESSING_DOCUMENT',
  'NEEDS_VERIFICATION',
  'PENDING_APPROVAL',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'CANCELLED',
];

const STATUS_BAR: Partial<Record<PurchaseRequestStatus, string>> = {
  COMPLETED: 'bg-success',
  FAILED: 'bg-destructive',
  REJECTED: 'bg-destructive/70',
  NEEDS_VERIFICATION: 'bg-warning',
  PENDING_APPROVAL: 'bg-warning',
  CANCELLED: 'bg-border-strong',
  DRAFT: 'bg-border-strong',
};

const TOOLTIP_STYLE = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  boxShadow: 'var(--shadow-md)',
  color: 'var(--popover-foreground)',
};

function actorLabel(event: AuditEvent): string {
  return event.actor?.name ?? (event.actorType === 'ROBOT' ? 'UiPath robot' : 'System');
}

export default function DashboardPage() {
  const { user, can, canAny } = useAuth();
  const canReadAudit = canAny(Permission.AUDIT_READ_ALL, Permission.AUDIT_READ_OWN, Permission.AUDIT_READ_RELEVANT, Permission.AUDIT_READ_OPERATIONAL);
  const [days, setDays] = useState(30);
  const summary = useQuery({
    queryKey: ['dashboard', 'summary', days],
    queryFn: () => api<DashboardSummary>('/dashboard/summary', { query: { days } }),
    refetchInterval: 15_000,
  });
  const metrics = useQuery({
    queryKey: ['dashboard', 'metrics', days],
    queryFn: () => api<AutomationMetrics>('/dashboard/automation-metrics', { query: { days } }),
    refetchInterval: 30_000,
  });
  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api<AuditEvent[]>('/dashboard/recent-activities', { query: { limit: 8 } }),
    refetchInterval: 15_000,
  });

  const totals = summary.data?.totals;
  const scopeLabel = !summary.data
    ? 'Loading'
    : summary.data.scope === 'OWN'
      ? 'Your requests'
      : summary.data.scope === 'ASSIGNED'
        ? 'Requests assigned to you'
        : summary.data.scope === 'OWN_AND_ASSIGNED'
          ? 'Your and assigned requests'
          : 'All requests';
  const statusMax = Math.max(1, ...Object.values(summary.data?.requestsByStatus ?? {}).map((value) => value ?? 0));
  const chartData = (metrics.data?.daily ?? []).map((day) => ({ ...day, label: day.date.slice(5) }));
  const hasOutcomes = chartData.some((day) => day.completed > 0 || day.failed > 0);
  const statuses = STATUS_ORDER.filter((status) => summary.data?.requestsByStatus[status]);
  const periodLabel = PERIODS.find((period) => period.value === days)?.label.toLowerCase() ?? `last ${days} days`;

  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        leading={<Orbi expression="greeting" size={60} className="-my-2" />}
        eyebrow={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={`${scopeLabel} · automation overview for the ${periodLabel}`}
        actions={
          <>
            <NativeSelect value={days} onChange={(event) => setDays(Number(event.target.value))} className="w-40" aria-label="Period">
              {PERIODS.map((period) => (
                <option key={period.value} value={period.value}>
                  {period.label}
                </option>
              ))}
            </NativeSelect>
            {can(Permission.REQUESTS_CREATE) ? (
              <Button asChild>
                <Link href="/requests/new">
                  <Plus /> New request
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {summary.error ? <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} /> : null}
      {!totals && !summary.error ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-[106px] rounded-xl" />
          ))}
        </div>
      ) : null}
      {totals ? (
        <div className="space-y-5">
          <section aria-labelledby="kpi-pipeline">
            <SectionLabel>
              <span id="kpi-pipeline">Request pipeline</span>
            </SectionLabel>
            <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatCard label="Requests" testId="kpi-requests" value={totals.requests} hint="Created in the selected period" icon={FileText} />
              <StatCard
                label="Pending approvals"
                testId="kpi-pending-approvals"
                value={totals.pendingApprovals}
                hint={can(Permission.APPROVALS_DECIDE) ? 'Waiting for you' : 'In approval'}
                icon={Hourglass}
                tone="warning"
              />
              <StatCard label="Running jobs" testId="kpi-running-jobs" value={totals.runningJobs} hint="Queued or executing in UiPath" icon={Bot} />
              <StatCard label="Active workflows" testId="kpi-active-workflows" value={totals.activeWorkflows} hint="Templates accepting requests" icon={Workflow} />
            </div>
          </section>
          <section aria-labelledby="kpi-automation">
            <SectionLabel>
              <span id="kpi-automation">Automation outcomes</span>
            </SectionLabel>
            <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <StatCard
                label="Success rate"
                testId="kpi-success-rate"
                value={totals.successRate}
                format={(value) => formatPercent(value)}
                hint={`${totals.completedJobs} completed · ${totals.failedJobs} failed`}
                unavailableHint="No finished jobs in this period"
                icon={Gauge}
                tone={totals.successRate === null || totals.successRate >= 0.95 ? 'success' : 'danger'}
              />
              <StatCard
                label="Successful executions"
                testId="kpi-successful-executions"
                value={totals.completedJobs}
                hint="Purchase orders created"
                icon={CheckCircle2}
                tone="success"
              />
              <StatCard
                label="Failed executions"
                testId="kpi-failed-executions"
                value={totals.failedJobs}
                hint={`${totals.jobsNeedingAttention} currently failed`}
                icon={AlertTriangle}
                tone="danger"
              />
              <StatCard
                label="Avg. execution time"
                testId="kpi-avg.-execution-time"
                value={totals.avgExecutionSeconds}
                format={(value) => formatDuration(value)}
                hint="Robot start to finish"
                unavailableHint="No completed executions yet"
                icon={Clock}
              />
            </div>
          </section>
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="relative min-w-0 overflow-hidden lg:col-span-2">
          <div aria-hidden className="decor-wash pointer-events-none absolute inset-0" />
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" aria-hidden /> Automation outcomes
            </CardTitle>
            <CardDescription>
              Jobs per day by final status
              {metrics.data
                ? ` · ${metrics.data.attempts.total} UiPath submissions, ${metrics.data.attempts.automaticRetries} automatic and ${metrics.data.attempts.operatorRetries} operator retries`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="relative h-72">
            {metrics.error ? <ErrorBlock error={metrics.error} onRetry={() => void metrics.refetch()} /> : null}
            {metrics.isLoading ? <Skeleton className="h-full w-full rounded-lg" /> : null}
            {metrics.data && !hasOutcomes ? (
              <EmptyState
                compact
                icon={BarChart3}
                title="No finished automation jobs"
                description="Completed and failed UiPath executions in the selected period will be charted here."
              />
            ) : null}
            {metrics.data && hasOutcomes ? (
              <div className="h-full animate-fade-in">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: -20, right: 8 }}>
                    <defs>
                      <linearGradient id="bar-completed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.55} />
                      </linearGradient>
                      <linearGradient id="bar-failed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.95} />
                        <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} minTickGap={16} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: 'var(--popover-foreground)', fontWeight: 600, marginBottom: 2 }}
                      itemStyle={{ color: 'var(--muted-foreground)', padding: 0 }}
                      cursor={{ fill: 'var(--chart-cursor)', opacity: 0.7 }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span style={{ color: 'var(--muted-foreground)' }}>{value}</span>}
                    />
                    <Bar
                      dataKey="completed"
                      name="Completed"
                      stackId="a"
                      fill="url(#bar-completed)"
                      maxBarSize={36}
                      animationDuration={MOTION.chart}
                      animationEasing="ease-out"
                    />
                    <Bar
                      dataKey="failed"
                      name="Failed"
                      stackId="a"
                      fill="url(#bar-failed)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={36}
                      animationDuration={MOTION.chart}
                      animationEasing="ease-out"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Requests by status</CardTitle>
            <CardDescription>Created in the selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!summary.data && !summary.error ? <LoadingBlock rows={4} /> : null}
            {statuses.map((status, index) => {
              const count = summary.data!.requestsByStatus[status] ?? 0;
              return (
                <div key={status} className="space-y-1.5">
                  <div className="flex justify-between gap-2 text-[13px]">
                    <span>{PURCHASE_REQUEST_STATUS_LABELS[status]}</span>
                    <span className="font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${PURCHASE_REQUEST_STATUS_LABELS[status]}: ${count}`}>
                    <div
                      className={`h-full origin-left animate-grow-x rounded-full ${STATUS_BAR[status] ?? 'bg-primary'}`}
                      style={{ width: `${(count / statusMax) * 100}%`, animationDelay: `${index * 60}ms` }}
                    />
                  </div>
                </div>
              );
            })}
            {summary.data && statuses.length === 0 ? (
              <EmptyState compact icon={FileText} title="No requests in this period" description="Try a longer period. New requests appear here by status." />
            ) : null}
            {metrics.data?.failureReasons.length ? (
              <div className="mt-2 border-t pt-4">
                <p className="mb-2 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Top failure reasons</p>
                {metrics.data.failureReasons.slice(0, 4).map((reason) => (
                  <div key={reason.code} className="flex justify-between gap-3 py-0.5 text-xs">
                    <span className="truncate font-mono text-destructive-foreground">{reason.code}</span>
                    <span className="font-medium tabular-nums">{reason.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden /> Recent activity
            </CardTitle>
            <CardDescription>Latest audit events you are allowed to see</CardDescription>
          </div>
          {activity.data?.length && canReadAudit ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/audit">
                Audit trail <span aria-hidden>→</span>
              </Link>
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {activity.error ? <ErrorBlock error={activity.error} onRetry={() => void activity.refetch()} /> : null}
          {activity.isLoading ? <LoadingBlock rows={3} /> : null}
          {activity.data && activity.data.length === 0 ? (
            <EmptyState compact icon={Activity} title="No activity yet" description="Audit events you are allowed to see will appear here as work happens." />
          ) : null}
          {activity.data?.length ? (
            <ol className="stagger">
              {activity.data.map((event, index) => (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {index < activity.data.length - 1 ? <span className="absolute top-8 bottom-0.5 left-[13.5px] w-px bg-gradient-to-b from-border to-transparent" aria-hidden /> : null}
                  <EventIcon action={event.action} className="relative mt-0.5" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-sm leading-5">{describeEvent(event)}</p>
                      <p className="text-xs text-muted-foreground">
                        {actorLabel(event)} · {event.entityType}
                      </p>
                    </div>
                    {event.purchaseRequestId ? (
                      <Link
                        href={`/requests/${event.purchaseRequestId}`}
                        className="shrink-0 text-xs font-medium text-primary hover:underline"
                        title={formatDateTime(event.createdAt)}
                      >
                        {formatRelative(event.createdAt)}
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(event.createdAt)}>
                        {formatRelative(event.createdAt)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
