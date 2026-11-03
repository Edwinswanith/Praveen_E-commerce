import { defineConfig, devices } from '@playwright/test';

/**
 * Full-stack browser tests. Expects the API (:4000), storefront (:3000) and
 * admin (:3001) to be running against a seeded database with
 * PAYMENT_PROVIDER=mock and SMS_PROVIDER=console (OTPs echoed in dev).
 * Locally: start the three apps, then `pnpm e2e`. CI: see .github/workflows/ci.yml (e2e job).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storefrontURL: process.env.STOREFRONT_URL ?? 'http://localhost:3000',
  } as never,
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
