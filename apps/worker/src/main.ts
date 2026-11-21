import 'reflect-metadata';
import { createServer } from 'node:http';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadRootEnv } from '@orchestra/core';
import { WorkerModule } from './worker.module';
import { loadWorkerConfig } from './worker-config';

async function bootstrap(): Promise<void> {
  loadRootEnv(__dirname);
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  const logger = new Logger('Worker');
  logger.log('Orchestra AI worker started (BullMQ)');

  // Minimal liveness endpoint for container health checks.
  if (config.WORKER_HEALTH_PORT > 0) {
    createServer((request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', service: 'worker', time: new Date().toISOString() }));
        return;
      }
      response.writeHead(404).end();
    }).listen(config.WORKER_HEALTH_PORT, () => logger.log(`Health endpoint on :${config.WORKER_HEALTH_PORT}/health`));
  }
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
