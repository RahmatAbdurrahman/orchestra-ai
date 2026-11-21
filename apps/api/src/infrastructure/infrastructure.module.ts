import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  automationExecutorOptionsFromEnv,
  AutomationExecutor,
  BullMqJobQueue,
  DocumentIntelligenceClient,
  DocumentProcessingService,
  inlineQueueBackoffScaleFromEnv,
  InlineJobQueue,
  LocalFileStorage,
  Reconciler,
  reconcilerOptionsFromEnv,
  type CoreLogger,
  type JobQueue,
} from '@orchestra/core';
import {
  loadUiPathConfigFromEnv,
  UiPathOrchestratorClient,
  type RpaExecutionProvider,
} from '@orchestra/uipath-client';
import { APP_CONFIG, loadAppConfig, type AppConfig } from '../config/app-config';
import { PrismaService } from './prisma.service';
import { DOCUMENT_INTELLIGENCE, FILE_STORAGE, JOB_QUEUE, RPA_PROVIDER } from './tokens';

export function nestCoreLogger(context: string): CoreLogger {
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

/**
 * QUEUE_DRIVER=inline (development / tests without Redis): the API process
 * also runs the background handlers and the reconciler. In the default
 * QUEUE_DRIVER=bullmq mode this does nothing; apps/worker runs them.
 */
@Injectable()
export class InlineWorkerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private readonly logger = new Logger('InlineWorker');

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(RPA_PROVIDER) private readonly rpa: RpaExecutionProvider | null,
    @Inject(DOCUMENT_INTELLIGENCE) private readonly documentIntelligence: DocumentIntelligenceClient,
    @Inject(FILE_STORAGE) private readonly storage: LocalFileStorage,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    if (!(this.queue instanceof InlineJobQueue)) return;
    this.logger.warn('QUEUE_DRIVER=inline: background jobs run inside the API process (development/test only)');
    const documents = new DocumentProcessingService({
      db: this.prisma,
      storage: this.storage,
      documentIntelligence: this.documentIntelligence,
      logger: nestCoreLogger('DocumentProcessing'),
    });
    const executor = new AutomationExecutor({
      db: this.prisma,
      rpa: this.rpa,
      queue: this.queue,
      logger: nestCoreLogger('AutomationExecutor'),
      options: automationExecutorOptionsFromEnv(),
    });
    this.queue.registerHandlers({
      processDocument: (data, context) => documents.process(data, context),
      submitAutomation: (data, context) => executor.submit(data, context),
      pollAutomation: (data, context) => executor.poll(data, context),
    });
    const reconciler = new Reconciler({
      db: this.prisma,
      queue: this.queue,
      logger: nestCoreLogger('Reconciler'),
      options: reconcilerOptionsFromEnv(),
    });
    const run = () =>
      reconciler.reconcile().catch((error: unknown) => this.logger.error(`Reconciliation failed: ${(error as Error).message}`));
    void run();
    this.timer = setInterval(run, this.config.reconcileIntervalMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

@Injectable()
class QueueLifecycle implements OnApplicationShutdown {
  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadAppConfig() },
    PrismaService,
    {
      provide: JOB_QUEUE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): JobQueue =>
        config.queue.driver === 'inline'
          ? new InlineJobQueue(nestCoreLogger('InlineQueue'), inlineQueueBackoffScaleFromEnv())
          : new BullMqJobQueue(config.queue.redisUrl, config.queue.prefix),
    },
    {
      provide: FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LocalFileStorage(config.uploadDir),
    },
    {
      provide: RPA_PROVIDER,
      useFactory: (): RpaExecutionProvider | null => {
        const uipath = loadUiPathConfigFromEnv();
        return uipath ? new UiPathOrchestratorClient(uipath, { logger: nestCoreLogger('UiPath') }) : null;
      },
    },
    {
      provide: DOCUMENT_INTELLIGENCE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new DocumentIntelligenceClient({
          baseUrl: config.documentIntelligence.url,
          internalToken: config.documentIntelligence.token,
        }),
    },
    InlineWorkerRunner,
    QueueLifecycle,
  ],
  exports: [APP_CONFIG, PrismaService, JOB_QUEUE, FILE_STORAGE, RPA_PROVIDER, DOCUMENT_INTELLIGENCE],
})
export class InfrastructureModule {}
