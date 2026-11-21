'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/overlays';
import { Label, Textarea } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';

interface ReasonDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  label: string;
  required?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  testId?: string;
}

/** Confirmation dialog with an optional / required free-text reason. */
export function ReasonDialog({ trigger, title, description, label, required, confirmLabel, destructive, onConfirm, testId }: ReasonDialogProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: () => onConfirm(reason.trim()),
    onSuccess: () => {
      setOpen(false);
      setReason('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const invalid = required && reason.trim().length < 3;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">{label}</Label>
          <Textarea id="reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} />
          {required ? <p className="text-xs text-muted-foreground">Required (at least 3 characters).</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Back
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()} data-testid="confirm-action">
            {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approve / reject buttons for the approval level the current user may decide. */
export function DecisionButtons({ approvalId, requestId, requestNumber }: { approvalId: string; requestId: string; requestNumber: string }) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['request', requestId] }),
      queryClient.invalidateQueries({ queryKey: ['approvals'] }),
      queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    ]);
  };
  return (
    <>
      <ReasonDialog
        testId="approve-dialog"
        trigger={
          <Button data-testid="approve-button">
            <Check /> Approve
          </Button>
        }
        title={`Approve ${requestNumber}`}
        description="Your decision, name and time are recorded in the audit trail."
        label="Comment (optional)"
        confirmLabel="Approve"
        onConfirm={async (comments) => {
          const result = await api<{ outcome: string }>(`/approvals/${approvalId}/approve`, { body: { comments: comments || undefined } });
          toast.success(result.outcome === 'NEXT_LEVEL' ? 'Approved — sent to the next approval level' : 'Approved — the robot will create the purchase order');
          await refresh();
        }}
      />
      <ReasonDialog
        testId="reject-dialog"
        trigger={
          <Button variant="outline" className="text-destructive" data-testid="reject-button">
            <X /> Reject
          </Button>
        }
        title={`Reject ${requestNumber}`}
        description="Rejected requests are final and will never be executed."
        label="Reason for rejection"
        required
        destructive
        confirmLabel="Reject request"
        onConfirm={async (reason) => {
          await api(`/approvals/${approvalId}/reject`, { body: { reason } });
          toast.success('Request rejected');
          await refresh();
        }}
      />
    </>
  );
}

export function RetryButton({ jobId, onDone, size }: { jobId: string; onDone: () => Promise<unknown> | void; size?: 'sm' | 'default' }) {
  return (
    <ReasonDialog
      testId="retry-dialog"
      trigger={
        <Button size={size} data-testid="retry-button">
          <RotateCcw /> Retry
        </Button>
      }
      title="Retry automation job"
      description="A new UiPath job is submitted with the same idempotency key, so the ERP will not create a second purchase order."
      label="Reason (optional)"
      confirmLabel="Retry now"
      onConfirm={async (reason) => {
        await api(`/automation/jobs/${jobId}/retry`, { body: { reason: reason || undefined } });
        toast.success('Retry queued');
        await onDone();
      }}
    />
  );
}
