'use client';

import { Permission, ROLE_LABELS } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Bot,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PlugZap,
  ScrollText,
  Settings2,
  Sun,
  UserRound,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import type { NotificationView, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  visible: (can: (p: Permission) => boolean) => boolean;
}

const NAV: Array<{ section: string; items: NavItem[] }> = [
  {
    section: 'Operations',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, visible: (can) => can(Permission.DASHBOARD_VIEW) },
      {
        href: '/requests',
        label: 'Purchase requests',
        icon: FileText,
        visible: (can) => can(Permission.REQUESTS_READ_ALL) || can(Permission.REQUESTS_READ_OWN) || can(Permission.REQUESTS_READ_ASSIGNED),
      },
      { href: '/approvals', label: 'Approvals', icon: CheckSquare, visible: (can) => can(Permission.APPROVALS_DECIDE) },
      { href: '/automation', label: 'Automation jobs', icon: Bot, visible: (can) => can(Permission.AUTOMATION_READ) },
      {
        href: '/audit',
        label: 'Audit trail',
        icon: ScrollText,
        visible: (can) =>
          can(Permission.AUDIT_READ_ALL) || can(Permission.AUDIT_READ_OWN) || can(Permission.AUDIT_READ_RELEVANT) || can(Permission.AUDIT_READ_OPERATIONAL),
      },
    ],
  },
  {
    section: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users & roles', icon: Users, visible: (can) => can(Permission.USERS_MANAGE) },
      { href: '/admin/workflows', label: 'Workflows', icon: Settings2, visible: (can) => can(Permission.WORKFLOWS_READ) || can(Permission.WORKFLOWS_MANAGE) },
      { href: '/admin/integrations', label: 'Integrations', icon: PlugZap, visible: (can) => can(Permission.INTEGRATIONS_READ) },
    ],
  },
];

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains('dark')), []);
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('orchestra-theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
    setDark(next);
  };
  return { dark, toggle };
}

function NotificationsMenu() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data } = useQuery({
    queryKey: ['notifications', 'menu'],
    queryFn: () => api<Paginated<NotificationView> & { unread: number }>('/notifications', { query: { pageSize: 8 } }),
    refetchInterval: 15_000,
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const open = async (notification: NotificationView) => {
    if (!notification.isRead) {
      await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (notification.link) router.push(notification.link);
  };
  const unread = data?.unread ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${unread} unread)`} className="relative">
          <Bell />
          {unread > 0 ? (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <button className="text-xs text-primary hover:underline" onClick={() => markAll.mutate()}>
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {data?.data.length ? (
          data.data.map((notification) => (
            <DropdownMenuItem key={notification.id} onSelect={() => void open(notification)} className="flex-col items-start gap-0.5">
              <span className={cn('text-sm', !notification.isRead && 'font-semibold')}>{notification.title}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
              <span className="text-[11px] text-muted-foreground">{formatRelative(notification.createdAt)}</span>
            </DropdownMenuItem>
          ))
        ) : (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No notifications</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm">
            View all
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, can, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  useEffect(() => setMobileOpen(false), [pathname]);

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 px-3 py-4">
      <Link href="/dashboard" className="flex items-center gap-2 px-2 text-sidebar-accent-foreground">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Workflow className="size-4" />
        </span>
        <span className="font-semibold tracking-tight">Orchestra AI</span>
      </Link>
      {NAV.map((group) => {
        const items = group.items.filter((item) => item.visible((permission) => can(permission)));
        if (items.length === 0) return null;
        return (
          <div key={group.section} className="space-y-1">
            <p className="px-2 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{group.section}</p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        );
      })}
      <div className="mt-auto rounded-lg border border-sidebar-border px-3 py-2 text-xs text-sidebar-muted">
        Signed in as <span className="text-sidebar-accent-foreground">{user.roles.map((role) => ROLE_LABELS[role]).join(', ')}</span>
        {user.department ? <div>{user.department.name}</div> : null}
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">{sidebar}</aside>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar">
            <button className="absolute top-3 right-3 text-sidebar-foreground" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label="Toggle theme">
            {theme.dark ? <Sun /> : <Moon />}
          </Button>
          <NotificationsMenu />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2" data-testid="user-menu">
                <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {user.name
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <span className="hidden text-sm sm:inline">{user.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div>{user.name}</div>
                <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <UserRound /> Profile
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()} data-testid="logout">
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
