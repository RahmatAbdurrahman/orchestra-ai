import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { isUniqueConstraintError, type Prisma } from '@orchestra/database';
import { runInTransaction, writeAudit } from '@orchestra/core';
import {
  AuditAction,
  AuditEntity,
  DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION,
  Permission,
  safeParseWorkflowConfiguration,
  WORKFLOW_TYPES,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequireAnyPermission, RequirePermissions } from '../../common/decorators';
import { actorFor } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';

class CreateWorkflowDto {
  @ApiProperty({ example: 'purchase-request-to-po-it' })
  @IsString()
  @Matches(/^[a-z0-9-]{3,80}$/)
  key: string;

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: WORKFLOW_TYPES })
  @IsIn(WORKFLOW_TYPES as unknown as string[])
  workflowType: string;

  @ApiPropertyOptional({ description: 'Workflow configuration; defaults to the Purchase Request template' })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

class UpdateWorkflowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'New configuration; creates a new immutable version' })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  changeNote?: string;
}

class SetActiveDto {
  @ApiProperty()
  @IsBoolean()
  isActive: boolean;
}

function validateConfiguration(raw: unknown) {
  const parsed = safeParseWorkflowConfiguration(raw);
  if (!parsed.success) {
    throw new UnprocessableEntityException({
      message: 'Invalid workflow configuration',
      code: 'VALIDATION_FAILED',
      details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
  }
  return parsed.data;
}

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.workflow.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { purchaseRequests: true } } },
    });
  }

  async get(id: string) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: { id: true, version: true, changeNote: true, createdAt: true, createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }

  async create(user: AuthUser, input: CreateWorkflowDto) {
    const configuration = validateConfiguration(input.configuration ?? DEFAULT_PURCHASE_WORKFLOW_CONFIGURATION);
    const json = configuration as unknown as Prisma.InputJsonValue;
    try {
      return await runInTransaction(this.prisma, async (tx) => {
        const workflow = await tx.workflow.create({
          data: {
            key: input.key,
            name: input.name,
            description: input.description ?? null,
            workflowType: input.workflowType,
            configuration: json,
            version: 1,
            versions: { create: { version: 1, configuration: json, changeNote: 'Created', createdById: user.id } },
          },
        });
        await writeAudit(tx, actorFor(user), {
          action: AuditAction.WORKFLOW_CREATED,
          entityType: AuditEntity.WORKFLOW,
          entityId: workflow.id,
          newValue: { key: workflow.key, name: workflow.name, version: 1 },
        });
        return workflow;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('A workflow with this key already exists');
      throw error;
    }
  }

  async update(user: AuthUser, id: string, input: UpdateWorkflowDto) {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    const configuration = input.configuration ? validateConfiguration(input.configuration) : null;
    return runInTransaction(this.prisma, async (tx) => {
      const nextVersion = configuration ? existing.version + 1 : existing.version;
      const updated = await tx.workflow.updateMany({
        where: { id, version: existing.version },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(configuration ? { configuration: configuration as unknown as Prisma.InputJsonValue, version: nextVersion } : {}),
        },
      });
      if (updated.count !== 1) throw new ConflictException('The workflow was changed by someone else. Reload and try again.');
      if (configuration) {
        await tx.workflowVersion.create({
          data: {
            workflowId: id,
            version: nextVersion,
            configuration: configuration as unknown as Prisma.InputJsonValue,
            changeNote: input.changeNote ?? null,
            createdById: user.id,
          },
        });
      }
      await writeAudit(tx, actorFor(user), {
        action: AuditAction.WORKFLOW_UPDATED,
        entityType: AuditEntity.WORKFLOW,
        entityId: id,
        oldValue: { name: existing.name, version: existing.version },
        newValue: { name: input.name ?? existing.name, version: nextVersion },
        metadata: { changeNote: input.changeNote ?? null, configurationChanged: Boolean(configuration) },
      });
      return tx.workflow.findUniqueOrThrow({ where: { id } });
    });
  }

  async setActive(user: AuthUser, id: string, isActive: boolean) {
    const existing = await this.prisma.workflow.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Workflow not found');
    const workflow = await this.prisma.workflow.update({ where: { id }, data: { isActive } });
    await writeAudit(this.prisma, actorFor(user), {
      action: isActive ? AuditAction.WORKFLOW_ACTIVATED : AuditAction.WORKFLOW_DEACTIVATED,
      entityType: AuditEntity.WORKFLOW,
      entityId: id,
      oldValue: { isActive: existing.isActive },
      newValue: { isActive },
    });
    return workflow;
  }
}

@ApiTags('Workflows')
@ApiCookieAuth()
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  @RequireAnyPermission(Permission.WORKFLOWS_READ, Permission.WORKFLOWS_MANAGE)
  @ApiOperation({ summary: 'List workflow templates' })
  list() {
    return this.workflows.list();
  }

  @Get(':id')
  @RequireAnyPermission(Permission.WORKFLOWS_READ, Permission.WORKFLOWS_MANAGE)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.get(id);
  }

  @Post()
  @RequirePermissions(Permission.WORKFLOWS_MANAGE)
  @ApiOperation({ summary: 'Create a workflow from the template (or a custom configuration)' })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateWorkflowDto) {
    return this.workflows.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions(Permission.WORKFLOWS_MANAGE)
  @ApiOperation({ summary: 'Update a workflow; configuration changes create a new version' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateWorkflowDto) {
    return this.workflows.update(user, id, body);
  }

  @Post(':id/activation')
  @HttpCode(200)
  @RequirePermissions(Permission.WORKFLOWS_MANAGE)
  @ApiOperation({ summary: 'Activate or deactivate a workflow' })
  setActive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: SetActiveDto) {
    return this.workflows.setActive(user, id, body.isActive);
  }
}
