/**
 * Integration tests: real PostgreSQL (TEST_DATABASE_URL), in-process queue,
 * in-process UiPath Orchestrator MOCK + ERP simulation, stubbed document
 * intelligence. They never talk to a real UiPath tenant.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.int-spec.ts'],
  testTimeout: 120_000,
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: { ignoreCodes: [151002] } }],
  },
};
