import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@orchestra/domain';
import type { Request } from 'express';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC_KEY = 'orchestra:isPublic';
export const PERMISSIONS_KEY = 'orchestra:permissions';
export const ANY_PERMISSION_KEY = 'orchestra:anyPermission';

/** Route does not require an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** All listed permissions are required (checked by PermissionsGuard on the server). */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** At least one of the listed permissions is required. */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSION_KEY, permissions);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthUser => {
  const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!request.user) throw new Error('CurrentUser used on a route without authentication');
  return request.user;
});
