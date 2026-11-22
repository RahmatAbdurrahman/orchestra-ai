'use client';

import { Permission, ROLE_LABELS } from '@orchestra/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Bot,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PlugZap,
  ScrollText,
  Settings2,
  Sun,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip,
  TooltipProvider,
} from '@/components/ui/overlays';
import { Atmosphere, type AtmosphereMotif, type AtmosphereVariant } from '@/components/atmosphere';
import { OrchestraSymbol, Wordmark } from '@/components/brand';
import { BRAND } from '@/lib/brand-art';
import { RoleBadge } from '@/components/status-badge';
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
    const root = document.documentElement;
    // Cross-fade colours for one transition, then remove so normal interactions are unaffected.
    root.classList.add('theme-transition');
    root.classList.toggle('dark', next);
    window.setTimeout(() => root.classList.remove('theme-transition'), 250);
    try {
      localStorage.setItem('orchestra-theme', next ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
    setDark(next);
  };
  return { dark, toggle };
}

const SIDEBAR_KEY = 'orchestra-sidebar-collapsed';

function useCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === '1');
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () =>
    setCollapsed((current) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, current ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !current;
    });
  return { collapsed, toggle };
}

/** Title shown in the top bar for the current route (presentation only). */
function pageContext(pathname: string): { title: string; parent?: { href: string; label: string } } {
  if (pathname === '/requests/new') return { title: 'New request', parent: { href: '/requests', label: 'Purchase requests' } };
  if (/^\/requests\/[^/]+$/.test(pathname)) return { title: 'Request detail', parent: { href: '/requests', label: 'Purchase requests' } };
  if (/^\/automation\/[^/]+$/.test(pathname)) return { title: 'Job detail', parent: { href: '/automation', label: 'Automation jobs' } };
  if (pathname === '/profile') return { title: 'Profile' };
  if (pathname === '/notifications') return { title: 'Notifications' };
  for (const group of NAV) {
    const item = group.items.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
    if (item) return { title: item.label };
  }
  return { title: 'Orchestra AI' };
}

/**
 * Decoration intensity per module (presentation only): data-dense pages stay subtle, overview and
 * workflow pages get the default treatment with a motif that matches the module.
 */
function atmosphereFor(pathname: string): { variant: AtmosphereVariant; motif: AtmosphereMotif } {
  if (pathname === '/dashboard') return { variant: 'default', motif: 'geometric' };
  if (pathname === '/approvals') return { variant: 'default', motif: 'flow' };
  if (pathname === '/admin/workflows') return { variant: 'default', motif: 'flow' };
  if (pathname === '/automation' || pathname === '/admin/integrations') return { variant: 'default', motif: 'network' };
  if (pathname.startsWith('/automation/')) return { variant: 'subtle', motif: 'network' };
  if (pathname.startsWith('/requests')) return { variant: 'subtle', motif: 'flow' };
  return { variant: 'subtle', motif: 'none' };
}

/** Navigation surface (white in light, deep navy in dark): a cool light source at the top and a fading dot lattice at the bottom. */
function SidebarDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-28 -left-20 size-80 rounded-full bg-[radial-gradient(closest-side,var(--sidebar-glow),transparent)]" />
      <div className="absolute -right-24 top-1/3 size-56 rounded-full bg-[radial-gradient(closest-side,var(--sidebar-glow-2),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-[radial-gradient(circle_at_1px_1px,var(--sidebar-dots)_1px,transparent_0)] bg-[length:18px_18px] [mask-image:linear-gradient(to_top,#000_10%,transparent)]" />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
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
            <span className="absolute top-1 right-1 flex h-4 min-w-4 animate-in items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white ring-2 ring-background zoom-in-50 duration-200">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 ? (
            <button
              className="rounded-sm text-xs font-medium text-primary hover:underline focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="scrollbar-thin max-h-96 overflow-y-auto p-1">
          {data?.data.length ? (
            data.data.map((notification) => (
              <DropdownMenuItem key={notification.id} onSelect={() => void open(notification)} className="items-start gap-2.5 px-2.5 py-2">
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', notification.isRead ? 'bg-transparent' : 'bg-primary')} aria-hidden />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className={cn('block text-sm leading-5', !notification.isRead && 'font-semibold')}>
                    {notification.title}
                    {!notification.isRead ? <span className="sr-only"> (unread)</span> : null}
                  </span>
                  <span className="line-clamp-2 block text-xs leading-4 text-muted-foreground">{notification.message}</span>
                  <span className="block text-[11px] text-subtle-foreground">{formatRelative(notification.createdAt)}</span>
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
              <BellOff className="size-5 text-subtle-foreground" aria-hidden />
              <p className="text-sm font-medium">No notifications</p>
              <p className="text-xs text-muted-foreground">Approvals and automation updates will appear here.</p>
            </div>
          )}
        </div>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1">
          <DropdownMenuItem asChild>
            <Link href="/notifications" className="justify-center text-sm font-medium text-primary">
              View all notifications
            </Link>
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNav({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const { can } = useAuth();
  return (
    <div className="scrollbar-thin flex-1 space-y-6 overflow-x-hidden overflow-y-auto px-3 py-4">
      {NAV.map((group) => {
        const items = group.items.filter((item) => item.visible((permission) => can(permission)));
        if (items.length === 0) return null;
        return (
          <div key={group.section} className="space-y-0.5">
            <p
              className={cn(
                'mb-1.5 h-4 overflow-hidden px-3 text-[11px] font-semibold tracking-wider whitespace-nowrap text-sidebar-muted uppercase transition-opacity duration-200',
                collapsed && 'opacity-0',
              )}
              aria-hidden={collapsed}
            >
              {group.section}
            </p>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Tooltip key={item.href} content={item.label} side="right" disabled={!collapsed}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150 outline-none focus-visible:shadow-[0_0_0_2px_var(--sidebar-indicator)]',
                      active
                        ? 'bg-sidebar-accent text-sidebar-active-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1.5 bottom-1.5 left-0 w-[3px] origin-center rounded-r-full bg-sidebar-indicator transition-transform duration-200 ease-[var(--ease-out)]',
                        active ? 'scale-y-100' : 'scale-y-0',
                      )}
                      aria-hidden
                    />
                    <item.icon
                      className={cn(
                        'size-[18px] shrink-0 transition-[color,transform] duration-200 group-hover:scale-110',
                        active ? 'text-sidebar-indicator' : 'text-sidebar-muted group-hover:text-sidebar-accent-foreground',
                      )}
                      aria-hidden
                    />
                    <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
                  </Link>
                </Tooltip>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      href="/dashboard"
      aria-label="Orchestra AI, go to the dashboard"
      className="group/brand flex h-16 shrink-0 items-center gap-2.5 overflow-hidden px-5 text-sidebar-accent-foreground outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--sidebar-indicator)]"
    >
      <OrchestraSymbol className="size-8 transition-transform duration-300 group-hover/brand:rotate-[-8deg]" />
      <span className={cn('min-w-0 whitespace-nowrap', collapsed && 'sr-only')}>
        <Wordmark className="block text-[15px] leading-5" />
        <span className="block text-[11px] leading-4 text-sidebar-muted">{BRAND.taglineShort}</span>
      </span>
    </Link>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { user } = useAuth();
  const roles = user.roles.map((role) => ROLE_LABELS[role]).join(', ');
  return (
    <div className="shrink-0 border-t border-sidebar-border p-3">
      <div className="flex items-center gap-2.5 overflow-hidden rounded-md px-1.5 py-1" title={collapsed ? `${user.name} · ${roles}` : undefined}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground ring-1 ring-sidebar-border">
          {initials(user.name)}
        </span>
        <span className={cn('min-w-0 text-xs whitespace-nowrap', collapsed && 'sr-only')}>
          <span className="block truncate font-medium text-sidebar-accent-foreground">Signed in as {roles}</span>
          <span className="block truncate text-sidebar-muted">{user.department?.name ?? 'No department'}</span>
        </span>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const theme = useTheme();
  const sidebar = useCollapsed();
  const context = pageContext(pathname);
  const atmosphere = atmosphereFor(pathname);
  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            'sticky top-0 isolate hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar shadow-[6px_0_24px_-18px_rgb(30_58_138/0.18)] transition-[width] duration-[220ms] ease-[var(--ease-out)] lg:flex dark:shadow-none',
            sidebar.collapsed ? 'w-[72px]' : 'w-64',
          )}
          aria-label="Main navigation"
        >
          <SidebarDecor />
          <Brand collapsed={sidebar.collapsed} />
          <SidebarNav collapsed={sidebar.collapsed} pathname={pathname} />
          <SidebarFooter collapsed={sidebar.collapsed} />
        </aside>

        {/* Mobile drawer: always mounted so it can slide; inert while closed */}
        <div className={cn('fixed inset-0 z-40 lg:hidden', !mobileOpen && 'pointer-events-none')} inert={!mobileOpen}>
          <div
            className={cn('absolute inset-0 bg-overlay transition-opacity duration-200', mobileOpen ? 'opacity-100' : 'opacity-0')}
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside
            className={cn(
              'absolute inset-y-0 left-0 isolate flex w-72 max-w-[85vw] flex-col bg-sidebar shadow-lg transition-transform duration-[220ms] ease-[var(--ease-out)]',
              mobileOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            aria-label="Mobile navigation"
          >
            <SidebarDecor />
            <button
              className="absolute top-4 right-3 flex size-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-accent focus-visible:shadow-[0_0_0_2px_var(--sidebar-indicator)] focus-visible:outline-none"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Brand collapsed={false} />
            <SidebarNav collapsed={false} pathname={pathname} />
            <SidebarFooter collapsed={false} />
          </aside>
        </div>

        <div className="relative isolate flex min-w-0 flex-1 flex-col">
          <Atmosphere key={pathname} {...atmosphere} />
          <header className="sticky top-0 z-30 flex h-16 items-center gap-1.5 border-b bg-header px-3 backdrop-blur-sm sm:gap-2 sm:px-6">
            <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileOpen(true)}>
              <Menu />
            </IconButton>
            <Link href="/dashboard" aria-label="Orchestra AI, go to the dashboard" className="rounded-md p-0.5 outline-none focus-visible:shadow-[var(--focus-ring)] lg:hidden">
              <OrchestraSymbol className="size-7" />
            </Link>
            <IconButton
              label={sidebar.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden lg:inline-flex"
              onClick={sidebar.toggle}
              aria-expanded={!sidebar.collapsed}
            >
              {sidebar.collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
            <div className="mx-1 hidden h-5 w-px bg-border lg:block" aria-hidden />
            <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                {context.parent ? (
                  <>
                    <li className="hidden min-w-0 sm:block">
                      <Link href={context.parent.href} className="truncate text-muted-foreground transition-colors hover:text-foreground">
                        {context.parent.label}
                      </Link>
                    </li>
                    <li className="hidden text-subtle-foreground sm:block" aria-hidden>
                      <ChevronRight className="size-3.5" />
                    </li>
                  </>
                ) : null}
                <li className="truncate font-semibold tracking-tight" aria-current="page">
                  {context.title}
                </li>
              </ol>
            </nav>
            <IconButton label={theme.dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={theme.toggle}>
              <span className="relative size-4">
                <Sun
                  className={cn(
                    'absolute inset-0 transition-[opacity,transform] duration-200',
                    theme.dark ? 'scale-100 rotate-0 opacity-100' : 'scale-50 -rotate-90 opacity-0',
                  )}
                />
                <Moon
                  className={cn(
                    'absolute inset-0 transition-[opacity,transform] duration-200',
                    theme.dark ? 'scale-50 rotate-90 opacity-0' : 'scale-100 rotate-0 opacity-100',
                  )}
                />
              </span>
            </IconButton>
            <NotificationsMenu />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 pr-2 pl-1.5" data-testid="user-menu" aria-label={`Account menu for ${user.name}`}>
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-[11px] font-semibold text-primary ring-1 ring-primary/20 dark:text-info-foreground">
                    {initials(user.name)}
                  </span>
                  <span className="hidden max-w-40 truncate text-sm font-medium md:inline">{user.name}</span>
                  <ChevronDown className="hidden size-3.5 text-muted-foreground md:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="space-y-0.5 py-2">
                  <div className="truncate">{user.name}</div>
                  <div className="truncate text-xs font-normal text-muted-foreground">{user.email}</div>
                  <div className="flex flex-wrap gap-1 pt-1.5">
                    {user.roles.map((role) => (
                      <RoleBadge key={role} role={role} />
                    ))}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/profile">
                    <UserRound /> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/notifications">
                    <Bell /> Notifications
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void logout()} data-testid="logout" className="text-destructive-foreground focus:text-destructive-foreground">
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div key={pathname} className="animate-page-in">
              {children}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
