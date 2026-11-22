'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { NotificationType } from '@orchestra/domain';
import { Bell, BellOff, Bot, CheckCheck, CheckCircle2, FileScan, Hourglass, Info, XCircle, type LucideIcon } from 'lucide-react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { NotificationView, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Icon per notification type (from the notification itself); the title states what happened. */
const TYPE_STYLE: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  INFO: { icon: Info, className: 'bg-muted text-muted-foreground' },
  APPROVAL_REQUIRED: { icon: Hourglass, className: 'bg-warning-soft text-warning-foreground' },
  REQUEST_APPROVED: { icon: CheckCircle2, className: 'bg-success-soft text-success-foreground' },
  REQUEST_REJECTED: { icon: XCircle, className: 'bg-destructive-soft text-destructive-foreground' },
  DOCUMENT_PROCESSED: { icon: FileScan, className: 'bg-info-soft text-info-foreground' },
  AUTOMATION_COMPLETED: { icon: Bot, className: 'bg-success-soft text-success-foreground' },
  AUTOMATION_FAILED: { icon: Bot, className: 'bg-destructive-soft text-destructive-foreground' },
};

function NotificationIcon({ type, unread }: { type: NotificationType; unread: boolean }) {
  const style = TYPE_STYLE[type] ?? TYPE_STYLE.INFO;
  return (
    <span aria-hidden className={cn('relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', style.className)}>
      <style.icon className="size-4" />
      {unread ? <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-card" /> : null}
    </span>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const notifications = useQuery({
    queryKey: ['notifications', 'page', page],
    queryFn: () => api<Paginated<NotificationView> & { unread: number }>('/notifications', { query: { page, pageSize: 20 } }),
  });
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <>
      <PageHeader
        icon={Bell}
        title="Notifications"
        description={notifications.data ? (notifications.data.unread ? `${notifications.data.unread} unread` : 'All caught up') : undefined}
        actions={<Button variant="outline" onClick={() => markAll.mutate()} disabled={!notifications.data?.unread || markAll.isPending}><CheckCheck /> Mark all read</Button>}
      />
      {notifications.error ? <ErrorBlock error={notifications.error} onRetry={() => void notifications.refetch()} /> : null}
      {notifications.isLoading ? <LoadingBlock rows={6} label="Loading notifications" /> : null}
      {notifications.data?.data.length === 0 ? (
        <EmptyState mascot="default" icon={BellOff} title="No notifications" description="Approval requests, decisions and automation results addressed to you will appear here." />
      ) : null}
      {notifications.data?.data.length ? (
        <Card className="stagger divide-y overflow-hidden">
          {notifications.data.data.map((notification) => (
            <button
              key={notification.id}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-row-hover focus-visible:bg-row-hover focus-visible:outline-none',
                !notification.isRead && 'bg-primary/[0.04]',
              )}
              onClick={async () => {
                if (!notification.isRead) await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => undefined);
                void queryClient.invalidateQueries({ queryKey: ['notifications'] });
                if (notification.link) router.push(notification.link);
              }}
            >
              <NotificationIcon type={notification.type} unread={!notification.isRead} />
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className={cn('block text-sm', !notification.isRead && 'font-semibold')}>
                  {notification.title}
                  {!notification.isRead ? <span className="sr-only"> (unread)</span> : null}
                </span>
                <span className="block text-sm text-muted-foreground">{notification.message}</span>
              </span>
              <span className="shrink-0 text-xs text-subtle-foreground" title={formatDateTime(notification.createdAt)}>
                {formatRelative(notification.createdAt)}
              </span>
            </button>
          ))}
        </Card>
      ) : null}
      {notifications.data ? <Pager page={page} totalPages={notifications.data.meta.totalPages} total={notifications.data.meta.total} onChange={setPage} /> : null}
    </>
  );
}
