import { defineConfig, devices } from '@playwright/test';

/**
 * Example Playwright configuration with Smart Reporter
 *
 * This demonstrates commonly used options. See README.md for full documentation.
 */
export default defineConfig({
  testDir: './',
  timeout: 30000,
  retries: 2, // Enable retries to demonstrate flaky test detection

  // Multiple projects to showcase browser/project badges
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure', // Required for network logs and trace viewer
    video: 'retain-on-failure',
  },

  reporter: [
    ['list'], // Console output
    ['../dist/smart-reporter.js', {
      // === Core Options ===
      outputFile: 'smart-report.html',
      historyFile: 'test-history.json',
      maxHistoryRuns: 10,

      // === Feature Flags ===
      enableRetryAnalysis: true,       // Track tests needing retries
      enableFailureClustering: true,   // Group similar failures
      enableStabilityScore: true,      // Show A-F grades
      enableGalleryView: true,         // Screenshot/video gallery
      enableComparison: true,          // Compare against previous run
      enableAIRecommendations: true,   // AI fix suggestions (needs API key)
      enableTrendsView: true,          // Pass rate/duration charts
      enableTraceViewer: true,         // Inline trace viewer
      enableHistoryDrilldown: true,    // Click history dots to view past runs
      enableNetworkLogs: true,         // Extract network logs from traces

      // === Thresholds ===
      performanceThreshold: 0.2,       // Alert if test is 20% slower than average
      stabilityThreshold: 70,          // Warn if stability score < 70 (C grade)
      retryFailureThreshold: 3,        // Flag tests needing >3 retries

      // === Network Logging ===
      // networkLogFilter: 'api.example.com',  // Only show matching URLs
      networkLogExcludeAssets: true,   // Hide images, fonts, CSS, JS
      networkLogMaxEntries: 50,        // Max entries per test

      // === Step Display ===
      // filterPwApiSteps: true,        // Hide pw:api steps, show only test.step

      // === Notifications (optional) ===
      // slackWebhook: process.env.SLACK_WEBHOOK_URL,
      // teamsWebhook: process.env.TEAMS_WEBHOOK_URL,
    }],
  ],
});
