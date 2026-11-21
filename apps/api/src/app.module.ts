import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PermissionsGuard, SessionAuthGuard } from './common/guards';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { ApprovalRoutingService } from './modules/approvals/approval-routing.service';
import { ApprovalsController } from './modules/approvals/approvals.controller';
import { ApprovalsService } from './modules/approvals/approvals.service';
import { AuditController, AuditService } from './modules/audit/audit.controller';
import { AuthModule } from './modules/auth/auth.module';
import { AutomationController, AutomationService } from './modules/automation/automation.controller';
import { RuleEvaluationService } from './modules/business-rules/rule-evaluation.service';
import { DashboardController, DashboardService } from './modules/dashboard/dashboard.controller';
import { DocumentsController } from './modules/documents/documents.controller';
import { DocumentsService } from './modules/documents/documents.service';
import {
  HealthController,
  IntegrationsController,
  IntegrationsService,
} from './modules/integrations/integrations.controller';
import { NotificationsController, NotificationsService } from './modules/notifications/notifications.controller';
import { PurchaseRequestsController } from './modules/purchase-requests/purchase-requests.controller';
import { PurchaseRequestsService } from './modules/purchase-requests/purchase-requests.service';
import { RequestAccessService } from './modules/purchase-requests/request-access.service';
import {
  ReferenceDataController,
  ReferenceDataService,
} from './modules/reference-data/reference-data.controller';
import { UsersController } from './modules/users/users.controller';
import { UsersService } from './modules/users/users.service';
import { WorkflowsController, WorkflowsService } from './modules/workflows/workflows.controller';

/**
 * Modular monolith: one deployable API with clearly separated domain modules.
 * Guards run in order: rate limit -> session authentication -> permissions.
 */
@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: () => Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 1200) }],
    }),
  ],
  controllers: [
    UsersController,
    ReferenceDataController,
    WorkflowsController,
    PurchaseRequestsController,
    DocumentsController,
    ApprovalsController,
    AutomationController,
    NotificationsController,
    AuditController,
    DashboardController,
    IntegrationsController,
    HealthController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    UsersService,
    ReferenceDataService,
    WorkflowsService,
    RequestAccessService,
    RuleEvaluationService,
    ApprovalRoutingService,
    PurchaseRequestsService,
    DocumentsService,
    ApprovalsService,
    AutomationService,
    NotificationsService,
    AuditService,
    DashboardService,
    IntegrationsService,
  ],
})
export class AppModule {}
