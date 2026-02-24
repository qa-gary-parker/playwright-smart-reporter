# playwright-smart-reporter

![Let's Build QA](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/lets-build-qa-banner.png)

An intelligent Playwright HTML reporter with AI-powered failure analysis, flakiness detection, performance regression alerts, and a modern interactive dashboard. Free + Pro tiers — same npm package, Pro unlocks with a license key.

![Report Overview](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/report-overview-v1.1.png)
*Dashboard featuring: sidebar navigation, suite health grade, attention-based filtering, failure clusters, quick insights, and interactive trend charts*

## Installation

```bash
npm install -D playwright-smart-reporter
```

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

Run your tests and open the generated `smart-report.html`.

## Free vs Pro

The free tier includes everything you need for local test reporting. Pro adds premium themes, PDF exports, quality gates, and more — activated with a license key.

| Feature | Free | Pro |
|---|:---:|:---:|
| AI failure analysis (Claude/OpenAI/Gemini) | ✅ | ✅ |
| Stability grades (A+ to F) | ✅ | ✅ |
| Flakiness detection & history tracking | ✅ | ✅ |
| Run comparison & trend analytics | ✅ | ✅ |
| Artifact gallery & trace viewer | ✅ | ✅ |
| Network logs & step timeline | ✅ | ✅ |
| CI auto-detection & notifications | ✅ | ✅ |
| 3 themes (System, Light, Dark) | ✅ | ✅ |
| 6 additional Pro themes | | ✅ |
| Executive PDF export (3 variants) | | ✅ |
| JSON + JUnit export | | ✅ |
| Quality gates (fail builds on thresholds) | | ✅ |
| Flaky test quarantine | | ✅ |
| Custom report branding (title, footer, colours) | | ✅ |
| Custom theme colours | | ✅ |
| AI health digest | | ✅ |

**Get a Pro license at [stagewright.dev](https://stagewright.dev)**

### Activating Pro

Set your license key via environment variable or config:

```bash
# Environment variable
export SMART_REPORTER_LICENSE_KEY=your-license-key
```

```typescript
// Or in playwright.config.ts
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: 'your-license-key',
  }],
]
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

### Test Details

![Test Expanded](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/test-expanded.png)
*Expanded test card with step timeline, error details, and AI suggestions*

- **Step Timing Breakdown** — Visual bars highlighting the slowest steps
- **Flamechart Visualisation** — Colour-coded timeline bars (navigation, assertion, action, API, wait)
- **Network Logs** — API calls with status codes, timing, and payload details (from trace files)
- **Inline Trace Viewer** — View traces directly in the dashboard
- **Screenshot Embedding** — Failure screenshots displayed inline
- **Browser & Project Badges** — Shows which browser/project each test ran against
- **Annotation Support** — `@slow`, `@fixme`, `@skip`, `@issue`, custom annotations with styled badges

### Trend Analytics

![Trend Charts](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/trend-chart-hover.png)
*Interactive trend charts with moving averages and anomaly detection*

- **Moving Averages** — Overlay on pass rate and duration trends
- **Anomaly Detection** — 2-sigma outlier detection with visual markers
- **Clickable History** — Click any chart bar to drill into that historical run

### Artifact Gallery

![Gallery View](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/gallery-view.png)
*Visual grid of screenshots, videos, and trace files*

### Trace Viewer

![Trace Viewer](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/trace-viewer.png)
*Built-in trace viewer with film strip, actions, network waterfall, and console*

### Flakiness Detection

![Flaky Tests](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/flaky-test-details.png)
*Historical flakiness tracking with stability indicators*

Smart Reporter tracks flakiness **across runs**, not within a single run:

| | Playwright HTML Report | Smart Reporter |
|---|---|---|
| **Scope** | Single test run | Historical across multiple runs |
| **Criteria** | Fails then passes on retry | Failed 30%+ of the time historically |
| **Use Case** | Immediate retry success | Chronically unreliable tests |

Indicators:
- **Stable** (<10% failure rate) — **Unstable** (10-30%) — **Flaky** (>30%) — **New** (no history)

## Pro Features

### Pro Themes

6 additional themes beyond the 3 free ones: **Ocean**, **Sunset**, **Dracula**, **Cyberpunk**, **Forest**, and **Rose**. Set via config:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    theme: 'dracula',  // ocean, sunset, dracula, cyberpunk, forest, rose
  }],
]
```

### Executive PDF Export

Generate professional PDF reports in 3 themed variants: **Corporate**, **Minimal**, and **Dark**. Includes a style picker modal in the HTML report.

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    pdfExport: true,
    pdfStyle: 'corporate',  // corporate, minimal, dark
  }],
]
```

### Quality Gates

Fail CI builds when test results don't meet your thresholds:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    qualityGates: {
      minPassRate: 95,
      maxFlakyRate: 5,
      maxDuration: 300,       // seconds
      minStabilityScore: 70,
    },
  }],
]
```

Or run as a standalone CLI check:

```bash
npx playwright-smart-reporter gate --pass-rate 95 --flaky-rate 5
```

Exit codes: `0` = all gates passed, `1` = gate failed (use in CI to block deploys).

### Flaky Test Quarantine

Automatically detect and quarantine chronically flaky tests. Quarantined tests are tracked in a JSON file and can be excluded from gate failures:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    quarantine: {
      enabled: true,
      file: '.smart-quarantine.json',
      autoQuarantine: true,
      threshold: 3,  // failures before auto-quarantine
    },
  }],
]
```

### Custom Branding

Customise the report title, footer, and theme colours:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    branding: {
      title: 'Acme Corp Test Report',
      footer: 'Generated by QA Team',
      colors: {
        primary: '#6366f1',
        accent: '#8b5cf6',
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
      },
    },
  }],
]
```

### JSON & JUnit Export

Export test results in structured formats for external tools:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    jsonExport: 'smart-report-data.json',
    junitExport: 'smart-report-junit.xml',
  }],
]
```

### AI Health Digest

Get an AI-generated summary of your test suite health, trends, and recommendations:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,
    enableAIRecommendations: true,
    aiHealthDigest: true,
  }],
]
```

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

    // Pro license
    licenseKey: process.env.SMART_REPORTER_LICENSE_KEY,

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
    enableHistoryDrilldown: false,
    enableNetworkLogs: true,

    // Step and path options
    filterPwApiSteps: false,
    relativeToCwd: false,

    // Multi-project
    projectName: 'ui-tests',
    runId: process.env.GITHUB_RUN_ID,

    // Network logging
    networkLogFilter: 'api.example.com',
    networkLogExcludeAssets: true,
    networkLogMaxEntries: 50,

    // Thresholds
    stabilityThreshold: 70,
    retryFailureThreshold: 3,
    baselineRunId: 'main-branch-baseline',
    thresholds: {
      flakinessStable: 0.1,
      flakinessUnstable: 0.3,
      performanceRegression: 0.2,
      stabilityWeightFlakiness: 0.4,
      stabilityWeightPerformance: 0.3,
      stabilityWeightReliability: 0.3,
      gradeA: 90,
      gradeB: 80,
      gradeC: 70,
      gradeD: 60,
    },

    // Pro features
    theme: 'system',           // system, light, dark, ocean, sunset, dracula, cyberpunk, forest, rose
    pdfExport: false,
    pdfStyle: 'corporate',     // corporate, minimal, dark
    jsonExport: '',             // path for JSON export
    junitExport: '',            // path for JUnit export
    qualityGates: {},           // { minPassRate, maxFlakyRate, maxDuration, minStabilityScore }
    quarantine: {},             // { enabled, file, autoQuarantine, threshold }
    branding: {},               // { title, footer, colors }
    aiHealthDigest: false,

    // Advanced
    cspSafe: false,
    maxEmbeddedSize: 5 * 1024 * 1024,
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

## Stability Grades

Composite score (0-100) from three factors:

| Factor | Weight | Description |
|---|---|---|
| Flakiness | 40% | Inverse of flakiness score |
| Performance | 30% | Execution time consistency |
| Reliability | 30% | Pass rate from history |

Grades: **A+** (95-100), **A** (90-94), **B** (80-89), **C** (70-79), **D** (60-69), **F** (<60). All weights and thresholds are configurable.

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

## Annotations

| Annotation | Badge | Annotation | Badge |
|---|---|---|---|
| `@slow` | Amber | `@fixme` / `@fix` | Pink |
| `@skip` | Indigo | `@fail` | Red |
| `@issue` / `@bug` | Red | `@flaky` | Orange |
| `@todo` | Blue | Custom | Grey |

```typescript
test('payment flow', async ({ page }) => {
  test.slow();
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

### Quality Gates in CI

```yaml
# GitHub Actions example
- run: npx playwright test
  continue-on-error: true

- run: npx playwright-smart-reporter gate --pass-rate 95 --flaky-rate 5
  # Exits non-zero if gates fail — blocks the pipeline
```

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

## CSP-Safe Mode

For environments with strict Content Security Policy:

```typescript
reporter: [
  ['playwright-smart-reporter', { cspSafe: true }],
]
```

Screenshots saved as separate files instead of base64, system fonts instead of Google Fonts, file references instead of embedded data.

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

## FAQ

### How do I get a Pro license?

Visit [stagewright.dev](https://stagewright.dev) to purchase. Your license key is delivered via email immediately after purchase.

### Does Smart Reporter work without a license key?

Yes. All core features (AI analysis, flakiness detection, stability grades, trend analytics, trace viewer, gallery, etc.) are free. Pro features unlock when you add a license key.

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
| Pro features not showing | License key missing or expired | Check `SMART_REPORTER_LICENSE_KEY` env var or `licenseKey` config |
| Quality gate not failing CI | Gate not run as separate step | Run `npx playwright-smart-reporter gate` as its own CI step |

## Development

```bash
npm install
npm run build
npm test        # 547 tests
npm run test:demo
```

## Contributors

- [Gary Parker](https://github.com/qa-gary-parker) — Creator and maintainer
- [Filip Gajic](https://github.com/Morph93) — v1.0.0 UI redesign
- [Liam Childs](https://github.com/liamchilds) — Parameterized project support

## License

MIT — free and Pro features in one package. Pro features require a valid license key from [stagewright.dev](https://stagewright.dev).
