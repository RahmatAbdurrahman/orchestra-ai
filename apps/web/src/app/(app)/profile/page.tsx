'use client';

import { ROLE_LABELS } from '@orchestra/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyValue, PageHeader } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY, useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

export default function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const update = useMutation({
    mutationFn: (body: Record<string, string>) => api('/auth/me', { method: 'PATCH', body }),
    onSuccess: async () => {
      toast.success('Profile updated');
      setCurrentPassword('');
      setNewPassword('');
      await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader title="Profile" description={user.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <KeyValue label="Department">{user.department?.name ?? '—'}</KeyValue>
              <KeyValue label="Last sign-in">{formatDateTime(user.lastLoginAt)}</KeyValue>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((role) => (
                <Badge key={role} tone="primary">{ROLE_LABELS[role]}</Badge>
              ))}
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Effective permissions ({user.permissions.length})</summary>
              <p className="mt-2 font-mono leading-relaxed">{user.permissions.join(', ')}</p>
            </details>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                update.mutate({ name });
              }}
            >
              <Label htmlFor="name">Display name</Label>
              <div className="flex gap-2">
                <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
                <Button type="submit" disabled={update.isPending || name.trim() === user.name}>Save</Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>At least 12 characters with letters and digits. Other sessions are signed out.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                update.mutate({ currentPassword, newPassword });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="current">Current password</Label>
                <Input id="current" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new">New password</Label>
                <Input id="new" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              </div>
              <Button type="submit" disabled={update.isPending || !currentPassword || newPassword.length < 12}>
                {update.isPending ? <Loader2 className="animate-spin" /> : null}
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
