'use client';

import { PURCHASE_REQUEST_STATUS_LABELS, Permission, type PurchaseRequestStatus } from '@orchestra/domain';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Bot, CheckCircle2, Clock, FileText, Gauge, Hourglass, Plus, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDuration, formatPercent, formatRelative } from '@/lib/format';
import type { AuditEvent, AutomationMetrics, DashboardSummary } from '@/lib/types';
import { describeEvent } from '@/lib/events';

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

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: typeof Activity;
  tone?: 'default' | 'success' | 'danger' | 'warning';
}) {
  const toneClass = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/12 text-success',
    danger: 'bg-destructive/10 text-destructive',
    warning: 'bg-warning/15 text-[oklch(0.5_0.13_60)] dark:text-warning',
  }[tone];
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 pt-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums" data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
            {value}
          </p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <span className={`flex size-9 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, can } = useAuth();
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

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(' ')[0]}`}
        description={`${scopeLabel} · automation overview`}
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

      {summary.error ? <ErrorBlock error={summary.error} /> : null}
      {!totals ? (
        <LoadingBlock rows={2} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Requests" value={totals.requests} hint={`${totals.activeWorkflows} active workflow(s)`} icon={FileText} />
          <Kpi label="Pending approvals" value={totals.pendingApprovals} hint={can(Permission.APPROVALS_DECIDE) ? 'Waiting for you' : 'In approval'} icon={Hourglass} tone="warning" />
          <Kpi label="Running jobs" value={totals.runningJobs} hint="Queued or executing in UiPath" icon={Bot} />
          <Kpi
            label="Success rate"
            value={formatPercent(totals.successRate)}
            hint={`${totals.completedJobs} completed · ${totals.failedJobs} failed`}
            icon={Gauge}
            tone={totals.successRate === null || totals.successRate >= 0.95 ? 'success' : 'danger'}
          />
          <Kpi label="Successful executions" value={totals.completedJobs} icon={CheckCircle2} tone="success" />
          <Kpi label="Failed executions" value={totals.failedJobs} hint={`${totals.jobsNeedingAttention} currently failed`} icon={AlertTriangle} tone="danger" />
          <Kpi label="Avg. execution time" value={formatDuration(totals.avgExecutionSeconds)} hint="Robot start to finish" icon={Clock} />
          <Kpi label="Active workflows" value={totals.activeWorkflows} icon={Workflow} />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Automation outcomes</CardTitle>
            <CardDescription>
              Jobs per day by final status
              {metrics.data
                ? ` · ${metrics.data.attempts.total} UiPath submissions, ${metrics.data.attempts.automaticRetries} automatic and ${metrics.data.attempts.operatorRetries} operator retries`
                : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {metrics.isLoading ? (
              <LoadingBlock rows={4} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'var(--muted)' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="completed" name="Completed" stackId="a" fill="var(--chart-2)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--chart-3)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Requests by status</CardTitle>
            <CardDescription>Created in the selected period</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {STATUS_ORDER.filter((status) => summary.data?.requestsByStatus[status]).map((status) => {
              const count = summary.data!.requestsByStatus[status] ?? 0;
              return (
                <div key={status} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span>{PURCHASE_REQUEST_STATUS_LABELS[status]}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(count / statusMax) * 100}%` }} />
                  </div>
                </div>
              );
            })}
            {summary.data && Object.keys(summary.data.requestsByStatus).length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No requests in this period.</p>
            ) : null}
            {metrics.data?.failureReasons.length ? (
              <div className="pt-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Top failure reasons</p>
                {metrics.data.failureReasons.slice(0, 4).map((reason) => (
                  <div key={reason.code} className="flex justify-between text-xs">
                    <span className="font-mono">{reason.code}</span>
                    <span className="tabular-nums">{reason.count}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest audit events you are allowed to see</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.isLoading ? <LoadingBlock rows={3} /> : null}
          {activity.data && activity.data.length === 0 ? <EmptyState title="No activity yet" /> : null}
          <ul className="divide-y">
            {activity.data?.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{describeEvent(event)}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.actor?.name ?? (event.actorType === 'ROBOT' ? 'UiPath robot' : 'System')} · {event.entityType}
                  </p>
                </div>
                {event.purchaseRequestId ? (
                  <Link href={`/requests/${event.purchaseRequestId}`} className="shrink-0 text-xs text-primary hover:underline">
                    {formatRelative(event.createdAt)}
                  </Link>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(event.createdAt)}</span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
