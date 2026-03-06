import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: 'a11y-demo.spec.ts',
  timeout: 30000,
  retries: 1,

  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    smartReporterA11y: {
      enabled: true,
      standard: 'WCAG2AA',
    },
  },

  reporter: [
    ['list'],
    ['../dist/smart-reporter.js', {
      outputFile: 'smart-report-a11y.html',
      historyFile: 'test-history.json',
      maxHistoryRuns: 10,
      enableRetryAnalysis: true,
      enableFailureClustering: true,
      enableStabilityScore: true,
      enableGalleryView: true,
      enableTrendsView: true,
      enableTraceViewer: true,
      enableNetworkLogs: true,
    }],
  ],
});
