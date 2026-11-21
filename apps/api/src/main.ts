import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { loadRootEnv } from '@orchestra/core';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  loadRootEnv(__dirname);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  const config = configureApp(app);
  await app.listen(config.port);
  const logger = new Logger('Bootstrap');
  logger.log(`Orchestra AI API listening on http://localhost:${config.port}/${API_PREFIX} (queue: ${config.queue.driver})`);
  if (config.swaggerEnabled) logger.log(`OpenAPI docs: http://localhost:${config.port}/${API_PREFIX}/docs`);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
