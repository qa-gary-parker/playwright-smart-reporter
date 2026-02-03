# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, performance regression alerts, and a modern interactive dashboard.

**Now available for both Node.js and Python!** 🎉
- **Node.js/TypeScript**: `npm install playwright-smart-reporter`
- **Python/pytest**: See [Python README](./python/README.md)

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
- **Inline Trace Viewer** - View traces directly in the dashboard (v1.0.5+)
- **Custom Attachments** - Display files added via `testInfo.attach()` (v1.0.5+)
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

### v1.0.5

- **Fixed Retry Double-Counting** - Test retries no longer inflate counts; uses Playwright's `test.outcome()` ([#17](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/17))
- **Fixed Expected Failures** - Tests marked with `test.fail()` are now handled correctly ([#16](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/16))
- **Inline Trace Viewer** - View Playwright traces directly in the dashboard with timeline, actions, network tabs ([#13](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/13))
- **Custom Attachments** - Display attachments added via `testInfo.attach()` ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
- **Improved Tags** - Tags now extracted from `test.tags` property with better display ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))

### v1.0.4

- **Google Gemini AI Support** - Added `GEMINI_API_KEY` for Google Gemini API integration ([#18](https://github.com/qa-gary-parker/playwright-smart-reporter/pull/18))

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

#### Core Options

| Option | Default | Description |
|--------|---------|-------------|
| `outputFile` | `smart-report.html` | Path for the HTML report |
| `historyFile` | `test-history.json` | Path for test history storage |
| `maxHistoryRuns` | `10` | Number of runs to keep in history |
| `performanceThreshold` | `0.2` | Threshold for performance regression alerts (0.2 = 20% slower than average) |
| `slackWebhook` | - | Slack webhook URL for failure notifications |
| `teamsWebhook` | - | Microsoft Teams webhook URL for notifications |

#### Feature Flags

| Option | Default | Description |
|--------|---------|-------------|
| `enableRetryAnalysis` | `true` | Track tests that frequently need retries |
| `enableFailureClustering` | `true` | Group similar failures by error type for batch fixing |
| `enableStabilityScore` | `true` | Show stability scores (0-100) with letter grades (A+ to F) |
| `enableGalleryView` | `true` | Display attachment gallery view with screenshots, videos, traces |
| `enableComparison` | `true` | Enable run comparison against baseline |
| `enableAIRecommendations` | `true` | Generate AI-powered fix suggestions for failures |
| `enableTrendsView` | `true` | Show interactive trend charts for pass rate, duration, flakiness |
| `enableTraceViewer` | `true` | Enable inline "View Trace" modal and download actions |
| `enableHistoryDrilldown` | `false` | Store per-run snapshots for clicking history dots to view past results |
| `enableNetworkLogs` | `true` | Extract and display network requests from trace files |

#### Network Logging Options

| Option | Default | Description |
|--------|---------|-------------|
| `networkLogFilter` | - | Only show network requests where URL contains this string (e.g., `'api.example.com'`) |
| `networkLogExcludeAssets` | `true` | Exclude static assets (images, fonts, CSS, JS, etc.) from network logs |
| `networkLogMaxEntries` | `50` | Maximum network entries to display per test |

#### Threshold Options

| Option | Default | Description |
|--------|---------|-------------|
| `stabilityThreshold` | `70` | Minimum stability score to avoid warnings (70 = C grade) |
| `retryFailureThreshold` | `3` | Number of retries before flagging test as problematic |
| `baselineRunId` | - | Specific run ID to compare against (defaults to previous run) |

#### Advanced Options

| Option | Default | Description |
|--------|---------|-------------|
| `filterPwApiSteps` | `false` | Hide verbose `pw:api` steps (e.g., `page.click()`), only show custom `test.step` entries |
| `relativeToCwd` | `false` | Resolve paths relative to current working directory instead of Playwright's rootDir |
| `projectName` | - | Isolate history per project. Supports `{project}` placeholder in historyFile |
| `cspSafe` | `false` | Content Security Policy safe mode: saves screenshots as files instead of base64, uses system fonts |


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
3. Google Gemini (`gemini-2.5-flash`)

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

### Flakiness Detection: Smart Reporter vs Playwright

**Important:** Smart Reporter's flakiness detection works differently from Playwright's built-in HTML report:

| Aspect | Playwright HTML Report | Smart Reporter |
|--------|------------------------|----------------|
| **Scope** | Single test run | Historical data across multiple runs |
| **Criteria** | Test fails then passes on retry within the same run | Test has failed 30%+ of the time historically |
| **Use Case** | Identifies immediate retry success | Identifies chronically unreliable tests |

**Example:**
- A test fails once, then passes on retry → Playwright marks it "flaky", Smart Reporter marks it "stable" (if it usually passes)
- A test passes today but failed in 4 of the last 10 runs → Playwright marks it "passed", Smart Reporter marks it "flaky"

This historical approach helps identify tests that need attention even if they happen to pass in the current run.

## Stability Grades

The stability score is a composite metric (0-100) calculated from three factors:

| Factor | Weight | Description |
|--------|--------|-------------|
| **Reliability** | 40% | Based on pass rate from historical data |
| **Flakiness** | 35% | Inverse of flakiness score (lower flakiness = higher score) |
| **Performance** | 25% | Consistency of execution time (less variance = higher score) |

### Grade Thresholds

| Grade | Score Range | Description |
|-------|-------------|-------------|
| **A+** | 95-100 | Rock solid, consistently passing |
| **A** | 90-94 | Very stable with rare failures |
| **B** | 80-89 | Generally stable with occasional issues |
| **C** | 70-79 | Moderately stable, needs attention |
| **D** | 60-69 | Unstable, frequent failures |
| **F** | < 60 | Critically unstable, requires immediate attention |

Tests with grades below your `stabilityThreshold` (default: 70 / C grade) are flagged with "Needs Attention" badges.

## Failure Clustering

The reporter automatically groups test failures by error type to help identify systematic issues:

- **Error Fingerprinting** - Failures are grouped by error message pattern (first line of stack trace)
- **Cluster Count** - Shows how many tests share the same root cause
- **Affected Files** - Lists which spec files contain the clustered failures
- **AI Analysis** - When enabled, provides a single fix suggestion for the entire cluster

This helps you fix multiple tests at once when they fail for the same reason (e.g., a broken API endpoint, missing element, or configuration issue).

## Performance Trends

- ↑ **Regression** - Test is slower than average
- ↓ **Improved** - Test is faster than average
- → **Stable** - Test is within normal range

## Trace Viewer

The report includes **Download Trace** and **View Trace** actions on tests with trace files.

### Inline Trace Viewer (v1.0.5+)

Click **View** to open traces directly in the dashboard without any CLI commands. The inline viewer includes:

- **Film Strip** - Visual timeline showing page snapshots throughout the test
- **Actions Panel** - Step-by-step view of all Playwright actions with timings
- **Before/After Screenshots** - See the page state before and after each action
- **Network Tab** - All network requests with waterfall visualization
- **Console Tab** - Browser console messages
- **Errors Tab** - Test failures and exceptions
- **Attachments Tab** - All test attachments

### CLI Trace Viewer

Alternatively, open traces via command line:

```bash
npx playwright-smart-reporter-view-trace ./traces/<trace>.zip
```

#### Options

| Flag | Description |
|------|-------------|
| `--dir <dir>` | Resolve trace path relative to this directory (default: current directory) |
| `-h, --help` | Show help message |

#### Examples

```bash
# Open a trace file directly
npx playwright-smart-reporter-view-trace ./traces/my-test-trace-0.zip

# Open a trace relative to report directory
npx playwright-smart-reporter-view-trace my-test-trace-0.zip --dir ./example

# The tool will search common locations if the file isn't found directly
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

## CSP-Safe Mode

If your organization has strict Content Security Policy (CSP) requirements, enable `cspSafe` mode:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    cspSafe: true,
  }],
]
```

### What CSP-Safe Mode Does

| Feature | Default Mode | CSP-Safe Mode |
|---------|--------------|---------------|
| Screenshots | Base64 data URIs embedded in HTML | Saved as separate PNG/JPEG files |
| Fonts | Google Fonts (external) | System fonts only |
| Trace data | Base64 embedded | File references only |
| Report size | Larger (self-contained) | Smaller (external files) |

### When to Use CSP-Safe Mode

- **Jenkins** or other CI systems with strict CSP headers
- **Corporate environments** that block inline data URIs
- **Large test suites** where embedded screenshots cause memory issues
- **Sharing reports** where smaller file size is preferred

**Note:** In CSP-safe mode, screenshots are saved alongside the HTML report. Make sure to include the entire report directory when archiving or sharing.

## History Drilldown

Enable `enableHistoryDrilldown` to click on history dots and view detailed results from previous runs:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    enableHistoryDrilldown: true,  // Default: false
    maxHistoryRuns: 10,
  }],
]
```

### How It Works

1. Each test card shows history dots representing recent runs (pass/fail indicators)
2. Click any dot to view that test's result from that historical run
3. A banner appears showing which run you're viewing
4. Click "Back to Current" to return to the latest results

### Storage Implications

When enabled, the reporter stores a JSON snapshot for each run in `history-runs/` directory alongside your history file:

```
test-history.json
history-runs/
  run-1706900000000.json
  run-1706900001000.json
  ...
```

**Disk usage:** ~1-5KB per test per run. For a suite of 500 tests with 10 runs retained, expect ~25-50MB of history data.

## Step Filtering

By default, the report shows all test steps including Playwright API calls (`pw:api`) like `locator('button').click()`. If you use custom `test.step()` descriptions, you may want to hide the verbose API calls.

### Configuration

```typescript
reporter: [
  ['playwright-smart-reporter', {
    // Hide pw:api steps, only show custom test.step entries
    filterPwApiSteps: true,
  }],
]
```

### Example

```typescript
// Your test code
test('login flow', async ({ page }) => {
  await test.step('Navigate to login page', async () => {
    await page.goto('/login');
  });

  await test.step('Enter credentials', async () => {
    await page.fill('#username', 'user');
    await page.fill('#password', 'pass');
  });

  await test.step('Submit login form', async () => {
    await page.click('button[type="submit"]');
  });
});
```

**With `filterPwApiSteps: false` (default):**
- Navigate to login page
- page.goto('/login')
- Enter credentials
- page.fill('#username', 'user')
- page.fill('#password', 'pass')
- Submit login form
- page.click('button[type="submit"]')

**With `filterPwApiSteps: true`:**
- Navigate to login page
- Enter credentials
- Submit login form

## Multi-Project History

When running different test suites (API tests, UI tests, regression, smoke), you may want separate history files to avoid mixing metrics. Use the `projectName` option to isolate history per project.

### Configuration

```typescript
// For API tests
reporter: [
  ['playwright-smart-reporter', {
    projectName: 'api',
    // Creates: test-history-api.json
  }],
]

// For UI tests
reporter: [
  ['playwright-smart-reporter', {
    projectName: 'ui',
    // Creates: test-history-ui.json
  }],
]

// Using {project} placeholder
reporter: [
  ['playwright-smart-reporter', {
    projectName: 'regression',
    historyFile: 'reports/{project}/history.json',
    // Creates: reports/regression/history.json
  }],
]
```

### Path Resolution

By default, `outputFile` and `historyFile` are resolved relative to Playwright's `rootDir`. If you prefer paths relative to your current working directory, enable `relativeToCwd`:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    relativeToCwd: true,
    outputFile: './reports/smart-report.html',
    historyFile: './reports/test-history.json',
  }],
]
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

#### Azure DevOps

```yaml
# azure-pipelines.yml
trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Install Node.js'

  - script: npm ci
    displayName: 'Install dependencies'

  - script: npx playwright install --with-deps
    displayName: 'Install Playwright browsers'

  # Cache test history for flakiness detection
  - task: Cache@2
    inputs:
      key: 'test-history | "$(Build.SourceBranchName)"'
      restoreKeys: |
        test-history |
      path: test-history.json
    displayName: 'Cache test history'

  - script: npx playwright test
    displayName: 'Run Playwright tests'
    continueOnError: true

  # Publish the HTML report as a pipeline artifact
  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: 'smart-report.html'
      artifact: 'playwright-smart-report'
      publishLocation: 'pipeline'
    displayName: 'Publish Smart Report'
    condition: always()

  # Optional: Publish test results for Azure DevOps test tab
  - task: PublishTestResults@2
    inputs:
      testResultsFormat: 'JUnit'
      testResultsFiles: 'test-results/results.xml'
      mergeTestResults: true
    displayName: 'Publish test results'
    condition: always()
```

**Viewing the Report in Azure DevOps:**
1. After the pipeline runs, go to the pipeline summary
2. Click on "Published" under the artifacts section
3. Download or view the `playwright-smart-report` artifact
4. Open `smart-report.html` in your browser

**Alternative: Publish to Azure DevOps Wiki or Static Site:**
```yaml
# Upload report to Azure Blob Storage for easy viewing
- task: AzureCLI@2
  inputs:
    azureSubscription: 'your-subscription'
    scriptType: 'bash'
    scriptLocation: 'inlineScript'
    inlineScript: |
      az storage blob upload \
        --account-name yourstorageaccount \
        --container-name reports \
        --name "playwright-report-$(Build.BuildId).html" \
        --file smart-report.html \
        --content-type "text/html"
  displayName: 'Upload report to Azure Storage'
  condition: always()
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

### Merge History CLI Reference

The `playwright-smart-reporter-merge-history` command combines history files from parallel CI runs.

#### Options

| Flag | Description |
|------|-------------|
| `-o, --output <file>` | Output file path (default: `merged-history.json`) |
| `--max-runs <number>` | Limit history to N most recent runs |
| `-h, --help` | Show help message |

#### Examples

```bash
# Basic merge of two files
npx playwright-smart-reporter-merge-history \
  run1/test-history.json \
  run2/test-history.json \
  -o merged-history.json

# Merge with glob pattern (requires glob package)
npx playwright-smart-reporter-merge-history \
  'blob-reports/**/test-history.json' \
  -o test-history.json

# Limit to 10 most recent runs to manage history size
npx playwright-smart-reporter-merge-history \
  run1/test-history.json \
  run2/test-history.json \
  -o merged.json \
  --max-runs 10
```

#### What Gets Merged

- **Test entries** - Combined and sorted by timestamp
- **Run metadata** - Deduplicated by run ID
- **Run summaries** - Deduplicated and sorted chronologically
- **Pass rates** - Recalculated from merged data

#### 4. Merge blob reports

```bash
cp blob-reports/machine1/*.zip blob-reports/machine2/*.zip blob-reports/merged/
npx playwright merge-reports --reporter=playwright-smart-reporter blob-reports/merged
```

## Multi-Browser Support

When running tests across multiple browsers or projects, the reporter displays browser and project information:

### What's Displayed

- **Browser badge** - Shows which browser the test ran on (🌐 Chromium, 🦊 Firefox, 🧭 WebKit)
- **Project badge** - Shows the Playwright project name (e.g., "Desktop Chrome", "Mobile Safari")
- **Data attributes** - `data-browser` and `data-project` for custom filtering

### Example Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
  ],
  reporter: [['playwright-smart-reporter']],
});
```

The report will show badges like `🌐 chromium` or `🧭 webkit` next to each test, making it easy to identify browser-specific failures.

## Annotations Display

Beyond tags, the reporter now displays all test annotations including `@slow`, `@fixme`, `@skip`, and custom annotations:

### Supported Annotation Types

| Annotation | Icon | Description |
|------------|------|-------------|
| `slow` | 🐢 | Test marked as slow |
| `fixme` / `fix` | 🔧 | Known issue to be fixed |
| `skip` | ⏭️ | Skipped with reason |
| `fail` | ❌ | Expected to fail |
| `issue` / `bug` | 🐛 | Associated issue |
| `flaky` | 🎲 | Known flaky test |
| `todo` | 📝 | Work in progress |
| Custom | 📌 | Any other annotation |

### Example Usage

```typescript
test('payment flow', async ({ page }) => {
  test.slow();  // Will show 🐢 slow badge
  // ...
});

test('known issue', async ({ page }) => {
  test.fixme();  // Will show 🔧 fixme badge
  // ...
});

test.skip('not implemented', async ({ page }) => {
  // Will show ⏭️ skip badge with reason
});

// Custom annotations
test('feature test', async ({ page }) => {
  test.info().annotations.push({ type: 'issue', description: 'JIRA-123' });
  // Will show 🐛 issue badge
});
```

## Cucumber Integration

Smart Reporter works with Playwright + Cucumber frameworks. Here's how to set it up:

### With @cucumber/cucumber and playwright-bdd

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
});

export default defineConfig({
  testDir,
  reporter: [
    ['playwright-smart-reporter', {
      outputFile: 'reports/smart-report.html',
      historyFile: 'reports/test-history.json',
    }],
  ],
});
```

### With cucumber-playwright

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './features',
  testMatch: '**/*.feature',
  reporter: [
    ['playwright-smart-reporter', {
      outputFile: 'cucumber-smart-report.html',
    }],
  ],
});
```

### Notes on Cucumber Integration

- Feature file names appear in the test file path
- Scenario names appear as test titles
- Scenario outlines generate multiple test entries (one per example)
- Tags from feature files (`@smoke`, `@regression`) are captured
- Step timings are captured from Cucumber's step hooks

## Frequently Asked Questions

### Does Smart Reporter support Python/pytest-playwright?

**No.** Smart Reporter is a Node.js/TypeScript package designed specifically for `@playwright/test`. It cannot be installed via pip or used with Python-based Playwright.

**Alternatives for Python:**
- [pytest-html](https://pytest-html.readthedocs.io/) - HTML reports for pytest
- [allure-pytest](https://allurereport.org/docs/pytest/) - Feature-rich reporting
- [pytest-playwright's built-in options](https://playwright.dev/python/docs/test-runners)

### I'm getting RangeError with large test suites (~300 tests)

This was fixed in **v1.0.6**. Update to the latest version:

```bash
npm update playwright-smart-reporter
# or
npm install playwright-smart-reporter@latest
```

The fix removes large base64 data (screenshots, traces) from embedded JSON while preserving visual display.

### Why does Smart Reporter show different flakiness than Playwright's HTML report?

See [Flakiness Detection: Smart Reporter vs Playwright](#flakiness-detection-smart-reporter-vs-playwright) - they use different methodologies (historical vs single-run).

### How do I see which browser a test ran on?

As of the latest version, browser badges are automatically displayed when using multi-project/multi-browser configurations. Look for badges like `🌐 chromium` or `🦊 firefox` next to test titles.

## Troubleshooting

### Common Issues

#### Report shows "No history data"
- **Cause:** History file doesn't exist or is in wrong location
- **Fix:** Ensure `historyFile` path is correct and file persists between runs (use CI caching)

#### Network logs not appearing
- **Cause:** Tracing is not enabled in Playwright config
- **Fix:** Add `trace: 'retain-on-failure'` or `trace: 'on'` to your `use` config

#### Screenshots not displaying in CSP-safe mode
- **Cause:** Screenshot files are not in same directory as HTML report
- **Fix:** Ensure entire report directory is copied/archived, not just the HTML file

#### AI suggestions not appearing
- **Cause:** No API key configured or API errors
- **Fix:** Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` environment variable

#### History metrics are mixed between projects
- **Cause:** Same history file used for different test suites
- **Fix:** Use `projectName` option to isolate history per project

#### Paths resolve to wrong location
- **Cause:** Paths relative to Playwright's `rootDir` instead of project root
- **Fix:** Enable `relativeToCwd: true` or use absolute paths

#### Large report causes browser to hang
- **Cause:** Too many tests with embedded screenshots/traces
- **Fix:** Enable `cspSafe: true` to save attachments as files, or reduce `maxHistoryRuns`

### Debug Mode

For debugging reporter issues, check console output for:
- `📊 Smart Report:` - Shows where report was saved
- `🤖 Analyzing X failure(s) with AI...` - Confirms AI analysis is running
- Errors during report generation are logged to console

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
