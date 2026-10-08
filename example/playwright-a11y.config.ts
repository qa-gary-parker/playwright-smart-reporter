import { defineConfig, devices } from '@playwright/test';
import { withAccessibility } from '../dist/smart-reporter';

export default withAccessibility(defineConfig({
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
  },

  reporter: [
    ['list'],
    ['../dist/smart-reporter.js', {
      outputFile: 'smart-report-a11y.html',
      historyFile: 'test-history-a11y.json',
      exportJson: true,
      accessibility: { enabled: true, standard: 'WCAG2AA' },
      qualityGates: { maxA11yViolations: 0 },
    }],
  ],
}));
