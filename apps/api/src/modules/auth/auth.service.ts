import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { writeAudit } from '@orchestra/core';
import { AuditAction, AuditEntity, type RoleName } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { actorFor, anonymousActor, RequestContext } from '../../common/request-context';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PrismaService } from '../../infrastructure/prisma.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    const now = new Date();

    if (!user) {
      await this.passwords.verifyAgainstDummy(password);
      await writeAudit(this.prisma, anonymousActor(), {
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: AuditEntity.SESSION,
        entityId: 'unknown',
        metadata: { email: normalizedEmail, reason: 'UNKNOWN_EMAIL' },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.lockedUntil && user.lockedUntil > now) {
      await writeAudit(this.prisma, anonymousActor(), {
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: AuditEntity.USER,
        entityId: user.id,
        metadata: { reason: 'LOCKED' },
      });
      throw new HttpException(
        { message: 'Too many failed sign-in attempts. Try again later.', code: 'ACCOUNT_LOCKED' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid || !user.isActive) {
      const failedLoginCount = valid ? user.failedLoginCount : user.failedLoginCount + 1;
      const lock = failedLoginCount >= this.config.login.maxFailedAttempts;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failedLoginCount,
          lockedUntil: lock ? new Date(now.getTime() + this.config.login.lockoutMs) : user.lockedUntil,
        },
      });
      await writeAudit(this.prisma, anonymousActor(), {
        action: AuditAction.AUTH_LOGIN_FAILED,
        entityType: AuditEntity.USER,
        entityId: user.id,
        metadata: { reason: !user.isActive ? 'INACTIVE' : 'BAD_PASSWORD', locked: lock },
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.startSession(user.id, now);
  }

  /** Seeded accounts offered as one-click sign-in on the login page (simulation only). */
  async demoAccounts() {
    this.assertDemoLoginEnabled();
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      orderBy: { email: 'asc' },
      select: {
        email: true,
        name: true,
        department: { select: { code: true, name: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    return users.map((user) => ({
      email: user.email,
      name: user.name,
      department: user.department,
      roles: user.roles.map((entry) => entry.role.name as RoleName),
    }));
  }

  /** Signs in as an active account without a password. Disabled unless DEMO_LOGIN_ENABLED=true (never in production). */
  async demoLogin(email: string) {
    this.assertDemoLoginEnabled();
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user || !user.isActive) throw new UnauthorizedException(INVALID_CREDENTIALS);
    return this.startSession(user.id, new Date(), { method: 'DEMO' });
  }

  private assertDemoLoginEnabled(): void {
    if (!this.config.demoLoginEnabled) throw new NotFoundException();
  }

  private async startSession(userId: string, now: Date, metadata?: Record<string, string>) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    const context = RequestContext.get();
    const session = await this.sessions.create(userId, {
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });
    await writeAudit(
      this.prisma,
      {
        actorId: userId,
        actorType: 'USER',
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        correlationId: context?.correlationId ?? null,
      },
      { action: AuditAction.AUTH_LOGIN_SUCCEEDED, entityType: AuditEntity.USER, entityId: userId, metadata },
    );
    return session;
  }

  async logout(user: AuthUser): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    await writeAudit(this.prisma, actorFor(user), {
      action: AuditAction.AUTH_LOGOUT,
      entityType: AuditEntity.USER,
      entityId: user.id,
    });
  }

  async profile(user: AuthUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { department: { select: { id: true, code: true, name: true, isFinance: true } } },
    });
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      department: record.department,
      roles: user.roles as RoleName[],
      permissions: [...user.permissions].sort(),
      lastLoginAt: record.lastLoginAt,
      policy: {
        adminCanApprove: this.config.rbac.adminCanApprove,
        adminCanOperateAutomation: this.config.rbac.adminCanOperateAutomation,
      },
    };
  }

  async updateProfile(user: AuthUser, input: { name?: string; currentPassword?: string; newPassword?: string }) {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const data: { name?: string; passwordHash?: string; passwordChangedAt?: Date } = {};
    if (input.name && input.name.trim() !== record.name) data.name = input.name.trim();
    if (input.newPassword) {
      if (!input.currentPassword || !(await this.passwords.verify(record.passwordHash, input.currentPassword))) {
        throw new UnprocessableEntityException('The current password is incorrect');
      }
      const policyError = this.passwords.validatePolicy(input.newPassword);
      if (policyError) throw new UnprocessableEntityException(policyError);
      data.passwordHash = await this.passwords.hash(input.newPassword);
      data.passwordChangedAt = new Date();
    }
    if (Object.keys(data).length > 0) {
      await this.prisma.user.update({ where: { id: user.id }, data });
      if (data.passwordHash) {
        await this.sessions.revokeAllForUser(user.id, user.sessionId);
        await writeAudit(this.prisma, actorFor(user), {
          action: AuditAction.AUTH_PASSWORD_CHANGED,
          entityType: AuditEntity.USER,
          entityId: user.id,
        });
      }
      if (data.name) {
        await writeAudit(this.prisma, actorFor(user), {
          action: AuditAction.USER_UPDATED,
          entityType: AuditEntity.USER,
          entityId: user.id,
          oldValue: { name: record.name },
          newValue: { name: data.name },
        });
      }
    }
    return this.profile({ ...user, name: data.name ?? user.name });
  }
}
