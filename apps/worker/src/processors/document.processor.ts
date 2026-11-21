import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  createRedisConnection,
  DocumentProcessingService,
  QUEUE_NAMES,
  type DocumentJobData,
} from '@orchestra/core';
import { Worker } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../worker-config';
import { executionContext } from './processor-context';

/** Consumes the document-processing queue (Python document intelligence). */
@Injectable()
export class DocumentProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DocumentProcessor.name);
  private worker: Worker<DocumentJobData> | null = null;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly documents: DocumentProcessingService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<DocumentJobData>(
      QUEUE_NAMES.DOCUMENTS,
      async (job) => this.documents.process(job.data, executionContext(job)),
      {
        connection: createRedisConnection(this.config.REDIS_URL),
        prefix: this.config.QUEUE_PREFIX,
        concurrency: this.config.WORKER_DOCUMENT_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Document job ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`),
    );
    this.worker.on('error', (error) => this.logger.error(`Document worker error: ${error.message}`));
    this.logger.log(`Listening on queue "${QUEUE_NAMES.DOCUMENTS}" (concurrency ${this.config.WORKER_DOCUMENT_CONCURRENCY})`);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
