import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Reconciler } from '@orchestra/core';
import { WORKER_CONFIG, type WorkerConfig } from '../worker-config';

/**
 * Runs the reconciler at startup (recovery after a restart) and periodically.
 * Several worker instances may run it concurrently: all handlers are
 * idempotent and queue job ids are de-duplicated.
 */
@Injectable()
export class ReconciliationScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    private readonly reconciler: Reconciler,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), this.config.RECONCILE_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconciler.reconcile();
    } catch (error) {
      this.logger.error(`Reconciliation failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
