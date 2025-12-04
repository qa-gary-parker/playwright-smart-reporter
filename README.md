# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, and performance regression alerts.

![Report Overview](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/report-overview.png)

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

## Installation

```bash
npm install playwright-smart-reporter
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

### Pass Rate Trend Chart

![Trend Chart](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/trend-chart-hover.png)

Visual stacked bar chart showing test status across runs:
- **Green** - Passed tests
- **Red** - Failed tests
- **Gray** - Skipped tests
- Hover over any segment to see the count
- Current run highlighted with glow effect

Secondary trend charts show:
- **Duration** - Suite execution time per run
- **Flaky** - Number of flaky tests detected
- **Slow** - Number of slow tests detected

### Flakiness Indicators
- 🟢 **Stable** (<10% failure rate)
- 🟡 **Unstable** (10-30% failure rate)
- 🔴 **Flaky** (>30% failure rate)
- ⚪ **New** (no history yet)
- ⚪ **Skipped** (test was skipped)

### Performance Trends
- ↑ **Regression** - Test is slower than average
- ↓ **Improved** - Test is faster than average
- → **Stable** - Test is within normal range

### Per-Test History Visualization

![Expanded Test](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/test-expanded-ai.png)

When you expand a test, you'll see:
- **Pass/Fail Sparkline** - Green/red/gray dots showing the pattern
- **Duration Trend Chart** - Bar chart showing how duration changes
- **Step Timings** - Visual breakdown with slowest step highlighted
- **Error Details** - Full error message with stack trace
- **Screenshot** - Embedded failure screenshot (click to expand)
- **AI Suggestion** - AI-powered fix recommendations
- Current run highlighted with border/purple color

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

## License

MIT
