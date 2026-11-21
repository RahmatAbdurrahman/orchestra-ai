'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Permission } from '@orchestra/domain';
import { AlertTriangle, CheckCircle2, Circle, FilePlus2, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FileDropzone } from '@/components/file-dropzone';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, FieldMessage, Input, Label, Textarea } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

import type { PurchaseRequestDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

const schema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(200),
  description: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';
const SUBMIT_STEPS = ['Creating request…', 'Uploading document…', 'Submitting for document intelligence…'];

/** Numbered marker for the two form sections (decorative; the headings carry the meaning). */
function StepNumber({ value }: { value: number }) {
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary ring-1 ring-primary/20 dark:text-info-foreground">
      {value}
    </span>
  );
}

export default function NewRequestPage() {
  const { can, user } = useAuth();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { title: '', description: '' } });

  if (!can(Permission.REQUESTS_CREATE)) {
    return <EmptyState title="You cannot create purchase requests" description="Only requesters can create purchase requests." />;
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    if (!file) {
      setError('Attach the supplier invoice or quotation (PDF, PNG or JPEG).');
      return;
    }
    try {
      setStep('Creating request…');
      const created = await api<PurchaseRequestDetail>('/purchase-requests', { body: values });
      setStep('Uploading document…');
      const data = new FormData();
      data.append('file', file);
      await api(`/purchase-requests/${created.id}/documents`, { method: 'POST', body: data });
      setStep('Submitting for document intelligence…');
      await api(`/purchase-requests/${created.id}/submit`, { method: 'POST' });
      toast.success(`${created.requestNumber} submitted`, { description: 'The document is being read. You will verify the extracted data next.' });
      router.push(`/requests/${created.id}`);
    } catch (cause) {
      setError(errorMessage(cause));
      setStep(null);
    }
  });

  return (
    <>
      <PageHeader
        icon={FilePlus2}
        title="New purchase request"
        description={`Department: ${user.department?.name ?? '—'}. Upload the supplier document; Orchestra extracts the data for you to verify.`}
      />
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <StepNumber value={1} /> Request details
            </CardTitle>
            <CardDescription className="pl-[30px]">What do you need, and why?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <Alert tone="danger"><AlertTriangle className="size-4" /><div>{error}</div></Alert> : null}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="e.g. Ergonomic equipment for the operations team" {...form.register('title')} aria-invalid={!!form.formState.errors.title} />
              {form.formState.errors.title ? <FieldMessage>{form.formState.errors.title.message}</FieldMessage> : null}
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between"><Label htmlFor="description">Justification <span className="font-normal text-muted-foreground">(optional)</span></Label><span className="text-xs text-subtle-foreground tabular-nums">{(form.watch("description") ?? "").length}/2000</span></div>
              <Textarea id="description" rows={6} placeholder="Business reason, project, cost centre…" {...form.register('description')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <StepNumber value={2} /> Supporting document
            </CardTitle>
            <CardDescription className="pl-[30px]">Invoice or quotation · PDF, PNG or JPEG · max 10 MB</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FileDropzone file={file} onChange={setFile} accept={ACCEPTED} disabled={!!step} hint="PDF, PNG or JPEG" testId="document-input" />
            <Button type="submit" className="w-full" disabled={!!step}>
              {step ? <Loader2 className="animate-spin" /> : null}
              {step ?? 'Create & submit'}
            </Button>
            {step ? (
              <ol className="space-y-1.5 text-xs" aria-label="Submission progress">
                {SUBMIT_STEPS.map((label, index) => {
                  const current = SUBMIT_STEPS.indexOf(step);
                  const state = index < current ? 'done' : index === current ? 'current' : 'todo';
                  return (
                    <li key={label} className={cn('flex items-center gap-2', state === 'todo' ? 'text-subtle-foreground' : 'text-foreground')}>
                      {state === 'done' ? (
                        <CheckCircle2 className="size-3.5 text-success-foreground" aria-hidden />
                      ) : state === 'current' ? (
                        <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
                      ) : (
                        <Circle className="size-3.5" aria-hidden />
                      )}
                      {label.replace('…', '')}
                      <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (in progress)' : ''}</span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <p className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              Extracted values are never used without your confirmation. Low-confidence fields must be checked explicitly.
            </p>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
