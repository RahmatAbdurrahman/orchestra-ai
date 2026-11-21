import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { permissionsForRoles, type RoleName } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma.service';

const LAST_SEEN_RESOLUTION_MS = 5 * 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Opaque, server-side sessions. The browser only holds a random token in an
 * HttpOnly cookie; the database stores its SHA-256 hash. Sessions can be
 * revoked (logout, deactivation, password change) immediately.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, meta: { ipAddress: string | null; userAgent: string | null }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.session.ttlMs);
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 512) ?? null,
      },
    });
    return { token, expiresAt };
  }

  async authenticate(token: string): Promise<AuthUser | null> {
    if (token.length < 20 || token.length > 200) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.isActive) return null;
    if (now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
    }
    const roles = session.user.roles.map((assignment) => assignment.role.name as RoleName);
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      departmentId: session.user.departmentId,
      roles,
      permissions: permissionsForRoles(roles, this.config.rbac),
      sessionId: session.id,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }
}
