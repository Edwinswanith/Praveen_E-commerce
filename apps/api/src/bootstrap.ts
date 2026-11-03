import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { API_PREFIX } from '@vyra/shared';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { initMonitoring } from './common/monitoring/monitoring';

export async function createApp() {
  const env = loadEnv();
  initMonitoring(env.SENTRY_DSN, env.APP_VERSION, env.NODE_ENV);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // webhook signatures are computed over the exact bytes
    logger: env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true, allowedHeaders: ['content-type', 'x-requested-with', 'authorization', 'x-request-id', 'x-vyra-session', 'x-vyra-device', 'x-vyra-source'] });
  app.setGlobalPrefix(API_PREFIX.slice(1), { exclude: ['media/(.*)'] });

  if (env.STORAGE_DRIVER === 'local') {
    // Only processed WebP/MP4 files ever land here; nosniff prevents content-type confusion.
    app.useStaticAssets(resolve(env.STORAGE_LOCAL_DIR), { prefix: '/media', maxAge: '30d', immutable: true, index: false, dotfiles: 'deny', setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') });
  }

  const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('VYRA API').setDescription('VYRA fashion commerce REST API. Request/response contracts: packages/shared.').setVersion(env.APP_VERSION)
    .addCookieAuth('vyra_at').addCookieAuth('vyra_staff_at').addBearerAuth().build());
  SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs-json' });
  return app;
}
