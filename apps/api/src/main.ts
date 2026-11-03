import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadEnv } from './config/env';

async function main() {
  const env = loadEnv();
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  Logger.log(`VYRA API listening on :${env.PORT} (docs: /api/docs)`, 'Bootstrap');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
