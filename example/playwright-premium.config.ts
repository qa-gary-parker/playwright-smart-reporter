import { defineConfig, devices } from '@playwright/test';

/**
 * Premium features demo — custom theme, branding, JSON + JUnit exports
 *
 * Run with:
 *   SMART_REPORTER_DEV_LICENSE=true npx playwright test --config=example/playwright-premium.config.ts
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
      outputFile: 'premium-report.html',
      historyFile: 'test-history-premium.json',
      maxHistoryRuns: 10,

      // License key — set via SMART_REPORTER_LICENSE_KEY env var or inline here
      // Generate with: node dist/license/generate-license.js --tier pro --org "Demo Corp"
      licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,

      // Premium: Custom theme — a teal/cyan accent instead of the default green
      theme: {
        preset: 'dark' as const,
        primary: '#00e5ff',
        accent: '#7c4dff',
        success: '#00e676',
        error: '#ff1744',
        warning: '#ffc400',
      },

      // Premium: Report branding
      branding: {
        title: 'Demo Corp QA',
        footer: 'Demo Corp — Internal QA Report — Confidential',
      },

      // Premium: Quality Gates
      qualityGates: {
        maxFailures: 5,
        minPassRate: 60,
        maxFlakyRate: 30,
        noNewFailures: true,
      },

      // Premium: Quarantine
      quarantine: {
        enabled: true,
        threshold: 0.3,
      },

      // Premium: Exports
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
