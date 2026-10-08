import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Needs a report served on localhost:9222; run with `npm run test:live-filter`.
    exclude: process.env.LIVE_REPORT
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'src/live/live-filter-integration.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/bin/**'],
    },
  },
});
