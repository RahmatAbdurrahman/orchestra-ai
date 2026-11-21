'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Permission } from '@orchestra/domain';
import { FileUp, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { EmptyState, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Textarea } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBytes } from '@/lib/format';
import type { PurchaseRequestDetail } from '@/lib/types';

const schema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(200),
  description: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;

const ACCEPTED = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

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
        title="New purchase request"
        description={`Department: ${user.department?.name ?? '—'}. Upload the supplier document; Orchestra extracts the data for you to verify.`}
      />
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Request details</CardTitle>
            <CardDescription>What do you need, and why?</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="e.g. Ergonomic equipment for the operations team" {...form.register('title')} aria-invalid={!!form.formState.errors.title} />
              {form.formState.errors.title ? <p className="text-xs text-destructive">{form.formState.errors.title.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Justification (optional)</Label>
              <Textarea id="description" rows={4} placeholder="Business reason, project, cost centre…" {...form.register('description')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supporting document</CardTitle>
            <CardDescription>Invoice or quotation · PDF, PNG or JPEG · max 10 MB</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              htmlFor="document"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center hover:bg-muted/40"
            >
              <FileUp className="size-6 text-muted-foreground" />
              {file ? (
                <span className="text-sm">
                  <span className="font-medium">{file.name}</span>
                  <span className="block text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Click to choose a file</span>
              )}
              <input
                id="document"
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                data-testid="document-input"
              />
            </label>
            <Button type="submit" className="w-full" disabled={!!step}>
              {step ? <Loader2 className="animate-spin" /> : null}
              {step ?? 'Create & submit'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Extracted values are never used without your confirmation. Low-confidence fields must be checked explicitly.
            </p>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
