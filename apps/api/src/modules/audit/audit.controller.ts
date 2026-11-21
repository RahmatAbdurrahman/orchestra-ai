import { Controller, ForbiddenException, Get, Injectable, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Prisma } from '@orchestra/database';
import { AuditEntity, auditAccessScope, hasAnyAuditAccess, Permission } from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireAnyPermission } from '../../common/decorators';
import { pageParams, paginated, PaginationQueryDto } from '../../common/pagination';
import { PrismaService } from '../../infrastructure/prisma.service';
import { RequestAccessService } from '../purchase-requests/request-access.service';

export class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  purchaseRequestId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ example: 'APPROVAL.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;
}

const OPERATIONAL_ENTITIES = [AuditEntity.AUTOMATION_JOB, AuditEntity.INTEGRATION];

/**
 * Read-only access to the append-only audit trail, scoped per the PRD matrix:
 * all (admin, viewer), own activity (requester), relevant activity (approver),
 * operational events (operator).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RequestAccessService,
  ) {}

  async scopeWhere(user: AuthUser): Promise<Prisma.AuditLogWhereInput> {
    const scope = auditAccessScope(user.permissions);
    if (!hasAnyAuditAccess(scope)) throw new ForbiddenException('You do not have access to the audit trail');
    if (scope.all) return {};
    const or: Prisma.AuditLogWhereInput[] = [];
    if (scope.own || scope.relevant) or.push({ actorId: user.id });
    if (scope.relevant) {
      const ids = await this.access.readableIds(user);
      if (ids && ids.length > 0) or.push({ purchaseRequestId: { in: ids } });
    }
    if (scope.operational) {
      or.push({ entityType: { in: OPERATIONAL_ENTITIES } });
      or.push({ action: { startsWith: 'AUTOMATION.' } });
    }
    return { OR: or };
  }

  async query(user: AuthUser, query: AuditQueryDto) {
    const { page, pageSize, skip, take } = pageParams(query);
    const where: Prisma.AuditLogWhereInput = {
      AND: [
        await this.scopeWhere(user),
        query.entityType ? { entityType: query.entityType } : {},
        query.entityId ? { entityId: query.entityId } : {},
        query.purchaseRequestId ? { purchaseRequestId: query.purchaseRequestId } : {},
        query.actorId ? { actorId: query.actorId } : {},
        query.action ? { action: { startsWith: query.action } } : {},
        query.from || query.to
          ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
          : {},
      ],
    };
    const showNetwork = user.permissions.has(Permission.USERS_MANAGE);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginated(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        purchaseRequestId: row.purchaseRequestId,
        actorType: row.actorType,
        actor: row.actor,
        oldValue: row.oldValue,
        newValue: row.newValue,
        metadata: row.metadata,
        correlationId: row.correlationId,
        ipAddress: showNetwork ? row.ipAddress : undefined,
        createdAt: row.createdAt,
      })),
      total,
      page,
      pageSize,
    );
  }
}

@ApiTags('Audit')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireAnyPermission(
    Permission.AUDIT_READ_ALL,
    Permission.AUDIT_READ_OWN,
    Permission.AUDIT_READ_RELEVANT,
    Permission.AUDIT_READ_OPERATIONAL,
  )
  @ApiOperation({ summary: 'Query the audit trail (scoped by role)' })
  query(@CurrentUser() user: AuthUser, @Query() query: AuditQueryDto) {
    return this.audit.query(user, query);
  }
}
