import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests run against an isolated database with inline queues, the offline
// embedding provider and the mock payment provider. No network access.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://vyra:vyra@localhost:5432/vyra_test?schema=public',
  QUEUES_ENABLED: 'false',
  PAYMENT_PROVIDER: 'mock',
  EMBEDDING_PROVIDER: 'local',
  SHIPPING_PROVIDER: 'manual',
  JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-0123456789',
  STORAGE_LOCAL_DIR: mkdtempSync(join(tmpdir(), 'vyra-test-')),
  COOKIE_SECURE: 'false',
});
delete process.env.SMTP_HOST;
delete process.env.PORT;
