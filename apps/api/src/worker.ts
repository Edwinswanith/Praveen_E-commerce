import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

/**
 * Standalone background worker (embeddings, reservation expiry). Run with
 * RUN_WORKERS_IN_API=false on API nodes and `pnpm --filter @vyra/api worker` here.
 */
async function main() {
  process.env.VYRA_WORKER = '1';
  const { AppModule } = await import('./app.module');
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  ctx.enableShutdownHooks();
  Logger.log('VYRA worker started', 'Worker');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
