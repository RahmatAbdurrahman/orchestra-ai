import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@orchestra/database';
import { isUniqueConstraintError } from '@orchestra/database';
import { runInTransaction, writeAudit } from '@orchestra/core';
import { AuditAction, AuditEntity, type RoleName } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { pageParams, paginated } from '../../common/pagination';
import { actorFor } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import type { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './users.dto';

const USER_INCLUDE = {
  department: { select: { id: true, code: true, name: true } },
  roles: { include: { role: { select: { name: true } } } },
} as const satisfies Prisma.UserInclude;

type UserWithRelations = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

function present(user: UserWithRelations) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isActive: user.isActive,
    department: user.department,
    roles: user.roles.map((assignment) => assignment.role.name),
    lastLoginAt: user.lastLoginAt,
    lockedUntil: user.lockedUntil,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async list(query: ListUsersQueryDto) {
    const { page, pageSize, skip, take } = pageParams(query);
    const where: Prisma.UserWhereInput = {
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.role ? { roles: { some: { role: { name: query.role } } } } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, include: USER_INCLUDE, orderBy: { name: 'asc' }, skip, take }),
      this.prisma.user.count({ where }),
    ]);
    return paginated(rows.map(present), total, page, pageSize);
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) throw new NotFoundException('User not found');
    return present(user);
  }

  async create(actor: AuthUser, input: CreateUserDto) {
    const policyError = this.passwords.validatePolicy(input.password);
    if (policyError) throw new UnprocessableEntityException(policyError);
    const passwordHash = await this.passwords.hash(input.password);
    const roleIds = await this.roleIds(input.roles);
    try {
      const user = await runInTransaction(this.prisma, async (tx) => {
        const created = await tx.user.create({
          data: {
            name: input.name.trim(),
            email: input.email.trim().toLowerCase(),
            passwordHash,
            departmentId: input.departmentId ?? null,
            roles: { create: roleIds.map((roleId) => ({ roleId })) },
          },
          include: USER_INCLUDE,
        });
        await writeAudit(tx, actorFor(actor), {
          action: AuditAction.USER_CREATED,
          entityType: AuditEntity.USER,
          entityId: created.id,
          newValue: { name: created.name, email: created.email, roles: input.roles, departmentId: created.departmentId },
        });
        return created;
      });
      return present(user);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('A user with this email already exists');
      throw error;
    }
  }

  async update(actor: AuthUser, id: string, input: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!existing) throw new NotFoundException('User not found');
    const existingRoles = existing.roles.map((assignment) => assignment.role.name);

    if (id === actor.id) {
      if (input.isActive === false) throw new UnprocessableEntityException('You cannot deactivate your own account');
      if (input.roles && existingRoles.includes('ADMIN') && !input.roles.includes('ADMIN')) {
        throw new UnprocessableEntityException('You cannot remove your own administrator role');
      }
    }
    let passwordHash: string | undefined;
    if (input.password) {
      const policyError = this.passwords.validatePolicy(input.password);
      if (policyError) throw new UnprocessableEntityException(policyError);
      passwordHash = await this.passwords.hash(input.password);
    }
    const roleIds = input.roles ? await this.roleIds(input.roles) : null;

    const updated = await runInTransaction(this.prisma, async (tx) => {
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(input.name ? { name: input.name.trim() } : {}),
          ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(passwordHash ? { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } : {}),
        },
        include: USER_INCLUDE,
      });
      const action =
        input.isActive === false && existing.isActive
          ? AuditAction.USER_DEACTIVATED
          : input.isActive === true && !existing.isActive
            ? AuditAction.USER_ACTIVATED
            : AuditAction.USER_UPDATED;
      await writeAudit(tx, actorFor(actor), {
        action,
        entityType: AuditEntity.USER,
        entityId: id,
        oldValue: { name: existing.name, departmentId: existing.departmentId, roles: existingRoles, isActive: existing.isActive },
        newValue: {
          name: user.name,
          departmentId: user.departmentId,
          roles: user.roles.map((assignment) => assignment.role.name),
          isActive: user.isActive,
          passwordReset: Boolean(passwordHash),
        },
      });
      return user;
    });
    if (input.isActive === false || passwordHash) await this.sessions.revokeAllForUser(id);
    return present(updated);
  }

  /** Users are never hard-deleted (they are referenced by requests and the audit trail). */
  async deactivate(actor: AuthUser, id: string) {
    return this.update(actor, id, { isActive: false });
  }

  private async roleIds(roles: RoleName[]): Promise<string[]> {
    const rows = await this.prisma.role.findMany({ where: { name: { in: roles } } });
    if (rows.length !== roles.length) throw new UnprocessableEntityException('Unknown role');
    return rows.map((row) => row.id);
  }
}
