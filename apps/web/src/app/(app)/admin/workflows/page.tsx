'use client';

import { APPROVAL_GROUP_LABELS, Permission, safeParseWorkflowConfiguration, type WorkflowConfiguration } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckSquare, FileScan, Loader2, Lock, Save, Settings2, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/overlays';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldMessage, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { WorkflowView } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Sub-heading inside the business rules card. */
function RuleGroupLabel({ children, className }: { children: string; className?: string }) {
  return <p className={cn('text-2xs font-semibold tracking-wider text-muted-foreground uppercase sm:col-span-2', className)}>{children}</p>;
}

function NumberField({ label, value, onChange, step = 1, hint, disabled }: { label: string; value: number; onChange: (value: number) => void; step?: number; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" inputMode="decimal" step={step} disabled={disabled} className="tabular-nums" value={Number.isFinite(value) ? value : ''} onChange={(event) => onChange(Number(event.target.value))} />
      {hint ? <FieldMessage tone="hint">{hint}</FieldMessage> : null}
    </div>
  );
}

/**
 * The configured workflow as four connected stages, summarised from the configuration shown in the
 * editor below (including unsaved edits, which are flagged).
 */
function WorkflowPipeline({ config, dirty }: { config: WorkflowConfiguration; dirty: boolean }) {
  const currency = config.rules?.baseCurrency ?? 'IDR';
  const thresholds = config.approval?.thresholds ?? [];
  const maxLevels = Math.max(0, ...thresholds.map((threshold) => threshold.groups.length));
  const stages: Array<{ icon: LucideIcon; title: string; lines: string[]; muted?: boolean }> = [
    {
      icon: FileScan,
      title: 'Document intelligence',
      lines: [
        `Confirm fields below ${Math.round((config.document?.confidenceThreshold ?? 0) * 100)}% confidence`,
        `Files up to ${config.document?.maxFileSizeMb ?? '—'} MB`,
      ],
    },
    {
      icon: ShieldCheck,
      title: 'Business rules',
      lines: [
        `${formatMoney(config.rules?.minTransactionAmount, currency)} – ${formatMoney(config.rules?.maxTransactionAmount, currency)}`,
        `Duplicate check over ${config.rules?.duplicateLookbackDays ?? '—'} days`,
      ],
    },
    {
      icon: CheckSquare,
      title: 'Approval',
      lines: [`${thresholds.length} amount band${thresholds.length === 1 ? '' : 's'}`, `Up to ${maxLevels} level${maxLevels === 1 ? '' : 's'} in order`],
    },
    {
      icon: Bot,
      title: 'UiPath automation',
      lines: config.automation?.enabled
        ? [config.automation.dispatchMode === 'AUTOMATIC' ? 'Dispatched on final approval' : 'Dispatched by an operator', config.automation.processName]
        : ['Automation disabled', config.automation?.processName ?? '—'],
      muted: !config.automation?.enabled,
    },
  ];
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="decor-grid decor-fade-radial pointer-events-none absolute inset-0 opacity-70" />
      <CardHeader className="relative flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="space-y-1">
          <CardTitle>Workflow stages</CardTitle>
          <CardDescription>How a purchase request moves through this template</CardDescription>
        </div>
        {dirty ? (
          <Badge tone="warning" className="animate-status-in">
            <span className="size-1.5 rounded-full bg-current" aria-hidden /> Unsaved changes
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="relative">
        <ol className="grid gap-3 md:grid-cols-4 md:gap-6">
          {stages.map((stage, index) => (
            <li key={stage.title} className="relative animate-fade-up" style={{ animationDelay: `${index * 90}ms` }}>
              {index > 0 ? (
                <span aria-hidden className="absolute top-[22px] -left-6 hidden h-px w-6 md:block">
                  <span className="absolute inset-0 origin-left animate-grow-x bg-primary/40" style={{ animationDelay: `${index * 120}ms` }} />
                  <span className="absolute top-1/2 -right-px size-1.5 -translate-y-1/2 rounded-full bg-primary/60" />
                </span>
              ) : null}
              <div className={cn('h-full rounded-lg border bg-card p-3', stage.muted && 'opacity-70')}>
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/15 ring-inset dark:text-info-foreground">
                    <stage.icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">Stage {index + 1}</p>
                    <p className="truncate text-sm font-semibold">{stage.title}</p>
                  </div>
                </div>
                <ul className="mt-2.5 space-y-0.5 text-xs text-muted-foreground">
                  {stage.lines.map((line) => (
                    <li key={line} className="truncate" title={line}>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function WorkflowEditor({ workflow }: { workflow: WorkflowView }) {
  const { can } = useAuth();
  const editable = can(Permission.WORKFLOWS_MANAGE);
  const queryClient = useQueryClient();
  const [config, setConfig] = useState<WorkflowConfiguration>(workflow.configuration);
  const [json, setJson] = useState(JSON.stringify(workflow.configuration, null, 2));
  const [changeNote, setChangeNote] = useState('');
  useEffect(() => {
    setConfig(workflow.configuration);
    setJson(JSON.stringify(workflow.configuration, null, 2));
  }, [workflow]);

  const detail = useQuery({ queryKey: ['workflow', workflow.id], queryFn: () => api<WorkflowView>(`/workflows/${workflow.id}`) });
  const update = (next: WorkflowConfiguration) => {
    setConfig(next);
    setJson(JSON.stringify(next, null, 2));
  };
  const validation = safeParseWorkflowConfiguration(config);
  const save = useMutation({
    mutationFn: () => api<WorkflowView>(`/workflows/${workflow.id}`, { method: 'PATCH', body: { configuration: config, changeNote: changeNote || undefined } }),
    onSuccess: async (saved) => {
      toast.success(`Saved as version ${saved.version}`, { description: 'Requests already in progress keep the version they started with.' });
      setChangeNote('');
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      await queryClient.invalidateQueries({ queryKey: ['workflow', workflow.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggleActive = useMutation({
    mutationFn: () => api(`/workflows/${workflow.id}/activation`, { body: { isActive: !workflow.isActive } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const thresholds = config.approval.thresholds;
  const dirty = JSON.stringify(config) !== JSON.stringify(workflow.configuration);

  return (
    <div className="space-y-4">
      {!editable ? (
        <Alert tone="info">
          <Lock className="size-4" />
          <div>
            <span className="font-medium">Read-only view.</span> Your role can review this workflow; only workflow managers can change it.
          </div>
        </Alert>
      ) : null}
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{workflow.name}</CardTitle>
            <CardDescription>{workflow.description}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="primary">v{workflow.version}</Badge>
            <Badge tone={workflow.isActive ? 'success' : 'neutral'}>{workflow.isActive ? 'Active' : 'Inactive'}</Badge>
            {editable ? (
              <Button variant="outline" size="sm" onClick={() => toggleActive.mutate()}>
                {workflow.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KeyValue label="Key"><span className="font-mono text-xs">{workflow.key}</span></KeyValue>
          <KeyValue label="Type">{workflow.workflowType}</KeyValue>
          <KeyValue label="Requests">{workflow._count?.purchaseRequests ?? 0}</KeyValue>
          <KeyValue label="Updated">{formatDateTime(workflow.updatedAt)}</KeyValue>
        </CardContent>
      </Card>

      <WorkflowPipeline config={config} dirty={dirty} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approval thresholds</CardTitle>
            <CardDescription>Amounts in {config.rules.baseCurrency}. The last level is open ended.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative space-y-3">
            {thresholds.length > 1 ? <span aria-hidden className="absolute top-6 bottom-6 left-[24px] w-px bg-gradient-to-b from-primary/40 to-primary/10" /> : null}
            {thresholds.map((threshold, index) => (
              <div key={index} className="relative flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-card text-xs font-semibold text-primary ring-1 ring-primary/30 dark:text-info-foreground">{index + 1}</span>
                <span className="w-20 text-muted-foreground">{index === thresholds.length - 1 ? 'Above' : 'Up to'}</span>
                {threshold.maxAmount !== null ? (
                  <Input
                    className="w-40 tabular-nums"
                    aria-label={`Level ${index + 1} maximum amount`}
                    type="number"
                    disabled={!editable}
                    value={threshold.maxAmount}
                    onChange={(event) => {
                      const next = structuredClone(config);
                      next.approval.thresholds[index]!.maxAmount = Number(event.target.value);
                      update(next);
                    }}
                  />
                ) : (
                  <span className="w-40 tabular-nums">{formatMoney(thresholds[index - 1]?.maxAmount ?? 0, config.rules.baseCurrency)}</span>
                )}
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-subtle-foreground" aria-hidden>→</span>
                  {threshold.groups.map((group) => (
                    <Badge key={group} tone="primary">{APPROVAL_GROUP_LABELS[group]}</Badge>
                  ))}
                </span>
              </div>
            ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                disabled={!editable}
                checked={config.approval.requireDistinctApprovers}
                onCheckedChange={(checked) => update({ ...config, approval: { ...config.approval, requireDistinctApprovers: checked === true } })}
              />
              The same person cannot approve two levels
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Business rules</CardTitle>
            <CardDescription>Validation applied after document verification</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <RuleGroupLabel>Amount limits</RuleGroupLabel>
            <NumberField disabled={!editable} label="Minimum amount" value={config.rules.minTransactionAmount} onChange={(value) => update({ ...config, rules: { ...config.rules, minTransactionAmount: value } })} />
            <NumberField disabled={!editable} label="Maximum amount" value={config.rules.maxTransactionAmount} onChange={(value) => update({ ...config, rules: { ...config.rules, maxTransactionAmount: value } })} />
            <NumberField disabled={!editable} label="Max quantity per line" value={config.rules.maxQuantityPerItem} onChange={(value) => update({ ...config, rules: { ...config.rules, maxQuantityPerItem: value } })} />
            <NumberField disabled={!editable} label="USD → IDR rate (simulation)" value={config.rules.fxRatesToBase.USD ?? 0} onChange={(value) => update({ ...config, rules: { ...config.rules, fxRatesToBase: { ...config.rules.fxRatesToBase, USD: value } } })} />
            <RuleGroupLabel className="mt-2">Checks</RuleGroupLabel>
            <NumberField disabled={!editable} label="Duplicate lookback (days)" value={config.rules.duplicateLookbackDays} onChange={(value) => update({ ...config, rules: { ...config.rules, duplicateLookbackDays: value } })} />
            <NumberField disabled={!editable} label="Review threshold" step={0.01} value={config.document.confidenceThreshold} onChange={(value) => update({ ...config, document: { ...config.document, confidenceThreshold: value } })} hint="0–1; lower confidence needs confirmation" />
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox disabled={!editable} checked={config.rules.requireRegisteredSupplier} onCheckedChange={(checked) => update({ ...config, rules: { ...config.rules, requireRegisteredSupplier: checked === true } })} />
              Supplier must be registered and active
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <Checkbox disabled={!editable} checked={config.rules.enforceDepartmentBudget} onCheckedChange={(checked) => update({ ...config, rules: { ...config.rules, enforceDepartmentBudget: checked === true } })} />
              Enforce the monthly department budget
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>UiPath automation</CardTitle>
            <CardDescription>Process executed after the final approval</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="process-name">Process (release) name</Label>
              <Input id="process-name" className="font-mono text-[13px]" disabled={!editable} value={config.automation.processName} onChange={(event) => update({ ...config, automation: { ...config.automation, processName: event.target.value } })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-mode">Dispatch</Label>
              <NativeSelect id="dispatch-mode" disabled={!editable} value={config.automation.dispatchMode} onChange={(event) => update({ ...config, automation: { ...config.automation, dispatchMode: event.target.value as 'AUTOMATIC' | 'MANUAL' } })}>
                <option value="AUTOMATIC">Automatic on approval</option>
                <option value="MANUAL">Manual by an operator</option>
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 text-sm sm:mt-6">
              <Checkbox disabled={!editable} checked={config.automation.enabled} onCheckedChange={(checked) => update({ ...config, automation: { ...config.automation, enabled: checked === true } })} />
              Automation enabled
            </label>
            <NumberField disabled={!editable} label="Automatic attempts" value={config.automation.maxAutoAttempts} onChange={(value) => update({ ...config, automation: { ...config.automation, maxAutoAttempts: value } })} hint="Before the robot starts" />
            <NumberField disabled={!editable} label="Total attempts (incl. retries)" value={config.automation.maxTotalAttempts} onChange={(value) => update({ ...config, automation: { ...config.automation, maxTotalAttempts: value } })} />
            <NumberField disabled={!editable} label="No-robot timeout (min)" value={config.automation.pendingTimeoutMinutes} onChange={(value) => update({ ...config, automation: { ...config.automation, pendingTimeoutMinutes: value } })} />
            <NumberField disabled={!editable} label="Execution timeout (min)" value={config.automation.executionTimeoutMinutes} onChange={(value) => update({ ...config, automation: { ...config.automation, executionTimeoutMinutes: value } })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration (JSON)</CardTitle>
            <CardDescription>Advanced editing; validated on the server</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Textarea
              className="min-h-72 font-mono text-xs"
              disabled={!editable}
              value={json}
              onChange={(event) => {
                setJson(event.target.value);
                try {
                  setConfig(JSON.parse(event.target.value) as WorkflowConfiguration);
                } catch {
                  /* keep the last valid object while typing */
                }
              }}
            />
          </CardContent>
        </Card>
      </div>

      {!validation.success ? (
        <Alert tone="danger">
          <AlertTriangle className="size-4" />
          <ul className="list-inside list-disc space-y-0.5">
            {validation.error.issues.slice(0, 6).map((issue) => (
              <li key={`${issue.path.join('.')}${issue.message}`}>{issue.path.join('.')}: {issue.message}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {editable ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="change-note">Change note</Label>
              <Input id="change-note" value={changeNote} onChange={(event) => setChangeNote(event.target.value)} placeholder="Why is this change needed?" />
            </div>
            <Button onClick={() => save.mutate()} disabled={!validation.success || save.isPending}>
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Save as new version
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Version history</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.isLoading ? <LoadingBlock rows={3} /> : null}
          <ol className="space-y-2 text-sm">
            {detail.data?.versions?.map((version) => (
              <li key={version.id} className="flex flex-col justify-between gap-1 border-b pb-2 last:border-0 sm:flex-row sm:gap-3">
                <span>
                  <Badge tone="neutral">v{version.version}</Badge> {version.changeNote ?? '—'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {version.createdBy?.name ?? 'seed'} · {formatDateTime(version.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkflowsPage() {
  const { canAny } = useAuth();
  const workflows = useQuery({
    queryKey: ['workflows'],
    queryFn: () => api<WorkflowView[]>('/workflows'),
    enabled: canAny(Permission.WORKFLOWS_READ, Permission.WORKFLOWS_MANAGE),
  });
  const [selected, setSelected] = useState<string | null>(null);
  if (!canAny(Permission.WORKFLOWS_READ, Permission.WORKFLOWS_MANAGE)) return <EmptyState title="No access to workflows" />;
  const current = workflows.data?.find((workflow) => workflow.id === selected) ?? workflows.data?.[0];

  return (
    <>
      <PageHeader
        icon={Settings2}
        title="Workflows"
        description="Template-based workflow configuration: document stage, business rules, approval thresholds and the UiPath process. Every change creates an immutable version."
        actions={
          workflows.data && workflows.data.length > 1 ? (
            <NativeSelect value={current?.id} onChange={(event) => setSelected(event.target.value)} className="w-72">
              {workflows.data.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </NativeSelect>
          ) : null
        }
      />
      {workflows.error ? <ErrorBlock error={workflows.error} /> : null}
      {workflows.isLoading ? <LoadingBlock rows={6} /> : null}
      {current ? <WorkflowEditor workflow={current} /> : null}
    </>
  );
}
