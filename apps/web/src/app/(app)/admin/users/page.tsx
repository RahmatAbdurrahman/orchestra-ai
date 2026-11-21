'use client';

import { Permission, ROLE_LABELS, ROLE_NAMES, type RoleName } from '@orchestra/domain';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Users, UserX } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorBlock, FetchingBar, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { RoleBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Badge, Card, Input, Label, NativeSelect, SearchInput, Table, TBody, TD, TH, THead, TR } from '@/components/ui/primitives';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import type { Department, Paginated, UserView } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Draft {
  id?: string;
  name: string;
  email: string;
  password: string;
  departmentId: string;
  roles: RoleName[];
  isActive: boolean;
}

const EMPTY: Draft = { name: '', email: '', password: '', departmentId: '', roles: ['REQUESTER'], isActive: true };

function UserDialog({ draft, onClose, departments }: { draft: Draft | null; onClose: () => void; departments: Department[] }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState<Draft>(draft ?? EMPTY);
  const editing = Boolean(draft?.id);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api(`/users/${value.id}`, {
            method: 'PATCH',
            body: {
              name: value.name,
              departmentId: value.departmentId || undefined,
              roles: value.roles,
              isActive: value.isActive,
              ...(value.password ? { password: value.password } : {}),
            },
          })
        : api('/users', {
            body: { name: value.name, email: value.email, password: value.password, departmentId: value.departmentId || undefined, roles: value.roles },
          }),
    onSuccess: async () => {
      toast.success(editing ? 'User updated' : 'User created');
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggleRole = (role: RoleName, checked: boolean) =>
    setValue((current) => ({ ...current, roles: checked ? [...new Set([...current.roles, role])] : current.roles.filter((r) => r !== role) }));

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'Create user'}</DialogTitle>
          <DialogDescription>Roles determine what the user can see and do; the server enforces every permission.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Name</Label>
            <Input id="user-name" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} />
          </div>
          {!editing ? (
            <div className="space-y-1.5">
              <Label htmlFor="user-email">Email</Label>
              <Input id="user-email" type="email" value={value.email} onChange={(event) => setValue({ ...value, email: event.target.value })} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="user-password">{editing ? 'Reset password (optional)' : 'Initial password'}</Label>
            <Input id="user-password" type="password" autoComplete="new-password" value={value.password} onChange={(event) => setValue({ ...value, password: event.target.value })} placeholder="At least 12 characters, letters and digits" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="user-department">Department</Label>
            <NativeSelect id="user-department" value={value.departmentId} onChange={(event) => setValue({ ...value, departmentId: event.target.value })}>
              <option value="">No department</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>Roles</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_NAMES.map((role) => (
                <label key={role} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-row-hover has-[[data-state=checked]]:border-primary/40 has-[[data-state=checked]]:bg-primary/5">
                  <Checkbox checked={value.roles.includes(role)} onCheckedChange={(checked) => toggleRole(role, checked === true)} />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          {editing ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={value.isActive} onCheckedChange={(checked) => setValue({ ...value, isActive: checked === true })} />
              Active (inactive users cannot sign in)
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !value.name || value.roles.length === 0 || (!editing && (!value.email || !value.password))}>
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const users = useQuery({
    queryKey: ['users', page, query],
    queryFn: () => api<Paginated<UserView>>('/users', { query: { page, pageSize: 20, search: query } }),
    placeholderData: keepPreviousData,
    enabled: can(Permission.USERS_MANAGE),
  });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<Department[]>('/departments') });

  if (!can(Permission.USERS_MANAGE)) return <EmptyState title="Administrators only" />;

  return (
    <>
      <PageHeader
        icon={Users}
        title="Users & roles"
        description="Create accounts, assign roles and departments, deactivate access. Users are never deleted (the audit trail references them)."
        actions={<Button onClick={() => setDraft(EMPTY)}><Plus /> New user</Button>}
      />
      <form
        className="mb-4 max-w-md"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or email — press Enter" aria-label="Search users" />
      </form>
      {users.error ? <ErrorBlock error={users.error} onRetry={() => void users.refetch()} /> : null}
      {users.isLoading ? <LoadingBlock rows={6} label="Loading users" /> : null}
      {users.data && users.data.data.length === 0 ? (
        <EmptyState icon={UserX} title="No matching users" description={query ? `Nobody matches “${query}”. Try another name or email.` : 'Create the first user account.'} />
      ) : null}
      {users.data && users.data.data.length > 0 ? (
        <Card className="relative overflow-hidden">
          <FetchingBar active={users.isFetching && users.isPlaceholderData} />
          <Table className={cn('transition-opacity duration-200', users.isPlaceholderData && 'opacity-60')}>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Roles</TH>
                <TH className="hidden md:table-cell">Department</TH>
                <TH>Status</TH>
                <TH className="hidden lg:table-cell">Last sign-in</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {users.data.data.map((user) => (
                <TR key={user.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-1 ring-border" aria-hidden>
                        {user.name
                          .split(' ')
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join('')
                          .toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{user.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map((role) => (
                        <RoleBadge key={role} role={role} />
                      ))}
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">{user.department?.name ?? '—'}</TD>
                  <TD>
                    {user.isActive ? (
                      <Badge tone="success">
                        <span className="size-1.5 rounded-full bg-current" aria-hidden /> Active
                      </Badge>
                    ) : (
                      <Badge tone="neutral">
                        <span className="size-1.5 rounded-full bg-current" aria-hidden /> Inactive
                      </Badge>
                    )}
                    {user.lockedUntil && new Date(user.lockedUntil) > new Date() ? <Badge tone="danger" className="ml-1">Locked</Badge> : null}
                  </TD>
                  <TD className="hidden text-muted-foreground lg:table-cell">{formatRelative(user.lastLoginAt)}</TD>
                  <TD className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft({ id: user.id, name: user.name, email: user.email, password: '', departmentId: user.department?.id ?? '', roles: user.roles, isActive: user.isActive })
                      }
                    >
                      <Pencil /> Edit<span className="sr-only"> {user.name}</span>
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      {users.data ? <Pager page={page} totalPages={users.data.meta.totalPages} total={users.data.meta.total} onChange={setPage} /> : null}
      {draft ? <UserDialog key={draft.id ?? 'new'} draft={draft} onClose={() => setDraft(null)} departments={departments.data ?? []} /> : null}
    </>
  );
}
