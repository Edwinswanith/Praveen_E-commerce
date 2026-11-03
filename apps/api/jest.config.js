/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
