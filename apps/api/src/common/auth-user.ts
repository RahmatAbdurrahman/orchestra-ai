import type { Permission, RoleName } from '@orchestra/domain';

/** The authenticated principal attached to every request by the session guard. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  departmentId: string | null;
  roles: RoleName[];
  permissions: ReadonlySet<Permission>;
  sessionId: string;
}

export function hasPermission(user: AuthUser, permission: Permission): boolean {
  return user.permissions.has(permission);
}
