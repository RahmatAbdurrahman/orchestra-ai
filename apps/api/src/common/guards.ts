import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@orchestra/domain';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SessionService } from '../modules/auth/session.service';
import type { AuthUser } from './auth-user';
import { ANY_PERMISSION_KEY, IS_PUBLIC_KEY, PERMISSIONS_KEY } from './decorators';

type AuthenticatedRequest = Request & { user?: AuthUser };

/** Global guard: every route requires a valid server-side session unless marked @Public(). */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[this.config.session.cookieName];
    if (!token) throw new UnauthorizedException('Authentication required');
    const user = await this.sessions.authenticate(token);
    if (!user) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    request.user = user;
    return true;
  }
}

/**
 * Global guard: enforces @RequirePermissions / @RequireAnyPermission on the
 * server. Hiding buttons in the frontend is never relied upon for security.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const all = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    const any = this.reflector.getAllAndOverride<Permission[] | undefined>(ANY_PERMISSION_KEY, targets) ?? [];
    if (all.length === 0 && any.length === 0) return true;
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) return false;
    const hasAll = all.every((permission) => user.permissions.has(permission));
    const hasAny = any.length === 0 || any.some((permission) => user.permissions.has(permission));
    if (!hasAll || !hasAny) throw new ForbiddenException('You do not have permission to perform this action');
    return true;
  }
}
