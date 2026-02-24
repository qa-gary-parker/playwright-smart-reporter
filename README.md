# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, performance regression alerts, and a modern interactive dashboard.

![Report Overview](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/report-overview-v1.png)
*Dashboard featuring: sidebar navigation, suite health grade, attention-based filtering, failure clusters, quick insights, and interactive trend charts*

## Installation

```bash
# Node.js / Playwright
npm install -D playwright-smart-reporter

# Python / pytest
pip install playwright-smart-reporter-python
```

For Python usage, see the [Python README](./python/README.md).

## Quick Start

Add to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['playwright-smart-reporter', {
      outputFile: 'smart-report.html',
      historyFile: 'test-history.json',
      maxHistoryRuns: 10,
    }],
  ],
});
```

## Features

### Core Analysis
- **AI Failure Analysis** — Claude/OpenAI/Gemini-powered fix suggestions with batched analysis for large suites
- **Flakiness Detection** — Historical tracking to identify unreliable tests (not single-run retries)
- **Performance Regression Alerts** — Warns when tests get significantly slower than average
- **Stability Scoring** — Composite health metrics (0-100 with grades A+ to F)
- **Failure Clustering** — Group similar failures by error type with error previews and AI analysis
- **Test Retry Analysis** — Track tests that frequently need retries

### Interactive Dashboard
- **Sidebar Navigation** — Overview, Tests, Trends, Comparison, Gallery views
- **Theme Support** — Light, dark, and system theme with persistent preference
- **Keyboard Shortcuts** — `1-5` switch views, `j/k` navigate tests, `f` focus search, `e` export summary
- **Virtual Scroll** — Pagination for large test suites (500+ tests)
- **Exportable Summary Card** — One-click export of test run summary

### Step Timeline (v1.0.8)
- **Flamechart Visualisation** — Colour-coded timeline bars showing step-level timing
- **Categories** — Navigation (blue), Assertion (green), Action (purple), API (amber), Wait (grey)
- **Step Filtering** — `filterPwApiSteps: true` hides verbose `pw:api` internal steps

### Enhanced Trend Charts (v1.0.8)
- **Moving Averages** — Overlay on pass rate and duration trends
- **Anomaly Detection** — 2-sigma outlier detection with visual markers
- **Clickable History** — Click any chart bar to drill into that historical run

### CI Environment Detection (v1.0.8)
- **Auto-detect** — GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure DevOps, Buildkite
- **Report Header** — Displays branch, commit SHA, and build ID automatically
- **External Run ID** — `runId` option for consistent history across sharded CI runs

### Test Details
- **Step Timing Breakdown** — Visual bars highlighting the slowest steps
- **Network Logs** — API calls with status codes, timing, and payload details (from trace files)
- **Inline Trace Viewer** — View traces directly in the dashboard
- **Screenshot Embedding** — Failure screenshots displayed inline
- **Browser & Project Badges** — Shows which browser/project each test ran against
- **Annotation Support** — `@slow`, `@fixme`, `@skip`, `@issue`, custom annotations with styled badges

### Integration
- **Slack/Teams Notifications** — Webhook alerts on failures
- **Merge History CLI** — Combine parallel CI run histories
- **Local Report Server** — `npx playwright-smart-reporter-serve report.html` with trace viewer support
- **JSON Export** — Download results for external processing

## Configuration

### Full Options Reference

```typescript
reporter: [
  ['playwright-smart-reporter', {
    // Core
    outputFile: 'smart-report.html',
    historyFile: 'test-history.json',
    maxHistoryRuns: 10,
    performanceThreshold: 0.2,

    // Notifications
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    teamsWebhook: process.env.TEAMS_WEBHOOK_URL,

    // Feature flags (all default to true unless noted)
    enableRetryAnalysis: true,
    enableFailureClustering: true,
    enableStabilityScore: true,
    enableGalleryView: true,
    enableComparison: true,
    enableAIRecommendations: true,
    enableTrendsView: true,
    enableTraceViewer: true,
    enableHistoryDrilldown: false,    // default: false
    enableNetworkLogs: true,

    // Step and path options
    filterPwApiSteps: false,          // Hide pw:api steps
    relativeToCwd: false,             // Paths relative to cwd instead of rootDir

    // Multi-project
    projectName: 'ui-tests',          // Isolate history per project
    runId: process.env.GITHUB_RUN_ID, // Consistent ID across CI shards

    // Network logging
    networkLogFilter: 'api.example.com',
    networkLogExcludeAssets: true,
    networkLogMaxEntries: 50,

    // Thresholds
    stabilityThreshold: 70,
    retryFailureThreshold: 3,
    baselineRunId: 'main-branch-baseline',

    // Configurable thresholds (v1.0.8)
    thresholds: {
      flakinessStable: 0.1,           // Below this = stable
      flakinessUnstable: 0.3,         // Below this = unstable, above = flaky
      performanceRegression: 0.2,     // 20% slower triggers regression
      stabilityWeightFlakiness: 0.4,  // Must sum to 1.0
      stabilityWeightPerformance: 0.3,
      stabilityWeightReliability: 0.3,
      gradeA: 90,
      gradeB: 80,
      gradeC: 70,
      gradeD: 60,
    },

    // Advanced
    cspSafe: false,                   // CSP-compliant mode (file refs instead of base64)
    maxEmbeddedSize: 5 * 1024 * 1024, // Max bytes for inline base64 traces
  }],
]
```

### AI Analysis

Set one of these environment variables to enable AI-powered failure analysis:

```bash
export ANTHROPIC_API_KEY=your-key    # Claude (preferred)
export OPENAI_API_KEY=your-key       # OpenAI
export GEMINI_API_KEY=your-key       # Google Gemini
```

Provider priority: Anthropic > OpenAI > Gemini. The reporter analyses failures in batches and provides fix suggestions in the report.

## Report Views

### Overview
Pass rate ring, suite health grade (A+ to F), stat cards, attention-required highlights, failure clusters, and quick insights (slowest test, most flaky, distribution).

### Tests
Filter by status, health, grade, attention badges, suite, and tags. Search by name. Each card shows duration, stability grade, flakiness indicator, history dots (clickable for drilldown), and expandable details with steps, errors, screenshots, and AI suggestions.

### Trends
Interactive charts for pass rate, duration, flaky tests, and slow tests over time. Moving averages and anomaly markers. Click any bar to view that historical run.

### Comparison
Compare current run against a baseline: pass rate change, duration change, test count differences.

### Gallery
Visual grid of all test attachments — screenshots, videos, and trace files with status filtering.

## Flakiness Detection

Smart Reporter tracks flakiness **across runs**, not within a single run:

| | Playwright HTML Report | Smart Reporter |
|---|---|---|
| **Scope** | Single test run | Historical across multiple runs |
| **Criteria** | Fails then passes on retry | Failed 30%+ of the time historically |
| **Use Case** | Immediate retry success | Chronically unreliable tests |

Indicators:
- **Stable** (<10% failure rate) — **Unstable** (10-30%) — **Flaky** (>30%) — **New** (no history)

## Stability Grades

Composite score (0-100) from three factors:

| Factor | Weight | Description |
|---|---|---|
| Flakiness | 40% | Inverse of flakiness score |
| Performance | 30% | Execution time consistency |
| Reliability | 30% | Pass rate from history |

Grades: **A+** (95-100), **A** (90-94), **B** (80-89), **C** (70-79), **D** (60-69), **F** (<60). All weights and thresholds are configurable via `ThresholdConfig`.

## Step Filtering

```typescript
reporter: [
  ['playwright-smart-reporter', {
    filterPwApiSteps: true,  // Only show custom test.step() entries
  }],
]
```

With filtering on, verbose `page.click()`, `page.fill()` steps are hidden — only your named `test.step()` entries appear.

## Multi-Project History

Isolate history per test suite to prevent metric contamination:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    projectName: 'api',
    historyFile: 'reports/{project}/history.json',
    // Creates: reports/api/history.json
  }],
]
```

## Trace Viewer

### Inline Viewer
Click **View** on any test with traces to open the built-in viewer with film strip, actions panel, before/after screenshots, network waterfall, console messages, and errors.

### Local Server
```bash
npx playwright-smart-reporter-serve smart-report.html
```
Serves the report locally with full trace viewer support — no `file://` CORS issues.

### CLI Viewer
```bash
npx playwright-smart-reporter-view-trace ./traces/my-test-trace-0.zip
```

## Network Logs

Automatically extracted from Playwright trace files — no code changes required. Shows method, URL, status code, duration, and payload sizes. Requires tracing enabled:

```typescript
use: {
  trace: 'retain-on-failure',  // or 'on'
}
```

## CSP-Safe Mode

For environments with strict Content Security Policy:

```typescript
reporter: [
  ['playwright-smart-reporter', { cspSafe: true }],
]
```

Screenshots saved as separate files instead of base64, system fonts instead of Google Fonts, file references instead of embedded data. Smaller report size but requires the entire report directory to be shared.

## History Drilldown

```typescript
reporter: [
  ['playwright-smart-reporter', {
    enableHistoryDrilldown: true,
    maxHistoryRuns: 10,
  }],
]
```

Click history dots on any test card to view results from previous runs. Stores JSON snapshots in `history-runs/` (~1-5KB per test per run).

## Annotations

| Annotation | Badge | Annotation | Badge |
|---|---|---|---|
| `@slow` | Amber | `@fixme` / `@fix` | Pink |
| `@skip` | Indigo | `@fail` | Red |
| `@issue` / `@bug` | Red | `@flaky` | Orange |
| `@todo` | Blue | Custom | Grey |

```typescript
test('payment flow', async ({ page }) => {
  test.slow();  // Shows amber @slow badge
  test.info().annotations.push({ type: 'issue', description: 'JIRA-123' });
});
```

## CI Integration

### Persisting History

History must persist between runs for flakiness detection and trends to work.

#### GitHub Actions

```yaml
- uses: actions/cache@v4
  with:
    path: test-history.json
    key: test-history-${{ github.ref }}
    restore-keys: test-history-

- run: npx playwright test

- uses: actions/cache/save@v4
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
    paths: [test-history.json]
    policy: pull-push
  script: npx playwright test
```

#### CircleCI

```yaml
- restore_cache:
    keys: [test-history-{{ .Branch }}, test-history-]
- run: npx playwright test
- save_cache:
    key: test-history-{{ .Branch }}-{{ .Revision }}
    paths: [test-history.json]
```

#### Azure DevOps

```yaml
steps:
  - task: Cache@2
    inputs:
      key: 'test-history | "$(Build.SourceBranchName)"'
      restoreKeys: 'test-history |'
      path: test-history.json

  - script: npx playwright test
    continueOnError: true

  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: smart-report.html
      artifact: playwright-smart-report
    condition: always()
```

### CI Auto-Detection

The reporter automatically detects GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure DevOps, and Buildkite. Branch, commit SHA, and build ID are displayed in the report header.

### Sharded Runs

For consistent history across parallel shards, set `runId`:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    runId: process.env.GITHUB_RUN_ID,
  }],
]
```

### Merging History from Multiple Machines

```bash
npx playwright-smart-reporter-merge-history \
  shard1/test-history.json \
  shard2/test-history.json \
  -o merged-history.json \
  --max-runs 10
```

## Multi-Browser Support

Browser and project badges are automatically displayed for multi-project configs:

```typescript
export default defineConfig({
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  reporter: [['playwright-smart-reporter']],
});
```

## Cucumber Integration

Works with Playwright + Cucumber frameworks:

```typescript
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'features/**/*.feature',
  steps: 'steps/**/*.ts',
});

export default defineConfig({
  testDir,
  reporter: [['playwright-smart-reporter']],
});
```

Feature file names appear as test file paths, scenario names as test titles, and tags are captured.

## FAQ

### Does Smart Reporter support Python/pytest?

**Yes.** Install via `pip install playwright-smart-reporter-python`. See the [Python README](./python/README.md) for details. Node.js 18+ is required at runtime.

### RangeError with large test suites?

Fixed in v1.0.6. Update: `npm install playwright-smart-reporter@latest`

### Different flakiness than Playwright's HTML report?

They use different methodologies — see [Flakiness Detection](#flakiness-detection) above.

### Report too large or browser hangs?

Enable `cspSafe: true` to save attachments as files instead of embedding, or reduce `maxHistoryRuns`. Use `maxEmbeddedSize` to control the inline trace threshold.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| No history data | History file missing or wrong path | Check `historyFile` path, use CI caching |
| No network logs | Tracing not enabled | Add `trace: 'retain-on-failure'` to config |
| No AI suggestions | Missing API key | Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` |
| Mixed project metrics | Shared history file | Use `projectName` to isolate |
| Wrong path resolution | Relative to rootDir | Enable `relativeToCwd: true` |

## Development

```bash
npm install
npm run build
npm test        # 210 tests
npm run test:demo
```

## Contributors

- [Gary Parker](https://github.com/qa-gary-parker) — Creator and maintainer
- [Filip Gajic](https://github.com/Morph93) — v1.0.0 UI redesign
- [Liam Childs](https://github.com/liamchilds) — Parameterized project support

## License

MIT
