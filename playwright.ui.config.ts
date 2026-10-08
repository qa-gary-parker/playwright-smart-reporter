import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'src/ui/tests',
  outputDir: 'test-results/ui',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, timezoneId: 'UTC', locale: 'en-GB' },
  reporter: process.env.CI ? 'github' : 'list',
});
