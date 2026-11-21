'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, KeyRound, Loader2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Collapse } from '@/components/motion';
import { KeyValue, PageHeader } from '@/components/page';
import { RoleBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { ME_QUERY_KEY, useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export default function ProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPermissions, setShowPermissions] = useState(false);
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
      <PageHeader icon={UserRound} title="Profile" description="Your account, roles and sign-in security." />
      <div className="stagger grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            <span
              className="relative flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5 text-base font-semibold text-primary ring-1 ring-primary/25 dark:text-info-foreground"
              aria-hidden
            >
              {user.name
                .split(' ')
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="truncate text-base">{user.name}</CardTitle>
              <CardDescription className="truncate">{user.email}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <KeyValue label="Department">{user.department?.name ?? '—'}</KeyValue>
              <KeyValue label="Last sign-in">{formatDateTime(user.lastLoginAt)}</KeyValue>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {user.roles.map((role) => (
                <RoleBadge key={role} role={role} />
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              <button
                type="button"
                className="flex items-center gap-1 rounded-sm font-medium transition-colors hover:text-foreground focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                aria-expanded={showPermissions}
                aria-controls="effective-permissions"
                onClick={() => setShowPermissions((open) => !open)}
              >
                <ChevronRight className={cn('size-3.5 transition-transform duration-200', showPermissions && 'rotate-90')} aria-hidden />
                Effective permissions ({user.permissions.length})
              </button>
              <Collapse open={showPermissions} id="effective-permissions">
                <p className="mt-2 rounded-md border bg-muted/40 p-2.5 font-mono leading-relaxed">{user.permissions.join(', ')}</p>
              </Collapse>
            </div>
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
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" aria-hidden /> Change password
            </CardTitle>
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
