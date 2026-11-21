import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { correlationIdMiddleware, originCheckMiddleware } from './common/middleware';
import { APP_CONFIG, type AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';

/** Applies global HTTP configuration. Shared by main.ts and the integration tests. */
export function configureApp(app: INestApplication): AppConfig {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  if (config.trustProxy) express.set('trust proxy', 1);
  express.disable('x-powered-by');

  app.use(correlationIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.use(originCheckMiddleware(config.corsOrigins));
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    exposedHeaders: ['X-Correlation-Id'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Orchestra AI API')
        .setDescription(
          'Business orchestration API: purchase requests, document intelligence, business rules, approvals, UiPath automation and audit trail.',
        )
        .setVersion('1.0')
        .addCookieAuth(config.session.cookieName)
        .build(),
    );
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);
  }
  return config;
}
