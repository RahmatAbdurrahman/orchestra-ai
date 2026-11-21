import type { DbClient } from '@orchestra/database';
import type { NotificationType, RoleName } from '@orchestra/domain';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
}

export async function notifyUsers(
  db: DbClient,
  userIds: readonly (string | null | undefined)[],
  notification: NotificationInput,
): Promise<number> {
  const recipients = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (recipients.length === 0) return 0;
  const result = await db.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: notification.type,
      title: notification.title.slice(0, 200),
      message: notification.message,
      link: notification.link ?? null,
    })),
  });
  return result.count;
}

/** Active users holding a role, optionally limited to one department. */
export async function findActiveUserIdsWithRole(
  db: DbClient,
  role: RoleName,
  departmentId?: string | null,
): Promise<string[]> {
  const users = await db.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { name: role } } },
      ...(departmentId ? { departmentId } : {}),
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
