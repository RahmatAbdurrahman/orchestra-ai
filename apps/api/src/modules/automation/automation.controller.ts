import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { Prisma } from '@orchestra/database';
import {
  cancelAutomationJob,
  createAutomationJob,
  loadWorkflowConfiguration,
  lockPurchaseRequest,
  PURCHASE_REQUEST_AUTOMATION_INCLUDE,
  retryAutomationJob,
  runInTransaction,
  type JobQueue,
} from '@orchestra/core';
import { AUTOMATION_JOB_STATUSES, DomainError, Permission, type AutomationJobStatus } from '@orchestra/domain';
import type { RpaExecutionProvider } from '@orchestra/uipath-client';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { pageParams, paginated, PaginationQueryDto } from '../../common/pagination';
import { actorFor, RequestContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';
import { JOB_QUEUE, RPA_PROVIDER } from '../../infrastructure/tokens';

class ListJobsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AUTOMATION_JOB_STATUSES })
  @IsOptional()
  @IsIn(AUTOMATION_JOB_STATUSES as unknown as string[])
  status?: AutomationJobStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  requiresIntervention?: boolean;

  @ApiPropertyOptional({ description: 'Request number or PO number' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}

class RetryDto {
  @ApiPropertyOptional({ example: 'ERP back online after maintenance' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

class CancelJobDto {
  @ApiProperty({ example: 'Purchase order created manually in the ERP' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

class DispatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  purchaseRequestId: string;
}

const JOB_LIST_INCLUDE = {
  purchaseRequest: { select: { id: true, requestNumber: true, title: true, status: true, currency: true, totalAmount: true } },
} as const satisfies Prisma.AutomationJobInclude;

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(RPA_PROVIDER) private readonly rpa: RpaExecutionProvider | null,
  ) {}

  async list(query: ListJobsQueryDto) {
    const { page, pageSize, skip, take } = pageParams(query);
    const where: Prisma.AutomationJobWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.requiresIntervention !== undefined ? { requiresIntervention: query.requiresIntervention } : {}),
      ...(query.search
        ? {
            OR: [
              { poNumber: { contains: query.search, mode: 'insensitive' } },
              { purchaseRequest: { requestNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.automationJob.findMany({ where, include: JOB_LIST_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.automationJob.count({ where }),
    ]);
    return paginated(rows.map((row) => this.presentJob(row)), total, page, pageSize);
  }

  async detail(id: string) {
    const job = await this.prisma.automationJob.findUnique({
      where: { id },
      include: {
        ...JOB_LIST_INCLUDE,
        attempts: { orderBy: { attemptNo: 'asc' } },
        workflow: { select: { id: true, name: true, key: true } },
      },
    });
    if (!job) throw new NotFoundException('Automation job not found');
    return {
      ...this.presentJob(job),
      workflow: job.workflow,
      inputPayload: job.inputPayload,
      outputData: job.outputData,
      attempts: job.attempts,
      integrationMode: (this.rpa as { mode?: string } | null)?.mode ?? 'not-configured',
    };
  }

  async logs(id: string) {
    const exists = await this.prisma.automationJob.count({ where: { id } });
    if (!exists) throw new NotFoundException('Automation job not found');
    return this.prisma.automationLog.findMany({ where: { automationJobId: id }, orderBy: { createdAt: 'asc' }, take: 1000 });
  }

  async retry(user: AuthUser, id: string, reason?: string) {
    await retryAutomationJob(this.prisma, this.queue, { automationJobId: id, actor: actorFor(user), reason: reason ?? null });
    return this.detail(id);
  }

  async cancel(user: AuthUser, id: string, reason: string) {
    await cancelAutomationJob(this.prisma, { automationJobId: id, actor: actorFor(user), reason });
    return this.detail(id);
  }

  /** Manual dispatch for workflows configured with dispatchMode = MANUAL. */
  async dispatch(user: AuthUser, purchaseRequestId: string) {
    const correlationId = RequestContext.correlationId() ?? randomUUID();
    const job = await runInTransaction(this.prisma, async (tx) => {
      await lockPurchaseRequest(tx, purchaseRequestId);
      const request = await tx.purchaseRequest.findUnique({
        where: { id: purchaseRequestId },
        include: { ...PURCHASE_REQUEST_AUTOMATION_INCLUDE, automationJob: { select: { id: true } } },
      });
      if (!request) throw new NotFoundException('Purchase request not found');
      if (request.status !== 'APPROVED') {
        throw new DomainError('PRECONDITION_FAILED', `Only approved requests can be dispatched (request is ${request.status})`);
      }
      if (request.automationJob) throw new DomainError('CONFLICT', 'An automation job already exists for this request');
      const configuration = await loadWorkflowConfiguration(tx, request.workflowId, request.workflowVersion);
      if (!configuration.automation.enabled) {
        throw new DomainError('PRECONDITION_FAILED', 'Automation is disabled for this workflow');
      }
      return createAutomationJob(tx, {
        purchaseRequest: request,
        automation: configuration.automation,
        actor: actorFor(user),
        correlationId,
      });
    });
    try {
      await this.queue.enqueueAutomationSubmit({ automationJobId: job.automationJobId, attemptNo: 1, correlationId });
    } catch (error) {
      this.logger.error(`Enqueue failed; the reconciler will submit the job: ${(error as Error).message}`);
    }
    return this.detail(job.automationJobId);
  }

  private presentJob(job: Prisma.AutomationJobGetPayload<{ include: typeof JOB_LIST_INCLUDE }>) {
    const durationSeconds =
      job.startedAt && job.completedAt ? Math.round((job.completedAt.getTime() - job.startedAt.getTime()) / 1000) : null;
    return {
      id: job.id,
      status: job.status,
      processName: job.processName,
      idempotencyKey: job.idempotencyKey,
      correlationId: job.correlationId,
      attemptCount: job.attemptCount,
      maxAutoAttempts: job.maxAutoAttempts,
      maxTotalAttempts: job.maxTotalAttempts,
      uipathJobId: job.uipathJobId,
      poNumber: job.poNumber,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      requiresIntervention: job.requiresIntervention,
      canRetry: job.status === 'FAILED' && job.attemptCount < job.maxTotalAttempts,
      nextAttemptAt: job.nextAttemptAt,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastPolledAt: job.lastPolledAt,
      durationSeconds,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      purchaseRequest: {
        ...job.purchaseRequest,
        totalAmount: Number(job.purchaseRequest.totalAmount.toString()),
      },
    };
  }
}

@ApiTags('Automation')
@ApiCookieAuth()
@Controller('automation/jobs')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @RequirePermissions(Permission.AUTOMATION_READ)
  @ApiOperation({ summary: 'List UiPath automation jobs' })
  list(@Query() query: ListJobsQueryDto) {
    return this.automation.list(query);
  }

  @Post()
  @RequirePermissions(Permission.AUTOMATION_EXECUTE)
  @ApiOperation({ summary: 'Dispatch an approved request to UiPath (workflows in MANUAL dispatch mode)' })
  dispatch(@CurrentUser() user: AuthUser, @Body() body: DispatchDto) {
    return this.automation.dispatch(user, body.purchaseRequestId);
  }

  @Get(':id')
  @RequirePermissions(Permission.AUTOMATION_READ)
  @ApiOperation({ summary: 'Job detail with every UiPath attempt' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.automation.detail(id);
  }

  @Get(':id/logs')
  @RequirePermissions(Permission.AUTOMATION_READ)
  @ApiOperation({ summary: 'Execution log of the job' })
  logs(@Param('id', ParseUUIDPipe) id: string) {
    return this.automation.logs(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermissions(Permission.AUTOMATION_RETRY)
  @ApiOperation({ summary: 'Retry a failed job (same idempotency key; bounded by the retry limit)' })
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: RetryDto) {
    return this.automation.retry(user, id, body.reason);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(Permission.AUTOMATION_EXECUTE)
  @ApiOperation({ summary: 'Abandon a failed job; the request is cancelled' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelJobDto) {
    return this.automation.cancel(user, id, body.reason);
  }
}
