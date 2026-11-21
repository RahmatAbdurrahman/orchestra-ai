'use client';

import { APPROVAL_GROUP_LABELS, Permission, safeParseWorkflowConfiguration, type WorkflowConfiguration } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorBlock, KeyValue, LoadingBlock, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/overlays';
import { Alert, Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { WorkflowView } from '@/lib/types';

function NumberField({ label, value, onChange, step = 1, hint }: { label: string; value: number; onChange: (value: number) => void; step?: number; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={(event) => onChange(Number(event.target.value))} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approval thresholds</CardTitle>
            <CardDescription>Amounts in {config.rules.baseCurrency}. The last level is open ended.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {thresholds.map((threshold, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="w-28 text-muted-foreground">{index === thresholds.length - 1 ? 'Above' : 'Up to'}</span>
                {threshold.maxAmount !== null ? (
                  <Input
                    className="w-40"
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
                <span>→ {threshold.groups.map((group) => APPROVAL_GROUP_LABELS[group]).join(' + ')}</span>
              </div>
            ))}
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
          <CardContent className="grid grid-cols-2 gap-3">
            <NumberField label="Minimum amount" value={config.rules.minTransactionAmount} onChange={(value) => update({ ...config, rules: { ...config.rules, minTransactionAmount: value } })} />
            <NumberField label="Maximum amount" value={config.rules.maxTransactionAmount} onChange={(value) => update({ ...config, rules: { ...config.rules, maxTransactionAmount: value } })} />
            <NumberField label="Max quantity per line" value={config.rules.maxQuantityPerItem} onChange={(value) => update({ ...config, rules: { ...config.rules, maxQuantityPerItem: value } })} />
            <NumberField label="Duplicate lookback (days)" value={config.rules.duplicateLookbackDays} onChange={(value) => update({ ...config, rules: { ...config.rules, duplicateLookbackDays: value } })} />
            <NumberField label="USD → IDR rate (simulation)" value={config.rules.fxRatesToBase.USD ?? 0} onChange={(value) => update({ ...config, rules: { ...config.rules, fxRatesToBase: { ...config.rules.fxRatesToBase, USD: value } } })} />
            <NumberField label="Review threshold" step={0.01} value={config.document.confidenceThreshold} onChange={(value) => update({ ...config, document: { ...config.document, confidenceThreshold: value } })} hint="0–1; lower confidence needs confirmation" />
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <Checkbox disabled={!editable} checked={config.rules.requireRegisteredSupplier} onCheckedChange={(checked) => update({ ...config, rules: { ...config.rules, requireRegisteredSupplier: checked === true } })} />
              Supplier must be registered and active
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
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
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Process (release) name</Label>
              <Input disabled={!editable} value={config.automation.processName} onChange={(event) => update({ ...config, automation: { ...config.automation, processName: event.target.value } })} />
            </div>
            <div className="space-y-1.5">
              <Label>Dispatch</Label>
              <NativeSelect disabled={!editable} value={config.automation.dispatchMode} onChange={(event) => update({ ...config, automation: { ...config.automation, dispatchMode: event.target.value as 'AUTOMATIC' | 'MANUAL' } })}>
                <option value="AUTOMATIC">Automatic on approval</option>
                <option value="MANUAL">Manual by an operator</option>
              </NativeSelect>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <Checkbox disabled={!editable} checked={config.automation.enabled} onCheckedChange={(checked) => update({ ...config, automation: { ...config.automation, enabled: checked === true } })} />
              Automation enabled
            </label>
            <NumberField label="Automatic attempts" value={config.automation.maxAutoAttempts} onChange={(value) => update({ ...config, automation: { ...config.automation, maxAutoAttempts: value } })} hint="Before the robot starts" />
            <NumberField label="Total attempts (incl. retries)" value={config.automation.maxTotalAttempts} onChange={(value) => update({ ...config, automation: { ...config.automation, maxTotalAttempts: value } })} />
            <NumberField label="No-robot timeout (min)" value={config.automation.pendingTimeoutMinutes} onChange={(value) => update({ ...config, automation: { ...config.automation, pendingTimeoutMinutes: value } })} />
            <NumberField label="Execution timeout (min)" value={config.automation.executionTimeoutMinutes} onChange={(value) => update({ ...config, automation: { ...config.automation, executionTimeoutMinutes: value } })} />
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
          <ul className="list-disc pl-4">
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
          <ol className="space-y-2 text-sm">
            {detail.data?.versions?.map((version) => (
              <li key={version.id} className="flex justify-between gap-3 border-b pb-2 last:border-0">
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
