import { Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import {
  automationExecutorOptionsFromEnv,
  AutomationExecutor,
  BullMqJobQueue,
  DocumentIntelligenceClient,
  DocumentProcessingService,
  LocalFileStorage,
  Reconciler,
  reconcilerOptionsFromEnv,
  type CoreLogger,
  type JobQueue,
} from '@orchestra/core';
import { createPrismaClient, type PrismaClient } from '@orchestra/database';
import { loadUiPathConfigFromEnv, UiPathOrchestratorClient } from '@orchestra/uipath-client';
import { AutomationProcessor } from './processors/automation.processor';
import { DocumentProcessor } from './processors/document.processor';
import { ReconciliationScheduler } from './services/reconciliation.scheduler';
import { loadWorkerConfig, WORKER_CONFIG, type WorkerConfig } from './worker-config';

const PRISMA = Symbol('PRISMA');
const JOB_QUEUE = Symbol('JOB_QUEUE');

function coreLogger(context: string): CoreLogger {
  const logger = new Logger(context);
  const format = (message: string, extra?: Record<string, unknown>) =>
    extra && Object.keys(extra).length > 0 ? `${message} ${JSON.stringify(extra)}` : message;
  return {
    log: (message, extra) => logger.log(format(message, extra)),
    warn: (message, extra) => logger.warn(format(message, extra)),
    error: (message, extra) => logger.error(format(message, extra)),
    debug: (message, extra) => logger.debug(format(message, extra)),
  };
}

@Injectable()
class ResourceLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
    await this.prisma.$disconnect();
  }
}

@Module({
  providers: [
    { provide: WORKER_CONFIG, useFactory: () => loadWorkerConfig() },
    { provide: PRISMA, useFactory: () => createPrismaClient() },
    {
      provide: JOB_QUEUE,
      inject: [WORKER_CONFIG],
      useFactory: (config: WorkerConfig) => new BullMqJobQueue(config.REDIS_URL, config.QUEUE_PREFIX),
    },
    {
      provide: DocumentProcessingService,
      inject: [WORKER_CONFIG, PRISMA],
      useFactory: (config: WorkerConfig, prisma: PrismaClient) =>
        new DocumentProcessingService({
          db: prisma,
          storage: new LocalFileStorage(config.UPLOAD_DIR),
          documentIntelligence: new DocumentIntelligenceClient({
            baseUrl: config.DOCUMENT_INTELLIGENCE_URL,
            internalToken: config.DOCUMENT_INTELLIGENCE_TOKEN,
          }),
          logger: coreLogger('DocumentProcessing'),
        }),
    },
    {
      provide: AutomationExecutor,
      inject: [PRISMA, JOB_QUEUE],
      useFactory: (prisma: PrismaClient, queue: JobQueue) => {
        const uipath = loadUiPathConfigFromEnv();
        const logger = coreLogger('AutomationExecutor');
        if (!uipath) logger.warn('UiPath is not configured; automation jobs will fail with UIPATH_NOT_CONFIGURED');
        return new AutomationExecutor({
          db: prisma,
          rpa: uipath ? new UiPathOrchestratorClient(uipath, { logger: coreLogger('UiPath') }) : null,
          queue,
          logger,
          options: automationExecutorOptionsFromEnv(),
        });
      },
    },
    {
      provide: Reconciler,
      inject: [PRISMA, JOB_QUEUE],
      useFactory: (prisma: PrismaClient, queue: JobQueue) =>
        new Reconciler({ db: prisma, queue, logger: coreLogger('Reconciler'), options: reconcilerOptionsFromEnv() }),
    },
    DocumentProcessor,
    AutomationProcessor,
    ReconciliationScheduler,
    ResourceLifecycle,
  ],
})
export class WorkerModule {}
