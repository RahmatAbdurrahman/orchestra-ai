import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import {
  AutomationExecutor,
  createRedisConnection,
  JOB_NAMES,
  QUEUE_NAMES,
  type AutomationPollJobData,
  type AutomationSubmitJobData,
} from '@orchestra/core';
import { Worker } from 'bullmq';
import { WORKER_CONFIG, type WorkerConfig } from '../worker-config';
import { executionContext } from './processor-context';

type AutomationJobData = AutomationSubmitJobData | AutomationPollJobData;

/** Consumes the automation queue: UiPath job submission and status polling. */
@Injectable()
export class AutomationProcessor implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AutomationProcessor.name);
  private worker: Worker<AutomationJobData> | null = null;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly executor: AutomationExecutor,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<AutomationJobData>(
      QUEUE_NAMES.AUTOMATION,
      async (job) => {
        const context = executionContext(job);
        if (job.name === JOB_NAMES.SUBMIT) return this.executor.submit(job.data as AutomationSubmitJobData, context);
        if (job.name === JOB_NAMES.POLL) return this.executor.poll(job.data as AutomationPollJobData, context);
        this.logger.warn(`Unknown automation job "${job.name}" ignored`);
      },
      {
        connection: createRedisConnection(this.config.REDIS_URL),
        prefix: this.config.QUEUE_PREFIX,
        concurrency: this.config.WORKER_AUTOMATION_CONCURRENCY,
      },
    );
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Automation job ${job?.name}/${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}`),
    );
    this.worker.on('error', (error) => this.logger.error(`Automation worker error: ${error.message}`));
    this.logger.log(
      `Listening on queue "${QUEUE_NAMES.AUTOMATION}" (concurrency ${this.config.WORKER_AUTOMATION_CONCURRENCY})`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
