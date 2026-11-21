'use client';

import { computeTotals, findBestSupplierMatch, type ExtractedFieldKey, type VerifiableField } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ConfidenceBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/overlays';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect } from '@/components/ui/primitives';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatMoney, todayPlus } from '@/lib/format';
import type { DocumentView, PurchaseRequestDetail, Supplier } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RuleFindings } from './rule-findings';

interface FormValues {
  supplierId: string;
  supplierName: string;
  documentNumber: string;
  documentDate: string;
  currency: string;
  requiredDate: string;
  taxAmount: number;
  items: Array<{ description: string; quantity: number; unitPrice: number }>;
  acknowledged: Partial<Record<VerifiableField, boolean>>;
}

const FIELD_LABELS: Record<VerifiableField, string> = {
  supplierName: 'Supplier',
  documentNumber: 'Invoice number',
  documentDate: 'Invoice date',
  currency: 'Currency',
  taxAmount: 'Tax amount',
  totalAmount: 'Total amount',
  items: 'Line items',
};

function defaults(document: DocumentView, suppliers: Supplier[]): FormValues {
  const verified = document.verifiedData;
  const extraction = document.extraction;
  const supplierName = verified?.supplierName ?? extraction?.fields.supplierName.value ?? '';
  const match = supplierName ? findBestSupplierMatch(supplierName, suppliers) : null;
  return {
    supplierId: verified?.supplierId ?? match?.supplier.id ?? '',
    supplierName: match?.supplier.name ?? supplierName,
    documentNumber: verified?.documentNumber ?? extraction?.fields.documentNumber.value ?? '',
    documentDate: verified?.documentDate ?? extraction?.fields.documentDate.value ?? '',
    currency: verified?.currency ?? extraction?.fields.currency.value ?? 'IDR',
    requiredDate: verified?.requiredDate ?? todayPlus(14),
    taxAmount: verified?.taxAmount ?? extraction?.fields.taxAmount.value ?? 0,
    items:
      verified?.items ??
      (extraction?.items.length
        ? extraction.items.map((item) => ({
            description: item.description.value ?? '',
            quantity: Math.max(1, Math.round(item.quantity.value ?? 1)),
            unitPrice: item.unitPrice.value ?? 0,
          }))
        : [{ description: '', quantity: 1, unitPrice: 0 }]),
    acknowledged: {},
  };
}

function FieldConfidence({ document, field }: { document: DocumentView; field: ExtractedFieldKey }) {
  const value = document.extraction?.fields[field];
  if (!value) return null;
  return <ConfidenceBadge value={value.confidence} />;
}

export function VerificationForm({
  request,
  document,
  suppliers,
}: {
  request: PurchaseRequestDetail;
  document: DocumentView;
  suppliers: Supplier[];
}) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({ defaultValues: defaults(document, suppliers) });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const watchedTax = useWatch({ control: form.control, name: 'taxAmount' });
  const currency = useWatch({ control: form.control, name: 'currency' });
  const acknowledged = useWatch({ control: form.control, name: 'acknowledged' });
  const lowConfidence = document.lowConfidenceFields;
  const pendingAcks = lowConfidence.filter((field) => !acknowledged?.[field]);
  const totals = useMemo(
    () =>
      computeTotals(
        (watchedItems ?? []).map((item) => ({ quantity: Number(item.quantity) || 0, unitPrice: Number(item.unitPrice) || 0 })),
        Number(watchedTax) || 0,
      ),
    [watchedItems, watchedTax],
  );
  const extractedTotal = document.extraction?.fields.totalAmount.value ?? null;

  const verify = useMutation({
    mutationFn: (values: FormValues) =>
      api<{ outcome: 'PENDING_APPROVAL' | 'BLOCKED_BY_RULES'; purchaseRequest: PurchaseRequestDetail }>(`/documents/${document.id}/verify`, {
        method: 'PATCH',
        body: {
          supplierId: values.supplierId || undefined,
          supplierName: values.supplierName.trim(),
          documentNumber: values.documentNumber.trim() || undefined,
          documentDate: values.documentDate || undefined,
          currency: values.currency,
          requiredDate: values.requiredDate,
          taxAmount: Number(values.taxAmount) || 0,
          items: values.items.map((item) => ({
            description: item.description.trim(),
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
          })),
          acknowledgedFields: lowConfidence.filter((field) => values.acknowledged[field]),
        },
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(['request', request.id], result.purchaseRequest);
      void queryClient.invalidateQueries({ queryKey: ['request', request.id] });
      if (result.outcome === 'PENDING_APPROVAL') {
        toast.success('Sent for approval', { description: `Route: ${result.purchaseRequest.approvalRoute.join(' → ')}` });
      } else {
        toast.warning('Blocked by business rules', { description: 'Fix the highlighted issues and verify again.' });
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ruleEvaluation = request.ruleEvaluation;
  const blocked = ruleEvaluation && !ruleEvaluation.passed;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" /> Verify extracted data
        </CardTitle>
        <CardDescription>
          Compare every value with the document. Fields below the {Math.round((request.documentSettings?.confidenceThreshold ?? 0.85) * 100)}%
          confidence threshold must be confirmed explicitly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit((values) => verify.mutate(values))} className="space-y-5" data-testid="verification-form">
          {document.extraction?.reviewReasons.length ? (
            <Alert tone="warning">
              <AlertTriangle className="size-4" />
              <ul className="list-disc space-y-0.5 pl-4">
                {document.extraction.reviewReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {document.processingStatus === 'FAILED' ? (
            <Alert tone="warning">Automatic extraction failed ({document.processingError}). Enter the data from the document manually.</Alert>
          ) : null}
          {blocked ? <RuleFindings evaluation={ruleEvaluation} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="supplierId">Supplier (from supplier master)</Label>
                <FieldConfidence document={document} field="supplierName" />
              </div>
              <NativeSelect
                id="supplierId"
                {...form.register('supplierId', {
                  onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
                    const supplier = suppliers.find((candidate) => candidate.id === event.target.value);
                    if (supplier) form.setValue('supplierName', supplier.name);
                  },
                })}
              >
                <option value="">Not in the supplier master</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.code} · {supplier.name}
                    {supplier.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </NativeSelect>
              <Input aria-label="Supplier name" {...form.register('supplierName', { required: true })} placeholder="Supplier name as on the document" />
              {document.extraction?.fields.supplierName.value ? (
                <p className="text-xs text-muted-foreground">Read from document: “{document.extraction.fields.supplierName.value}”</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="documentNumber">Invoice number</Label>
                <FieldConfidence document={document} field="documentNumber" />
              </div>
              <Input id="documentNumber" {...form.register('documentNumber')} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="documentDate">Invoice date</Label>
                <FieldConfidence document={document} field="documentDate" />
              </div>
              <Input id="documentDate" type="date" {...form.register('documentDate')} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="currency">Currency</Label>
                <FieldConfidence document={document} field="currency" />
              </div>
              <NativeSelect id="currency" {...form.register('currency')}>
                <option value="IDR">IDR — Indonesian Rupiah</option>
                <option value="USD">USD — US Dollar</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="requiredDate">Required by</Label>
              <Input id="requiredDate" type="date" min={todayPlus(0)} {...form.register('requiredDate', { required: true })} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Line items</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => items.append({ description: '', quantity: 1, unitPrice: 0 })} disabled={items.fields.length >= 10}>
                <Plus /> Add line
              </Button>
            </div>
            <div className="space-y-2">
              {items.fields.map((field, index) => {
                const extractedItem = document.extraction?.items[index];
                return (
                  <div key={field.id} className="grid grid-cols-12 items-center gap-2 rounded-lg border p-2">
                    <Input className="col-span-12 sm:col-span-6" placeholder="Description" aria-label={`Line ${index + 1} description`} {...form.register(`items.${index}.description`, { required: true })} />
                    <Input className="col-span-3 sm:col-span-2" type="number" min={1} step={1} aria-label={`Line ${index + 1} quantity`} {...form.register(`items.${index}.quantity`, { valueAsNumber: true, min: 1 })} />
                    <Input className="col-span-6 sm:col-span-3" type="number" min={0} step="0.01" aria-label={`Line ${index + 1} unit price`} {...form.register(`items.${index}.unitPrice`, { valueAsNumber: true, min: 0 })} />
                    <div className="col-span-3 flex items-center justify-end gap-1 sm:col-span-1">
                      {extractedItem ? <ConfidenceBadge value={extractedItem.confidence} /> : null}
                      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => items.remove(index)} disabled={items.fields.length === 1} aria-label="Remove line">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="taxAmount">Tax amount (PPN / VAT)</Label>
                <FieldConfidence document={document} field="taxAmount" />
              </div>
              <Input id="taxAmount" type="number" min={0} step="0.01" {...form.register('taxAmount', { valueAsNumber: true, min: 0 })} />
            </div>
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatMoney(totals.subtotal, currency)}</span></div>
              <div className="flex justify-between"><span>Tax</span><span className="tabular-nums">{formatMoney(totals.taxAmount, currency)}</span></div>
              <div className="mt-1 flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular-nums" data-testid="verify-total">{formatMoney(totals.total, currency)}</span></div>
              {extractedTotal !== null && Math.abs(extractedTotal - totals.total) > Math.max(1, extractedTotal * 0.01) ? (
                <p className="mt-1 text-xs text-destructive">Document total: {formatMoney(extractedTotal, currency)}</p>
              ) : null}
            </div>
          </div>

          {lowConfidence.length > 0 ? (
            <div className="space-y-2 rounded-lg border border-warning/50 bg-warning/8 p-3">
              <p className="text-sm font-medium">Confirm low-confidence values</p>
              <p className="text-xs text-muted-foreground">Tick each item after you compared it with the original document.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {lowConfidence.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!acknowledged?.[field]}
                      onCheckedChange={(checked) => form.setValue(`acknowledged.${field}`, checked === true, { shouldDirty: true })}
                      aria-label={`Confirm ${FIELD_LABELS[field]}`}
                    />
                    I checked: {FIELD_LABELS[field]}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {verify.error instanceof ApiError && verify.error.status === 422 ? <Alert tone="danger">{verify.error.message}</Alert> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className={cn('text-xs', pendingAcks.length ? 'text-destructive' : 'text-muted-foreground')}>
              {pendingAcks.length ? `${pendingAcks.length} value(s) still need your confirmation` : 'Business rules run when you submit.'}
            </p>
            <Button type="submit" disabled={verify.isPending || pendingAcks.length > 0} data-testid="verify-submit">
              {verify.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
              Verify & send for approval
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function useSuppliers() {
  return useQuery({ queryKey: ['suppliers'], queryFn: () => api<Supplier[]>('/suppliers'), staleTime: 5 * 60_000 });
}
