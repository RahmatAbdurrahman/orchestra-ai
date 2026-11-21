import { Controller, Get, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { writeAudit, type DocumentIntelligenceClient, type JobQueue } from '@orchestra/core';
import { AuditAction, AuditEntity, Permission } from '@orchestra/domain';
import { loadUiPathConfigFromEnv, type RpaExecutionProvider, type RpaHealthResult } from '@orchestra/uipath-client';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../../common/decorators';
import { actorFor } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma.service';
import { DOCUMENT_INTELLIGENCE, JOB_QUEUE, RPA_PROVIDER } from '../../infrastructure/tokens';

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RPA_PROVIDER) private readonly rpa: RpaExecutionProvider | null,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(DOCUMENT_INTELLIGENCE) private readonly documentIntelligence: DocumentIntelligenceClient,
  ) {}

  private notConfigured(): RpaHealthResult {
    return {
      ok: false,
      configured: false,
      mode: 'cloud',
      authenticated: false,
      folderAccessible: false,
      processFound: false,
      processName: process.env.UIPATH_PROCESS_NAME ?? 'PurchaseOrderAutomation',
      latencyMs: 0,
      checkedAt: new Date().toISOString(),
      message: 'UiPath is not configured (set UIPATH_ORCHESTRATOR_URL, UIPATH_CLIENT_ID, UIPATH_CLIENT_SECRET, UIPATH_FOLDER_ID)',
    };
  }

  async uipathHealth(forceTokenRefresh = false) {
    const health = this.rpa ? await this.rpa.healthCheck({ forceTokenRefresh }) : this.notConfigured();
    const config = loadUiPathConfigFromEnv();
    return {
      ...health,
      // Never expose secrets; only non-sensitive connection details.
      orchestratorUrl: config?.orchestratorUrl ?? null,
      folderId: config?.folderId ?? null,
      isMock: health.mode === 'mock',
    };
  }

  async testConnection(user: AuthUser) {
    const result = await this.uipathHealth(true);
    await writeAudit(this.prisma, actorFor(user), {
      action: AuditAction.INTEGRATION_CONNECTION_TESTED,
      entityType: AuditEntity.INTEGRATION,
      entityId: 'uipath',
      newValue: { ok: result.ok, mode: result.mode, message: result.message },
    });
    return result;
  }

  async systemHealth() {
    const [database, queue, documentIntelligence] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.queue.health(),
      this.documentIntelligence.health(),
    ]);
    return {
      status: database && queue.ok ? 'ok' : 'degraded',
      checks: {
        database: database ? 'up' : 'down',
        queue: { driver: queue.driver, status: queue.ok ? 'up' : 'down' },
        documentIntelligence: documentIntelligence.ok ? 'up' : 'down',
        uipath: this.rpa ? 'configured' : 'not-configured',
      },
      time: new Date().toISOString(),
    };
  }
}

@ApiTags('Integrations')
@ApiCookieAuth()
@Controller('integrations/uipath')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('health')
  @RequirePermissions(Permission.INTEGRATIONS_READ)
  @ApiOperation({ summary: 'UiPath Orchestrator connectivity (auth, folder, process)' })
  health() {
    return this.integrations.uipathHealth();
  }

  @Post('test-connection')
  @HttpCode(200)
  @RequirePermissions(Permission.INTEGRATIONS_MANAGE)
  @ApiOperation({ summary: 'Re-authenticate and verify the UiPath configuration (audited)' })
  testConnection(@CurrentUser() user: AuthUser) {
    return this.integrations.testConnection(user);
  }
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness / readiness of the API and its dependencies' })
  health() {
    return this.integrations.systemHealth();
  }
}
