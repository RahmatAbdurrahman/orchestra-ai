import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import type { Prisma } from '@orchestra/database';
import {
  ACTIVE_AUTOMATION_JOB_STATUSES,
  Permission,
  requestAccessScope,
  WORKFLOW_TYPES,
  type PurchaseRequestStatus,
} from '@orchestra/domain';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../../infrastructure/prisma.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditQueryDto, AuditService } from '../audit/audit.controller';
import { RequestAccessService } from '../purchase-requests/request-access.service';

class DashboardQueryDto {
  @ApiPropertyOptional({ description: 'Period length in days (ignored when from/to are given)', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: WORKFLOW_TYPES })
  @IsOptional()
  @IsIn(WORKFLOW_TYPES as unknown as string[])
  workflowType?: string;
}

class RecentActivitiesQueryDto {
  @ApiPropertyOptional({ default: 10, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

function period(query: DashboardQueryDto) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - (query.days ?? 30) * 86_400_000);
  return { from, to };
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: RequestAccessService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
  ) {}

  private scopeLabel(user: AuthUser): 'ALL' | 'OWN' | 'ASSIGNED' | 'OWN_AND_ASSIGNED' {
    const scope = requestAccessScope(user.permissions);
    if (scope.all) return 'ALL';
    if (scope.own && scope.assigned) return 'OWN_AND_ASSIGNED';
    return scope.own ? 'OWN' : 'ASSIGNED';
  }

  private requestWhere(user: AuthUser, query: DashboardQueryDto): Prisma.PurchaseRequestWhereInput {
    return {
      AND: [this.access.readableWhere(user), query.workflowType ? { workflow: { workflowType: query.workflowType } } : {}],
    };
  }

  async summary(user: AuthUser, query: DashboardQueryDto) {
    const { from, to } = period(query);
    const requestScope = this.requestWhere(user, query);
    const inPeriod: Prisma.PurchaseRequestWhereInput = { AND: [requestScope, { createdAt: { gte: from, lte: to } }] };
    const jobScope: Prisma.AutomationJobWhereInput = { purchaseRequest: requestScope };
    const jobsInPeriod: Prisma.AutomationJobWhereInput = { AND: [jobScope, { createdAt: { gte: from, lte: to } }] };

    const [activeWorkflows, requests, byStatus, runningJobs, jobStatuses, interventions, completedJobs] = await Promise.all([
      this.prisma.workflow.count({ where: { isActive: true, ...(query.workflowType ? { workflowType: query.workflowType } : {}) } }),
      this.prisma.purchaseRequest.count({ where: inPeriod }),
      this.prisma.purchaseRequest.groupBy({ by: ['status'], where: inPeriod, _count: { _all: true } }),
      this.prisma.automationJob.count({ where: { AND: [jobScope, { status: { in: [...ACTIVE_AUTOMATION_JOB_STATUSES] } }] } }),
      this.prisma.automationJob.groupBy({ by: ['status'], where: jobsInPeriod, _count: { _all: true } }),
      this.prisma.automationJob.count({ where: { AND: [jobScope, { status: 'FAILED' }] } }),
      this.prisma.automationJob.findMany({
        where: { AND: [jobsInPeriod, { status: 'COMPLETED' }, { startedAt: { not: null } }, { completedAt: { not: null } }] },
        select: { startedAt: true, completedAt: true },
        take: 5000,
      }),
    ]);

    const jobCount = (status: string) => jobStatuses.find((row) => row.status === status)?._count._all ?? 0;
    const completed = jobCount('COMPLETED');
    const failed = jobCount('FAILED');
    const cancelled = jobCount('CANCELLED');
    const finished = completed + failed + cancelled;
    const durations = completedJobs.map((job) => (job.completedAt!.getTime() - job.startedAt!.getTime()) / 1000);
    const pendingApprovals = user.permissions.has(Permission.APPROVALS_DECIDE)
      ? (await this.approvals.pending(user)).length
      : await this.prisma.purchaseRequest.count({ where: { AND: [requestScope, { status: 'PENDING_APPROVAL' }] } });

    return {
      period: { from, to },
      scope: this.scopeLabel(user),
      totals: {
        activeWorkflows,
        requests,
        pendingApprovals,
        runningJobs,
        completedJobs: completed,
        failedJobs: failed,
        jobsNeedingAttention: interventions,
        successRate: finished > 0 ? completed / finished : null,
        avgExecutionSeconds: durations.length > 0 ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null,
      },
      requestsByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<
        Record<PurchaseRequestStatus, number>
      >,
    };
  }

  async automationMetrics(user: AuthUser, query: DashboardQueryDto) {
    const { from, to } = period(query);
    const jobs = await this.prisma.automationJob.findMany({
      where: { purchaseRequest: this.requestWhere(user, query), createdAt: { gte: from, lte: to } },
      select: {
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        errorCode: true,
        attempts: { select: { attemptNo: true, triggeredBy: true, status: true, errorCode: true } },
      },
      take: 5000,
    });
    const days = new Map<string, { date: string; completed: number; failed: number; durations: number[] }>();
    for (let time = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); time <= to.getTime(); time += 86_400_000) {
      const date = new Date(time).toISOString().slice(0, 10);
      days.set(date, { date, completed: 0, failed: 0, durations: [] });
    }
    const failureReasons = new Map<string, number>();
    const statusBreakdown: Record<string, number> = {};
    let attempts = 0;
    let automaticRetries = 0;
    let operatorRetries = 0;
    for (const job of jobs) {
      statusBreakdown[job.status] = (statusBreakdown[job.status] ?? 0) + 1;
      const bucket = days.get(job.createdAt.toISOString().slice(0, 10));
      if (bucket && job.status === 'COMPLETED') {
        bucket.completed += 1;
        if (job.startedAt && job.completedAt) bucket.durations.push((job.completedAt.getTime() - job.startedAt.getTime()) / 1000);
      }
      if (bucket && job.status === 'FAILED') bucket.failed += 1;
      for (const attempt of job.attempts) {
        attempts += 1;
        if (attempt.attemptNo > 1) {
          if (attempt.triggeredBy === 'USER') operatorRetries += 1;
          else automaticRetries += 1;
        }
        if (attempt.errorCode) failureReasons.set(attempt.errorCode, (failureReasons.get(attempt.errorCode) ?? 0) + 1);
      }
    }
    return {
      period: { from, to },
      daily: [...days.values()].map((day) => ({
        date: day.date,
        completed: day.completed,
        failed: day.failed,
        avgDurationSeconds: day.durations.length ? day.durations.reduce((sum, value) => sum + value, 0) / day.durations.length : null,
      })),
      statusBreakdown,
      attempts: { total: attempts, automaticRetries, operatorRetries },
      failureReasons: [...failureReasons.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  async recentActivities(user: AuthUser, limit: number) {
    const query = Object.assign(new AuditQueryDto(), { page: 1, pageSize: limit });
    return (await this.audit.query(user, query)).data;
  }
}

@ApiTags('Dashboard')
@ApiCookieAuth()
@RequirePermissions(Permission.DASHBOARD_VIEW)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: 'KPIs for the selected period, scoped to what the user may see' })
  summary(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboard.summary(user, query);
  }

  @Get('automation-metrics')
  @ApiOperation({ summary: 'Daily automation outcomes, retries and failure reasons' })
  automationMetrics(@CurrentUser() user: AuthUser, @Query() query: DashboardQueryDto) {
    return this.dashboard.automationMetrics(user, query);
  }

  @Get('recent-activities')
  @ApiOperation({ summary: 'Latest audit events visible to the user' })
  recent(@CurrentUser() user: AuthUser, @Query() query: RecentActivitiesQueryDto) {
    return this.dashboard.recentActivities(user, query.limit ?? 10);
  }
}
