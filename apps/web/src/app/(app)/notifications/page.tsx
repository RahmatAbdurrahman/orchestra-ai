'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import type { NotificationView, Paginated } from '@/lib/types';
import { cn } from '@/lib/utils';

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
        title="Notifications"
        description={notifications.data ? (notifications.data.unread ? `${notifications.data.unread} unread` : 'All caught up') : undefined}
        actions={<Button variant="outline" onClick={() => markAll.mutate()} disabled={!notifications.data?.unread || markAll.isPending}><CheckCheck /> Mark all read</Button>}
      />
      {notifications.error ? <ErrorBlock error={notifications.error} onRetry={() => void notifications.refetch()} /> : null}
      {notifications.isLoading ? <LoadingBlock rows={6} label="Loading notifications" /> : null}
      {notifications.data?.data.length === 0 ? (
        <EmptyState icon={BellOff} title="No notifications" description="Approval requests, decisions and automation results addressed to you will appear here." />
      ) : null}
      {notifications.data?.data.length ? (
        <Card className="stagger divide-y overflow-hidden">
          {notifications.data.data.map((notification) => (
            <button
              key={notification.id}
              className={cn(
                'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none',
                !notification.isRead && 'bg-primary/[0.04]',
              )}
              onClick={async () => {
                if (!notification.isRead) await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => undefined);
                void queryClient.invalidateQueries({ queryKey: ['notifications'] });
                if (notification.link) router.push(notification.link);
              }}
            >
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', notification.isRead ? 'bg-border-strong' : 'bg-primary')} aria-hidden />
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
