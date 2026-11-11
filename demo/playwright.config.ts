import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'record.spec.ts',
  outputDir: '../test-results/demo',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'landscape', use: { viewport: { width: 1920, height: 1080 } }, metadata: { zoom: 1.5, caption: 44, lines: 1 } },
    { name: 'portrait', use: { viewport: { width: 1080, height: 1920 } }, metadata: { zoom: 2, caption: 28, lines: 2 } },
  ],
});
