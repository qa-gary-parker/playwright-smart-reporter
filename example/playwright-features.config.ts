import { defineConfig, devices } from '@playwright/test';

/**
 * All-features demo — custom theme, branding, quality gates, quarantine, exports
 *
 * Run with:
 *   npx playwright test --config=example/playwright-features.config.ts
 */
export default defineConfig({
  testDir: './',
  timeout: 30000,
  retries: 2,

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
    video: 'retain-on-failure',
  },

  reporter: [
    ['list'],
    ['../dist/smart-reporter.js', {
      outputFile: 'features-report.html',
      historyFile: 'test-history-features.json',
      maxHistoryRuns: 10,

      // Custom theme — a teal/cyan accent instead of the default green
      theme: {
        preset: 'dark' as const,
        primary: '#00e5ff',
        accent: '#7c4dff',
        success: '#00e676',
        error: '#ff1744',
        warning: '#ffc400',
      },

      // Report branding
      branding: {
        title: 'Demo Corp QA',
        footer: 'Demo Corp — Internal QA Report — Confidential',
      },

      // Quality Gates
      qualityGates: {
        maxFailures: 5,
        minPassRate: 60,
        maxFlakyRate: 30,
        noNewFailures: true,
      },

      // Quarantine
      quarantine: {
        enabled: true,
        threshold: 0.3,
      },

      // Exports
      exportJson: true,
      exportJunit: true,
      exportPdf: true,

      // Standard features
      enableRetryAnalysis: true,
      enableFailureClustering: true,
      enableStabilityScore: true,
      enableGalleryView: true,
      enableComparison: true,
      enableTrendsView: true,
      enableTraceViewer: true,
      enableNetworkLogs: true,
    }],
  ],
});
