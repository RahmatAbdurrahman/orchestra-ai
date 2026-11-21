'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EmptyState, LoadingBlock, PageHeader, Pager } from '@/components/page';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
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
        description={notifications.data ? `${notifications.data.unread} unread` : undefined}
        actions={<Button variant="outline" onClick={() => markAll.mutate()} disabled={!notifications.data?.unread}>Mark all read</Button>}
      />
      {notifications.isLoading ? <LoadingBlock rows={6} /> : null}
      {notifications.data?.data.length === 0 ? <EmptyState title="No notifications" /> : null}
      <Card className="divide-y">
        {notifications.data?.data.map((notification) => (
          <button
            key={notification.id}
            className={cn('flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left hover:bg-muted/40', !notification.isRead && 'bg-primary/5')}
            onClick={async () => {
              if (!notification.isRead) await api(`/notifications/${notification.id}/read`, { method: 'POST' }).catch(() => undefined);
              void queryClient.invalidateQueries({ queryKey: ['notifications'] });
              if (notification.link) router.push(notification.link);
            }}
          >
            <span className={cn('text-sm', !notification.isRead && 'font-semibold')}>{notification.title}</span>
            <span className="text-sm text-muted-foreground">{notification.message}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(notification.createdAt)}</span>
          </button>
        ))}
      </Card>
      {notifications.data ? <Pager page={page} totalPages={notifications.data.meta.totalPages} total={notifications.data.meta.total} onChange={setPage} /> : null}
    </>
  );
}
