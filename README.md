# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, performance regression alerts, and a modern interactive dashboard.

![Report Overview](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/report-overview-v1.png)
*v1.0.0 dashboard featuring: sidebar navigation, suite health grade, attention-based filtering, failure clusters, quick insights, and interactive trend charts*

## Features

### Core Analysis
- **AI Failure Analysis** - Get AI-powered suggestions to fix failing tests (Claude/OpenAI/Gemini)
- **Flakiness Detection** - Tracks test history to identify unreliable tests
- **Performance Regression Alerts** - Warns when tests get significantly slower
- **Stability Scoring** - Composite health metrics (0-100 with letter grades A+ to F)
- **Failure Clustering** - Group similar failures by error type with error previews
- **Test Retry Analysis** - Track tests that frequently need retries

### Interactive Dashboard
- **Sidebar Navigation** - Organized views: Overview, Tests, Trends, Comparison, Gallery
- **Theme Support** - Light, dark, and system theme modes with persistent preference
- **Interactive Trend Charts** - Clickable chart bars to navigate to historical runs
- **Per-Test History** - Click through historical results for individual tests
- **Quick Insights** - Clickable cards showing slowest test, most flaky test, and test distribution
- **Attention-Based Filtering** - Visual badges for New Failures, Regressions, and Fixed tests

### Test Details
- **Pass Rate Trend Chart** - Visual graph showing pass rates across runs
- **Step Timing Breakdown** - See which steps are slowest with visual bars
- **Network Logs** - View API calls with status codes, timing, and payload details
- **Screenshot Embedding** - Failure screenshots displayed inline
- **Video Links** - Quick access to test recordings
- **One-Click Trace Viewing** - Opens trace in Playwright's trace viewer
- **Search & Filter** - Find tests by name, filter by status, health, or grade

### Integration
- **JSON Export** - Download results for external processing
- **Slack/Teams Notifications** - Get alerted on failures
- **CI Integration** - Auto-detects GitHub, GitLab, CircleCI, Jenkins, Azure DevOps
- **Merge History CLI** - Combine parallel CI run histories

## New in v1.0.0

### Full UI Redesign

**Special thanks to [Filip Gajic](https://github.com/Morph93) (@Morph93) for designing and implementing the core UI redesign!**

The reporter has been completely redesigned with a modern, professional interface:

- **Sidebar Navigation** - Clean, collapsible sidebar replacing the single-page scroll layout
- **Multiple Views** - Dedicated views for Overview, Tests, Trends, Comparison, and Gallery
- **Theme Support** - Choose between light, dark, or system theme with persistent preference
- **Suite Health Grade** - At-a-glance health indicator combining pass rate, stability, and performance

### Interactive Historical Navigation

- **Clickable Trend Charts** - Click any bar in the trend charts to view that historical run
- **History Banner** - Shows which historical run you're viewing with "Back to Current" button
- **Per-Test History Dots** - Click dots to see individual test results from previous runs
- **Global Historical State** - Navigate between tests while maintaining historical context

### Attention-Based Filtering

- **Visual Badges** - Tests display NEW FAILURE, REGRESSION, or FIXED badges
- **Filter Chips** - Quick filters for attention-requiring tests
- **Smart Sorting** - Tests needing attention automatically sorted to top

### Enhanced Failure Clusters

- **Error Previews** - See actual error messages in the cluster summary
- **Affected Tests** - View which tests are affected by each error type
- **File Locations** - Quick reference to which spec files contain failures

### Quick Insights

- **Slowest Test** - Identifies your slowest running test
- **Most Flaky Test** - Highlights the test with highest failure rate
- **Test Distribution** - Visual breakdown of passed/failed/skipped (clickable to filter)
- **Pass Rate Trend** - Shows if pass rate is improving or declining

### Accessibility & Polish

- **ARIA Improvements** - Better keyboard navigation and screen reader support
- **Sidebar Animation** - Smooth collapse/expand with opacity transitions
- **Refined Styling** - Subtle shadows, colored borders, and improved visual hierarchy

## Recent Updates

### v1.0.3

- **Fixed timedOut Tests Stats** - Tests with `timedOut` status now correctly counted as failed ([#12](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/12))

### v1.0.2

- **Network Logs** - Zero-config extraction of network requests from Playwright trace files
- **Tag-Based Filtering** - Filter tests by tags like `@smoke`, `@critical`
- **Suite-Based Filtering** - Filter by test suite from `test.describe()` blocks
- **Branding Update** - Report title updated to "StageWright Local"

---

## Installation

```bash
npm install -D playwright-smart-reporter
```

## Usage

Add to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['playwright-smart-reporter', {
      outputFile: 'smart-report.html',
      historyFile: 'test-history.json',
      maxHistoryRuns: 10,
      performanceThreshold: 0.2,
      slackWebhook: process.env.SLACK_WEBHOOK_URL,
      teamsWebhook: process.env.TEAMS_WEBHOOK_URL,
      // Feature flags
      enableRetryAnalysis: true,
      enableFailureClustering: true,
      enableStabilityScore: true,
      enableGalleryView: true,
      enableComparison: true,
      enableAIRecommendations: true,
      enableTraceViewer: true,
      enableHistoryDrilldown: true,
      enableNetworkLogs: true,
      stabilityThreshold: 70,
      retryFailureThreshold: 3,
      baselineRunId: 'main-branch-baseline', // optional
    }],
  ],
});
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `outputFile` | `smart-report.html` | Path for the HTML report |
| `historyFile` | `test-history.json` | Path for test history storage |
| `maxHistoryRuns` | `10` | Number of runs to keep in history |
| `performanceThreshold` | `0.2` | Threshold for performance regression (20%) |
| `slackWebhook` | - | Slack webhook URL for failure notifications |
| `teamsWebhook` | - | Microsoft Teams webhook URL for notifications |
| `enableRetryAnalysis` | `true` | Track tests that frequently need retries |
| `enableFailureClustering` | `true` | Group similar failures by error type |
| `enableStabilityScore` | `true` | Show stability scores (0-100) with letter grades |
| `enableGalleryView` | `true` | Display attachment gallery view |
| `enableComparison` | `true` | Enable run comparison against baseline |
| `enableAIRecommendations` | `true` | Generate AI-powered recommendations |
| `enableTraceViewer` | `true` | Enable "View Trace" actions |
| `enableHistoryDrilldown` | `true` | Store per-run snapshots for historical navigation |
| `enableNetworkLogs` | `true` | Extract and display network requests from traces |
| `networkLogExcludeAssets` | `true` | Exclude static assets (images, fonts, CSS, JS) |
| `networkLogMaxEntries` | `50` | Maximum network entries to display per test |
| `stabilityThreshold` | `70` | Minimum stability score (C grade) to avoid warnings |
| `retryFailureThreshold` | `3` | Number of retries before flagging as problematic |
| `baselineRunId` | - | Optional: Run ID to use as baseline for comparisons |


### AI Analysis

To enable AI-powered failure analysis, set one of these environment variables:

```bash
# Using Anthropic Claude
export ANTHROPIC_API_KEY=your-api-key

# OR using OpenAI
export OPENAI_API_KEY=your-api-key

# OR using Google Gemini
export GEMINI_API_KEY=your-api-key
```

**Provider Priority:** If multiple API keys are set, the reporter will use the first one found in this order:
1. Anthropic Claude (`claude-3-haiku-20240307`)
2. OpenAI (`gpt-3.5-turbo`)
3. Google Gemini (`gemini-2.5-flash-lite`)

The reporter will automatically analyze failures and provide fix suggestions in the report.

## Report Views

### Overview

The Overview provides a quick summary of your test suite health:

- **Pass Rate Ring** - Visual indicator with percentage
- **Suite Health Grade** - Combined score (A+ to F) based on pass rate, stability, and performance
- **Stat Cards** - Pass/fail/skip/flaky counts with colored indicators
- **Attention Required** - Cards highlighting flaky tests and fixed tests
- **Failure Clusters** - Grouped errors with previews and affected test counts
- **Quick Insights** - Slowest test, most flaky test, test distribution

### Tests

Browse and filter all tests with powerful filtering options:

- **Status Filters** - All, Passed, Failed, Skipped
- **Health Filters** - Flaky, Slow, New
- **Grade Filters** - Filter by stability grade (A, B, C, D, F)
- **Attention Filters** - New Failures, Regressions, Fixed
- **Suite Filters** - Filter by test suite (from `test.describe()` blocks)
- **Tag Filters** - Filter by tags (from annotations like `@smoke`, `@critical`)
- **Search** - Find tests by name

Each test card shows:
- Status indicator and test name
- Suite badge and tags (if applicable)
- Duration and stability grade
- Flakiness indicator and performance trend
- History dots (clickable for historical view)
- Expandable details with steps, errors, screenshots, and AI suggestions

### Trends

Interactive charts showing test suite trends over time:

- **Pass Rate** - Track pass rate improvements or regressions
- **Duration** - Monitor test suite execution time
- **Flaky Tests** - See flakiness trends across runs
- **Slow Tests** - Track performance issues over time

Click any chart bar to view that historical run's data.

### Comparison

Compare current run against a baseline:

- Pass rate change with trend indicator
- Duration change
- Test count differences
- Flaky test count changes

### Gallery

Visual grid of all test attachments:

- Screenshots with thumbnail previews
- Video recordings
- Trace files with direct viewer access
- Filter by test status

## Flakiness Indicators

- 🟢 **Stable** (<10% failure rate)
- 🟡 **Unstable** (10-30% failure rate)
- 🔴 **Flaky** (>30% failure rate)
- ⚪ **New** (no history yet)
- ⚪ **Skipped** (test was skipped)

## Stability Grades

- **A+ (95-100)**: Rock solid, consistently passing
- **A (90-94)**: Very stable with rare failures
- **B (80-89)**: Generally stable with occasional issues
- **C (70-79)**: Moderately stable, needs attention
- **D (60-69)**: Unstable, frequent failures
- **F (<60)**: Critically unstable, requires immediate attention

## Performance Trends

- ↑ **Regression** - Test is slower than average
- ↓ **Improved** - Test is faster than average
- → **Stable** - Test is within normal range

## Trace Viewer

The report includes **Download Trace** and **View Trace** actions on failed tests.

To open a trace directly in Playwright's Trace Viewer:

```bash
npx playwright-smart-reporter-view-trace ./traces/<trace>.zip
```

## Network Logs

Network requests are automatically extracted from Playwright trace files - no code changes required. Each test displays an expandable "Network Logs" section showing:

- **Method & URL** - HTTP method and request URL
- **Status Code** - Response status with color coding (green for 2xx, yellow for 3xx, red for 4xx/5xx)
- **Duration** - Request timing with visual waterfall
- **Size** - Request and response payload sizes

Expand individual entries to see:
- Request/response headers
- Request body (for POST/PUT/PATCH requests)
- Detailed timing breakdown (DNS, connect, SSL, wait, receive)

### Configuration

```typescript
reporter: [
  ['playwright-smart-reporter', {
    // Network logging is enabled by default
    enableNetworkLogs: true,

    // Exclude static assets (images, fonts, CSS, JS) - default: true
    networkLogExcludeAssets: false,  // Set to false to show all requests

    // Maximum entries per test - default: 50
    networkLogMaxEntries: 30,
  }],
]
```

### Requirements

Network logs require trace files to be available. Ensure your Playwright config enables tracing:

```typescript
// playwright.config.ts
use: {
  trace: 'retain-on-failure',  // or 'on' to always capture
}
```

## CI Integration

### Persisting History Across Runs

For flakiness detection and performance trends to work in CI, persist `test-history.json` between runs.

#### GitHub Actions

```yaml
- name: Restore test history
  uses: actions/cache@v4
  with:
    path: test-history.json
    key: test-history-${{ github.ref }}
    restore-keys: |
      test-history-

- name: Run Playwright tests
  run: npx playwright test

- name: Save test history
  uses: actions/cache/save@v4
  if: always()
  with:
    path: test-history.json
    key: test-history-${{ github.ref }}-${{ github.run_id }}
```

#### GitLab CI

```yaml
test:
  cache:
    key: test-history-$CI_COMMIT_REF_SLUG
    paths:
      - test-history.json
    policy: pull-push
  script:
    - npx playwright test
```

#### CircleCI

```yaml
- restore_cache:
    keys:
      - test-history-{{ .Branch }}
      - test-history-

- run: npx playwright test

- save_cache:
    key: test-history-{{ .Branch }}-{{ .Revision }}
    paths:
      - test-history.json
```

### CI Environment Detection

The reporter automatically detects CI environments and enriches history with:
- **Run ID** - Unique identifier for the run
- **Branch** - Current branch name
- **Commit** - Short commit SHA
- **CI Provider** - GitHub, GitLab, CircleCI, Jenkins, Azure DevOps

### Webhook Notifications

Configure Slack or Teams webhooks to receive notifications when tests fail:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    teamsWebhook: process.env.TEAMS_WEBHOOK_URL,
  }],
]
```

### Merging Reports from Multiple Machines

When running tests in parallel across multiple machines (sharding), merge both test results and history files.

#### 1. Configure each machine

```typescript
// playwright.config.ts
const outputDir = process.env.PLAYWRIGHT_BLOB_OUTPUT_DIR || 'blob-report';

export default defineConfig({
  reporter: [
    ['blob'],
    ['playwright-smart-reporter', {
      outputFile: `${outputDir}/smart-report.html`,
      historyFile: `${outputDir}/test-history.json`,
    }],
  ],
});
```

#### 2. Run tests on each machine

```bash
# Machine 1
PLAYWRIGHT_BLOB_OUTPUT_DIR=blob-reports/machine1 npx playwright test --shard=1/2

# Machine 2
PLAYWRIGHT_BLOB_OUTPUT_DIR=blob-reports/machine2 npx playwright test --shard=2/2
```

#### 3. Merge history files

```bash
npx playwright-smart-reporter-merge-history \
  blob-reports/machine1/test-history.json \
  blob-reports/machine2/test-history.json \
  -o blob-reports/merged/test-history.json
```

#### 4. Merge blob reports

```bash
cp blob-reports/machine1/*.zip blob-reports/machine2/*.zip blob-reports/merged/
npx playwright merge-reports --reporter=playwright-smart-reporter blob-reports/merged
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run demo tests
npm run test:demo

# Open the report
open example/smart-report.html
```

## Contributors

- [Gary Parker](https://github.com/qa-gary-parker) - Creator and maintainer
- [Filip Gajic](https://github.com/Morph93) - v1.0.0 UI redesign

## License

MIT
