import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: process.env.ACCEPTANCE_E2E || process.env.TIMELINE_E2E ? 60_000 : 5_000,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', ...(process.env.TIMELINE_E2E ? ['example/timeline/*.acceptance.ts'] : []), ...(process.env.ACCEPTANCE_E2E ? ['example/acceptance/*.acceptance.ts'] : [])],
    exclude: [
      ...configDefaults.exclude,
      // Needs a build and Chromium; run with `npm run test:coverage-example`.
      ...(process.env.COVERAGE_E2E ? [] : ['src/coverage/coverage-example.test.ts']),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/bin/**'],
    },
  },
});
