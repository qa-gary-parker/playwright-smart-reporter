# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, and performance regression alerts.

![Report Overview](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/report-overview.png)
*v0.7.0 dashboard showing: stability score filtering (A-F grades), trend charts, run comparison, attachment gallery, and comprehensive test results*

## Features

- **AI Failure Analysis** - Get AI-powered suggestions to fix failing tests (Claude/OpenAI)
- **Flakiness Detection** - Tracks test history to identify unreliable tests
- **Performance Regression Alerts** - Warns when tests get significantly slower
- **Pass Rate Trend Chart** - Visual graph showing pass rates across runs
- **Per-Test History** - Sparklines and duration charts for each test
- **Step Timing Breakdown** - See which steps are slowest with visual bars
- **Screenshot Embedding** - Failure screenshots displayed inline
- **Video Links** - Quick access to test recordings
- **One-Click Trace Viewing** - Downloads trace and opens trace.playwright.dev
- **Collapsible File Groups** - Tests organized by file
- **Search & Filter** - Find tests by name, filter by status
- **JSON Export** - Download results for external processing
- **Slack/Teams Notifications** - Get alerted on failures
- **CI Integration** - Auto-detects GitHub, GitLab, CircleCI, Jenkins, Azure DevOps
- ✨ **NEW: Test Retry Analysis** - Track tests that frequently need retries
- ✨ **NEW: Failure Clustering** - Group similar failures by error type
- ✨ **NEW: Stability Scoring** - Composite health metrics (0-100 with letter grades)
- ✨ **NEW: Attachment Gallery** - Grid view of all screenshots, videos, and traces
- ✨ **NEW: Run Comparison** - Compare current run vs baseline to see what changed
- ✨ **NEW: Smart Recommendations** - AI-powered actionable insights
- ✨ **NEW: Trace Viewer Integration** - Open Playwright traces directly from report
- ✨ **NEW: Merge History CLI** - Combine parallel CI run histories

## New in v0.7.0

### UI Improvements
- **Copy Buttons** - One-click copy for AI suggestions and code blocks
- **Keyboard Navigation** - Use `j`/`k` to navigate tests, `Enter` to expand/collapse
- **Collapsible Trends** - Click to expand/collapse the trend charts section
- **New Test Filter** - Filter to show only first-time tests (no history yet)

### Bug Fixes
- **Pass Rate Consistency** - Fixed inconsistent pass rate calculations across header, charts, and comparisons. All now use `passed / total` formula.

### Code Quality
- Major internal code cleanup removing 2,200+ lines of dead code
- Improved type safety throughout chart generation
- Added null safety checks in gallery lightbox

---

## New in v0.5.0

### Test Retry Analysis

Track tests that require multiple attempts to pass. The report now identifies tests with high retry rates, helping you spot unreliable tests that pass inconsistently.

- Automatically detects tests that passed only after retries
- Shows retry count for each test
- Highlights tests that exceed the retry threshold (default: 3)
- Helps identify flaky tests that might pass/fail randomly

### Failure Clustering

Automatically groups similar failures together by analyzing error messages and stack traces. This makes it easier to identify patterns and common root causes across multiple test failures.

- Groups failures by error type (timeout, assertion, network, etc.)
- Shows count of similar failures in each cluster
- Helps prioritize fixes by identifying widespread issues
- Reduces noise when debugging multiple failures

### Stability Scoring

Comprehensive health metrics that give each test a stability score from 0-100 with letter grades (A+ to F).

- **A+ (95-100)**: Rock solid, consistently passing
- **A (90-94)**: Very stable with rare failures
- **B (80-89)**: Generally stable with occasional issues
- **C (70-79)**: Moderately stable, needs attention
- **D (60-69)**: Unstable, frequent failures
- **F (<60)**: Critically unstable, requires immediate attention

Scores are calculated based on:
- Pass rate over recent runs
- Retry frequency
- Performance consistency
- Failure patterns

### Attachment Gallery

New gallery view displaying all test attachments (screenshots, videos, traces) in an organized grid layout.

- Visual grid of all screenshots from test runs
- Quick access to videos and trace files
- Filter by test status or file name
- Thumbnail previews with click-to-expand
- Trace Viewer integration - open `.zip` traces directly in Playwright's trace viewer

### Run Comparison

Compare the current test run against a baseline to see exactly what changed.

- Side-by-side comparison of test results
- Highlights new failures, new passes, and regressions
- Shows performance changes (faster/slower)
- Identifies newly added or removed tests
- Configure baseline using `baselineRunId` option

### Smart Recommendations

AI-powered actionable insights based on your test results. The reporter analyzes patterns and provides specific recommendations:

- Suggests tests to investigate based on failure patterns
- Identifies performance bottlenecks
- Recommends retry configuration adjustments
- Highlights flaky tests that need stabilization
- Provides priority-ranked action items

### Merge History CLI

New command-line tool for combining test histories from parallel CI runs.

```bash
# Merge histories from multiple parallel shards
npx playwright-smart-reporter-merge-history history1.json history2.json -o merged.json

# Use glob patterns for multiple files
npx playwright-smart-reporter-merge-history 'blob-reports/**/test-history.json' -o test-history.json --max-runs 10
```

This is essential for maintaining accurate history when running tests in parallel across multiple machines or shards.

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
      // v0.5.0 features
      enableRetryAnalysis: true,
      enableFailureClustering: true,
      enableStabilityScore: true,
      enableGalleryView: true,
      enableComparison: true,
      enableAIRecommendations: true,
      enableTraceViewer: true,
      enableHistoryDrilldown: false,
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
| `enableHistoryDrilldown` | `false` | Store small per-run snapshots so you can click history dots to view historical runs |
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
```

The reporter will automatically analyze failures and provide fix suggestions in the report.

## Report Features

### Summary Dashboard
- Pass rate ring with percentage
- Pass/fail/skip counts
- Flaky test count
- Slow test count
- Total duration

### Trend Charts

![Trend Charts](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/trend-chart-hover.png)
*Responsive 2x2 grid layout with interactive tooltips showing exact values on hover*

Visual charts showing test history across runs:

**Main Trend Chart** (top):
- **Green** - Passed tests
- **Red** - Failed tests
- **Gray** - Skipped tests
- Hover over any bar to see exact counts
- Current run highlighted with border

**Secondary Charts** (2x2 grid):
- **Duration** - Suite execution time per run with values on hover
- **Flaky** - Number of flaky tests detected per run
- **Slow** - Number of slow tests detected per run
- **Run Comparison** - Diff against baseline showing changes

### Flakiness Indicators
- 🟢 **Stable** (<10% failure rate)
- 🟡 **Unstable** (10-30% failure rate)
- 🔴 **Flaky** (>30% failure rate)
- ⚪ **New** (no history yet)
- ⚪ **Skipped** (test was skipped)

### Trace Viewer

The report includes **Download Trace** and **View Trace** actions on failed tests (and in the gallery when enabled).

`View Trace` uses Playwright's native trace viewer (`npx playwright show-trace ...`) via the helper command below.

To open a specific trace directly in Trace Viewer (starts the server automatically and opens the right URL):

```bash
npx playwright-smart-reporter-view-trace ./traces/<trace>.zip
```

### Performance Trends
- ↑ **Regression** - Test is slower than average
- ↓ **Improved** - Test is faster than average
- → **Stable** - Test is within normal range

### Per-Test Details

![Expanded Test](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/test-expanded-ai.png)
*Expanded failed test showing: run history sparkline, duration trend chart, step timings with SLOWEST badge, clean error display (no ANSI codes), embedded screenshot, and AI-powered suggestions*

When you expand a test, you'll see:
- **Pass/Fail Sparkline** - Green/red/gray dots showing the pattern across runs
- **Duration Trend Chart** - Bar chart showing performance over time
- **Step Timings** - Visual breakdown with slowest step highlighted (SLOWEST badge)
- **Error Details** - Clean error messages with ANSI escape codes stripped
- **Screenshot** - Embedded failure screenshot (click to expand to full size)
- **AI Suggestion** - Contextual fix recommendations from Claude or OpenAI
- **Retry Information** - Shows which retry attempt passed (if applicable)
- **Stability Score** - Letter grade (A-F) indicating test health
- Current run highlighted with distinct styling

### Step Timings
- Visual bar chart of step durations
- "SLOWEST" badge on the slowest step
- Helps identify bottlenecks in your tests

### Additional Features
- **Screenshot embedding** - Failure screenshots shown inline
- **Video links** - Quick access to recordings
- **Trace viewing** - Downloads trace and opens Playwright's trace viewer
- **Retry badge** - Shows if test passed on retry
- **Search** - Filter tests by name or file
- **File groups** - Collapsible groups by file
- **JSON export** - Download full results

## CI Integration

### Persisting History Across Runs

For flakiness detection and performance trends to work in CI, you need to persist `test-history.json` between runs.

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

This metadata is stored with each run for debugging and audit purposes.

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

Notifications include:
- Summary of passed/failed tests
- List of first 5 failed test names
- Only sent when there are failures

### Merging Reports from Multiple Machines

When running tests in parallel across multiple machines (sharding), you can merge both the test results and history files.

#### 1. Configure each machine to output blobs and history

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

The merged report will include all tests from all machines with unified history for flakiness detection and trend charts.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run demo tests
npm run test:demo

# Open the report
open example/smart-report.html
```

### Merge History CLI

When running tests in parallel across multiple machines or CI shards, use the merge history CLI tool to combine test histories:

```bash
# Merge parallel test histories
npx playwright-smart-reporter-merge-history history1.json history2.json -o merged.json

# Use with glob patterns
npx playwright-smart-reporter-merge-history 'blob-reports/**/test-history.json' -o test-history.json --max-runs 10
```

This ensures your flakiness detection and performance trends work correctly even with parallelized test execution. The merged history maintains all the metadata from individual runs while deduplicating test results.

## License

MIT
