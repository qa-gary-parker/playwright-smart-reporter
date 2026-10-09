# playwright-smart-reporter

A Playwright HTML reporter that opens on your failures. It groups failures by cause, shows a causal timeline for each failed test, tracks flakiness across runs, and can run AI failure analysis with your own key or a local model. Free and open source (MIT). Every feature is included.

![Failures inbox](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-failures-dark.png)
*Failures inbox: failures grouped by cluster, with the selected test's error, expected/received diff, and source frame*

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

Run your tests and open the generated `smart-report.html`. It opens over `file://` with no server.

## At a Glance

- Failures inbox, grouped by failure cluster, as the landing view
- Causal failure timeline with a suggested first anomaly
- Flakiness detection across runs, and a forecast of tests trending towards flaky
- Stability grades (A–F) per test
- Run-to-run comparison and a reliability heatmap
- Screenshot, video, and trace gallery
- Network and console logs from traces
- AI failure analysis with your own Anthropic, OpenAI, or Gemini key, or a local model (Ollama or any OpenAI-compatible server)
- Test owners from CODEOWNERS or git, with notifications routed by owner
- WCAG accessibility scanning with axe-core (opt-in)
- JavaScript code coverage with source maps (opt-in)
- Quality gates and auto-quarantine of flaky tests
- JSON, JUnit XML, CTRF, and PDF exports
- GitHub job summary, annotations, and one sticky pull request comment
- A redacted failure bundle, CLI, and MCP server for coding agents
- Command palette, filter tokens, grouping, deep links, and a full keyboard map
- Four theme modes, seven accents, and custom colours
- CI auto-detection and Slack/Teams notifications

## The Report

The report is a single-page app. The rail on the left holds the queues and views:

| Rail entry | What it shows |
|---|---|
| Failures | Tests that failed this run, grouped by failure cluster. This is the landing view. When nothing failed, the report opens on Flaky, or on All tests when nothing is flaky. |
| Flaky | Tests that passed on retry this run, or that history marks as flaky |
| Regressions | Passed tests that are at least `performanceThreshold` (20%) and 250 ms slower than their average or the previous run |
| Quarantined | Tests in the quarantine file |
| All tests | Every test, grouped by file |
| Insights | Run metrics and summary panels |
| History | Trends, Reliability heatmap, and Compare tabs |
| Gallery | Screenshots, videos, and traces |
| Live | Progress of a running suite |
| Coverage | Line coverage by file, when the run collected coverage |
| Accessibility | axe-core results, when the run scanned pages |

The top bar shows the report name or logo, branch, commit, CI build, start time, the failed, passed, flaky, and skipped counts, the quality gate result, the run duration, search (⌘K), the theme menu, and the export menu. Each test counts once, so the counts add up to the total; a test that failed this run counts as failed even if its history marks it flaky. Click a count to open the matching list. When nothing failed, the bar reads "No failures".

Below 900px the rail becomes a menu, and the test detail opens as its own view with a Back button.

### Failures inbox and test list

Each queue is a list pane and a resizable detail pane. A list row shows the status, title path, `file:line`, attempt count, duration, and at most one marker. Marker priority: new failure, regression, flaky, quarantined, slow. The list is virtualised; the UI tests scroll 10,000 rows.

The detail pane is in triage order. Sections that have no data are left out.

| Section | Content |
|---|---|
| Header | Title path, `file:line`, project, duration, attempts, stability grade, owners, signals, tags. Buttons: Copy failure summary, Copy AI prompt, Open trace. |
| Error | The error message and stack. Stacks longer than 14 lines are folded to 12, with Show all. |
| Expected and received | A diff of the expected and received values, when the error has them |
| Source | Playwright's code frame at the failing line |
| Timeline | The causal failure timeline (see [Causal Failure Timeline](#causal-failure-timeline)) |
| AI analysis | The AI suggestion, or a hint to set a provider or use Copy AI prompt |
| Attempts | Every attempt with status, duration, and first error line. When an attempt failed and a later one passed, a step-by-step comparison of the two. Rows with a different step, or a duration more than 2x apart, are marked. |
| Steps | Each step with a duration bar. The failing step is marked. |
| Network | Requests from the trace: method, status, path, duration. Failed requests are marked. |
| Console | Console messages from the trace of the failed attempt |
| Attachments | Screenshots and videos (open in a lightbox), traces (Open or Download), custom attachments (download) |
| History | Outcome strip for recent runs, pass count, average duration, flakiness, grade, duration sparkline |
| Accessibility | axe-core violations for this test |
| Annotations | Each annotation's type and description |

The open or closed state of each section is saved in `localStorage`. **Copy failure summary** (`c`) copies a Markdown summary: status, title path, location, project, duration, attempts, the error without stack frames, and branch and commit when known.

### Filters, grouping, and links

The filter bar above the list takes free text and filter tokens. The command palette uses the same tokens.

| Token | Matches |
|---|---|
| `status:` | `failed`, `passed`, `flaky`, `skipped`, `timedOut`, `interrupted` |
| `tag:` | A tag, with or without `@` |
| `file:` | Part of the file path |
| `project:` | A Playwright project name |
| `suite:` | A suite name in the test's suite path |
| `grade:` | A stability grade, `A` to `F` |
| `signal:` | `new-failure`, `regression`, `flaky`, `quarantined`, `slow`, `fixed`, `new` |
| `owner:` | An owner, for example `@acme/payments` |

- Tokens with the same key match any value (OR). Tokens with different keys must all match (AND).
- Free text matches every word against the title, file, suites, and project.
- Quote values that contain spaces: `suite:"saved cards"`.
- Matching is not case-sensitive.

The **Group** menu groups the list by cluster, file, project, suite, tag, status, grade, owner, or none. Failures groups by cluster by default. The other queues group by file. A test with several tags appears under each tag, and a test with several owners appears under each owner. Keyboard navigation visits each test once.

Every view, filter, grouping, and selected test is in the URL hash, so you can share a link to it:

| Hash | Opens |
|---|---|
| `#/q/failures`, `#/q/flaky`, `#/q/regressions`, `#/q/quarantined`, `#/q/all` | A queue. Add `?test=<id>`, `&q=<filter>`, `&g=<group>`. |
| `#/insights` | Insights |
| `#/history/trends`, `#/history/heatmap`, `#/history/compare` | A History tab |
| `#/gallery`, `#/live`, `#/coverage`, `#/a11y` | Gallery, Live, Coverage, Accessibility |
| `#/run/<runId>/...` | A past run, read only (needs `enableHistoryDrilldown`) |

### Command palette

![Command palette](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-command-palette-dark.png)
*Command palette: tests, views, filter tokens, and actions*

Press ⌘K (Ctrl+K on Windows and Linux). The palette searches:

- Tests, by title path and file. Failing tests rank higher.
- Views: the queues, Insights, History, and Gallery, Live, Coverage, and Accessibility when the report has them.
- Filter tokens for tags, projects, files, suites, owners, grades, signals, and statuses.
- Actions: Summary card, Export results as CSV or JSON, Keyboard shortcuts, and the theme modes.

### Keyboard shortcuts

Press `?` in the report to see this list.

| Keys | Action |
|---|---|
| **Navigate** | |
| `j` / `k` | Next or previous test |
| `↵` | Open test |
| `[` / `]` | Previous or next failure |
| `f` | Next failure |
| `n` | Next flaky test |
| `Esc` | Close, or back to the list |
| **Go to** | |
| `g f` | Failures |
| `g l` | Flaky |
| `g i` | Insights |
| `g h` | History |
| `1` – `5` | Failures, All tests, Insights, History, Gallery |
| **Actions** | |
| `⌘K` | Command palette |
| `/` | Filter tests |
| `c` | Copy failure summary |
| `e` | Summary card |
| `⌘B` | Toggle sidebar |
| `?` | Keyboard shortcuts |

`↓` and `↑` work like `j` and `k`. `⌘` is Ctrl on Windows and Linux. In the lightbox, `←` and `→` move between attachments.

### Insights

![Insights](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-insights-dark.png)
*Insights: stats row with sparklines, outcome bar, and summary panels*

Insights holds the run metrics:

- A stats row: pass rate, duration, tests, flaky, and suite health grade, with sparklines over recent runs.
- An outcome bar: passed, failed, flaky, skipped.
- Panels: AI summary, Quality gate, Failure clusters, At risk (flake forecast), Coverage (the five least covered files, when coverage was collected), Regressions, Slowest, Most flaky, Fixed, New tests, Quarantine, and Owners (when ownership is on).

### History

![History trends](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-history-trends-dark.png)
*History, Trends tab*

- **Trends:** bar charts of pass rate, duration, flaky tests, and slow tests per recorded run, including the current run, which is highlighted. A line shows the three-run average, and a dot marks a run more than two standard deviations from the mean. With `enableHistoryDrilldown: true`, click a bar to open that run read only.
- **Reliability:** a heatmap of test against run, coloured by outcome. It lists up to 100 tests that did not pass in at least one recorded run, most unstable first.
- **Compare:** pass rate, duration, test count, and flaky count against the baseline run, then new failures, performance regressions, fixed tests, performance improvements, and new tests. The baseline is the previous run, or `baselineRunId`.

![Reliability heatmap](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-history-reliability-dark.png)
*History, Reliability tab*

### Gallery

![Gallery](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-gallery-dark.png)
*Gallery: screenshots, videos, and traces from the run*

Tabs filter by All, Screenshots, Videos, and Traces, with counts. Screenshots and videos open in a lightbox. Traces open in the trace viewer.

### Live

Live shows the progress of a running suite: elapsed time, a progress bar, counters, and a feed of failures. Turn on `live: { enabled: true }` and serve the report with `npx playwright-smart-reporter-serve --live`. Add `--run-command "npx playwright test"` to get the Run and Cancel buttons and an optional filter for the run.

### Themes

![Light mode](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-failures-light.png)
*Light mode*

The theme menu in the top bar has two parts:

- **Mode:** System, Light, Dark, High contrast.
- **Accent:** Default, Ocean, Sunset, Dracula, Cyberpunk, Forest, Rose.

The choice is saved in `localStorage`. To set the default for everyone who opens the report, use `theme.preset`:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    theme: { preset: 'dracula' },
  }],
]
```

- `default` follows the system mode.
- `light`, `dark`, and `high-contrast` set the mode.
- `ocean`, `sunset`, `dracula`, `cyberpunk`, `forest`, and `rose` set the accent colour only, on whichever mode is active.

Custom colours map onto the design tokens and apply in every mode:

| `theme` key | Sets |
|---|---|
| `background` | Page background (`--bg`) |
| `surface` | Secondary surfaces (`--bg-subtle`) |
| `text` | Text (`--text`) |
| `primary` (or `accent` when `primary` is not set) | Accent, in light and dark |
| `success` | Passed status colour |
| `error` | Failed status colour |
| `warning` | Flaky status colour |

Values must be a hex colour, a CSS colour name, or `rgb()`, `rgba()`, `hsl()`, `hsla()`, or `oklch()`. Other values are ignored. The built-in themes are tested for contrast. Custom colours are not.

The report bundles the Geist Sans and Geist Mono fonts (SIL OFL 1.1). It makes no font requests.

## Features

### AI Failure Analysis

Sends each failure's context to an AI provider and shows the suggestion in the test detail. Use your own Anthropic, OpenAI, or Gemini key, the Claude Code CLI, or a local model. See [AI Analysis](#ai-analysis).

Without a provider, every failed test still has **Copy AI prompt**. It copies a prompt with the error, call log, and code frame for use with any AI assistant.

### Causal Failure Timeline

![Causal failure timeline](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-causal-timeline-dark.png)
*Timeline section: steps, network, and console lanes on one time axis, with the possible first anomaly*

Every failed test gets one time axis that lines up its steps, network requests and console output. Drag the scrubber to see the step, request, and last console message at that time. Smart Reporter also suggests the **possible first anomaly**: the earliest unusual event before the failure. **Jump to** moves the scrubber to it.

The first anomaly is a heuristic suggestion. It is not a diagnosis. It points you at where to look first.

#### What counts as an anomaly

The reporter picks the earliest of these that happened before the failure:

| Kind | Rule |
|---|---|
| `network-error` | A response with status 500 or higher, at the time the response arrived. Or a request that failed outright (for example `net::ERR_CONNECTION_REFUSED`), at the time it started. |
| `console-error` | A `console.error` message, or an uncaught page exception (shown as `Uncaught TypeError: ...`). |
| `slow-step` | A `test.step` that ran longer than 3x its average in previous passing runs, and more than 1 s over that average. It needs at least 2 passing runs in history. The anomaly time is the moment the step crossed that limit. |

These are not anomalies:

- 4xx responses.
- Requests cancelled by the browser (`net::ERR_ABORTED` and similar).
- Requests your test aborted with `route.abort()`.
- Requests still in flight when the test ended.
- Chromium's `Failed to load resource: ...` console messages. They repeat a network failure that is already on the network lane.
- The failing step itself.
- Anything at or after the failure. The failure is the end of the failing step, or the start of teardown if that comes first.

When nothing matches, there is no `firstAnomaly`. The timeline is still built.

#### Where it appears

- The **Timeline** section of the test detail.
- Report data: `tests[].timeline` (schema in `src/types.ts`, `CausalTimeline`). All times are milliseconds from the start of the failed attempt.
- JSON export (`exportJson: true`): `tests[].timeline`.
- AI analysis and **Copy AI prompt**: a `# Possible first anomaly (heuristic)` section after the error details.

#### Requirements

- **Network and console lanes** need a trace for the failed attempt, for example `trace: 'retain-on-failure'`. Without a trace, the timeline has steps only.
- **Slow-step detection** needs history. Each run stores `test.step` durations in the history file (`stepDurations`). Only passing runs count.
- Console events need the trace's clock anchor (`monotonicTime` in `context-options`). A trace without it keeps its network timing and drops console events, so nothing is placed at the wrong time. Verified with Playwright 1.57.

#### Option

```ts
['playwright-smart-reporter', {
  enableCausalTimeline: true, // default; false turns off the timeline, the prompt section and step-duration history
}]
```

#### Limits

- Each lane keeps at most 1,000 entries (earliest first). Console text is cut at 500 characters.
- The network log (`networkLogs`) is unchanged and still reads the first browser context only. The timeline reads every context in the trace.

### Flakiness Detection

Smart Reporter tracks flakiness **across runs**, not within a single run:

| | Playwright HTML Report | Smart Reporter |
|---|---|---|
| **Scope** | Single test run | Historical across multiple runs |
| **Criteria** | Fails then passes on retry | Failed 30%+ of the time historically |
| **Use Case** | Immediate retry success | Chronically unreliable tests |

Indicators:
- **Stable** (<10% failure rate) — **Unstable** (10-30%) — **Flaky** (>30%) — **New** (no history)

The Flaky queue lists both kinds: tests that passed on retry in this run, and tests that history marks as flaky.

### Flake Forecasting

Lists tests that passed this run but whose history is trending unstable, before they fail. The list is the **At risk** panel in Insights. On by default. Forecasts are advisory: they never quarantine a test or fail a quality gate.

```typescript
reporter: [
  ['playwright-smart-reporter', {
    forecast: {
      enabled: true,   // default: true
      minRuns: 5,      // default: 5; values below 3 are raised to 3
      threshold: 0.5,  // default: 0.5; risk 0-1 at or above this lists the test as at risk
    },
  }],
]
```

Only tests that passed on their first attempt this run get a forecast. Failing, flaky-on-retry, skipped, and `test.fail()` tests get none.

Each forecast is built from four signals over the test's history, weighted towards recent runs:

| Signal | Fires when | Max contribution |
|---|---|---|
| `outcome-instability` | Results flip between pass and fail, recent flips weighted most | 0.9 |
| `retry-trend` | Runs needed retries to pass | 0.8 |
| `duration-variance` | Duration spread in the recent half of runs is wider than in the older half | 0.7 |
| `duration-drift` | Median duration in the recent half rose more than 20% (and 100ms) over the older half | 0.5 |

Signals combine so that one strong signal can flag a test on its own, and weak signals only flag it together. Each at-risk test lists the signals that triggered it, with a plain-language detail such as `Pass/fail flipped 2 times in the last 6 runs, most recently this run`.

A test with fewer than `minRuns` non-skipped runs (this run included) gets `insufficient-history` instead of a score and is never listed as at risk. The duration signals also need at least 8 runs, so one slow run in a short history cannot flag a test. With the default `maxHistoryRuns: 10`, a test can have at most 11 runs, so a `minRuns` above 11 means no test is ever scored.

Forecast risks are recorded per run in the history file under `forecasts` (`runId -> testId -> risk`; risk 0 is omitted) and pruned to `maxHistoryRuns`, so the forecast's accuracy can be checked later. `playwright-smart-reporter-merge-history` does not merge `forecasts` yet.

To replay the forecast over recorded history from a clone of this repository: `npm run build && node scripts/backtest-forecast.mjs <dir containing test-history.json>`.

### Ownership and Routing

Smart Reporter tags each test with its owners. You can send each team a notification that contains only the failures it owns. Owners show in the test detail header, in the `owner:` filter token, in Group by owner, and in the Owners panel in Insights.

#### How owners are found

1. **CODEOWNERS.** The reporter reads the first file that it finds at `.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`. It searches from the git repository root first, then from Playwright's `rootDir`. Matching uses GitHub's rules:
   - The last matching line wins.
   - A pattern with a leading or middle `/` is anchored to the repository root. A pattern without one matches at any depth.
   - `*` matches inside one path segment. `**` matches any number of directories.
   - `dir/` matches everything below `dir`. `dir/*` matches only the direct children of `dir`.
   - A line that has no owners removes ownership from the paths that it matches.
   - Negation (`!`) and character ranges (`[a-z]`) are not supported, the same as on GitHub.
2. **Git authors (fallback).** If there is no CODEOWNERS file, the owner is the email of the author who made the most commits to the test file. The reporter reads the 1,000 most recent non-merge commits that touch the test files. A tie goes to the most recent author. The reporter runs `git log` one time per run for all test files.

Outside a git repository, CODEOWNERS patterns match relative to Playwright's `rootDir`, and the git fallback gives no owners. Neither case fails the run.

#### Options

```ts
['playwright-smart-reporter', {
  ownership: {
    enabled: true,           // default: true when a CODEOWNERS file exists, or when source is 'git'
    source: 'auto',          // 'auto' (CODEOWNERS, else git) | 'codeowners' | 'git'
    codeownersPath: '.github/CODEOWNERS', // optional; relative to Playwright's rootDir
  },
}]
```

If `codeownersPath` points to a file that does not exist, the reporter logs a warning and gives no owners.

#### Route notifications by owner

Add `owners` to a notification. The notification is sent only when at least one failure belongs to one of those owners. Counts, conditions, `{{failedTests}}` and the default message include only the tests that those owners own. Owner names are not case-sensitive.

```ts
notifications: [
  { channel: 'slack', config: { webhookUrl: process.env.PAYMENTS_SLACK! }, owners: ['@acme/payments'] },
  { channel: 'slack', config: { webhookUrl: process.env.SEARCH_SLACK! }, owners: ['@acme/search', 'dev@acme.com'] },
]
```

Default message for an owner-routed notification:

```
Test Run: 1/2 passed (50%) — 1 failures owned by @acme/payments: checkout fails
```

A notification without `owners` works as before.

#### Report data

- Each test has `owners?: string[]` and `ownerSource?: 'codeowners' | 'git'`.
- `ReportData.ownership.owners` lists `{ owner, total, failed, flaky, passRate }` for each owner. The list starts with the owner that has the most failures, then the most flaky tests, then sorts by name. A test with two owners counts for both owners. Tests without an owner are not in this list.

#### Cost

On this repository (164 commits), resolution took less than 1 ms with a CODEOWNERS file and 25–35 ms with the git fallback for the 4 example specs. For 115 files it took 80–320 ms. When there is no CODEOWNERS file and ownership is not turned on, the reporter does not run git.

### Accessibility Scanning

![Accessibility view](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-accessibility-dark.png)
*Accessibility view: violations by impact and by rule*

Scan each test's final page for WCAG violations with axe-core. Scanning is opt-in. Runs without it are unchanged. Results appear in the Accessibility view (totals by impact, rules with the affected tests) and in the Accessibility section of each scanned test.

#### Setup

1. Install axe-core for Playwright:

```bash
npm install -D @axe-core/playwright
```

2. Import `test` from the accessibility entry point in the specs you want scanned:

```typescript
import { test } from 'playwright-smart-reporter/accessibility';
import { expect } from '@playwright/test';

test('home page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('h1')).toBeVisible();
});
```

3. Wrap your config with `withAccessibility` and set the `accessibility` reporter option:

```typescript
import { defineConfig } from '@playwright/test';
import { withAccessibility } from 'playwright-smart-reporter';

export default withAccessibility(defineConfig({
  reporter: [
    ['playwright-smart-reporter', {
      accessibility: { enabled: true, standard: 'WCAG2AA' },
    }],
  ],
}));
```

`withAccessibility` copies the `accessibility` option into `use.smartReporterA11y` for the config and every project. With no `accessibility` option it uses `{ enabled: true, standard: 'WCAG2AA' }`. You can also set `use.smartReporterA11y` yourself instead of using the wrapper.

The scan runs after the test body, on the page the test ends on. Specs that import `test` from `@playwright/test` are not scanned.

#### Options (`accessibility`)

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | — | Turn scanning on |
| `standard` | `'WCAG2A'` \| `'WCAG2AA'` \| `'WCAG2AAA'` | `'WCAG2AA'` | WCAG level to check |
| `include` | string[] | — | Run only these axe rule IDs |
| `exclude` | string[] | — | Skip these axe rule IDs |
| `selector` | string | — | Scan only inside this CSS selector |
| `failOnSeverity` | `'minor'` \| `'moderate'` \| `'serious'` \| `'critical'` | — | Fail the test when a violation has this impact or higher |

#### Accessibility quality gates

```typescript
qualityGates: {
  maxA11yViolations: 10, // all impacts
  maxA11yCritical: 0,
  maxA11ySerious: 3,
},
```

A gate is reported as skipped when no test in the run was scanned. The CLI gate reads the JSON export (`exportJson: true`):

```bash
npx playwright-smart-reporter gate --config gates.json --data smart-report-data.json
node node_modules/playwright-smart-reporter/dist/bin/gate.js --max-a11y-violations 10
```

#### Output

- Each scanned test carries `a11y` (violations with impact, WCAG tags, help URL and failing nodes) in the JSON export and the report data.
- The report data has a run summary in `a11y`: totals by impact, violations per rule with the affected tests, tests scanned and pages scanned.

### Agent-Ready Output

Smart Reporter can hand failures straight to a coding agent such as Claude Code. You do not need to copy prompts by hand.

#### Failure bundle

```ts
reporter: [['playwright-smart-reporter', { exportFailures: true }]]
```

`exportFailures` writes `<report name>-failures.json` (default `smart-report-failures.json`) next to the HTML report. The default is `false`.

The bundle has `format: "playwright-smart-reporter/failures"` and `schemaVersion: 1`. It holds one entry for each unexpected failure (`failed` or `timedOut`). Flaky passes and expected failures (`test.fail()`) are not in it. Each entry contains:

| Field | Content |
|---|---|
| `id`, `title`, `titlePath`, `file`, `line`, `column`, `project`, `browser`, `status`, `tags` | Test identity |
| `source` | Test file as `relative` and `absolute` paths |
| `error` | `message`, `stack` frames, and the failing `location` (relative and absolute) |
| `codeFrame` | Playwright's source snippet around the failing line |
| `callLog` | The `Call log:` lines from the error |
| `failingStep` | The innermost failed step, from the failure timeline |
| `attempts` | Status, duration and error message of every retry |
| `network` | Total request count and every failed request (status ≥ 400 or no response) |
| `console` | Console errors and warnings, from the failure timeline |
| `anomaly` | The suspected first anomaly, from the failure timeline |
| `history` | Pass, fail and skip counts, the last 10 results, signals, flakiness score, stability grade |
| `trace` | The full step, network and console lanes (served by `get_trace_context`) |

#### Redaction

The bundle is made to be sent to a third-party model, so the reporter redacts it before it writes the file:

- Request and response bodies are never copied.
- Header values are replaced with `[REDACTED]` for `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, and any header whose name contains `cookie`, `token`, `secret`, `password`, `session`, `signature`, `credential`, or `api-key`, or has an `auth` segment (for example `X-Auth-User`).
- These patterns are replaced in every string: JWTs, `sk-` and `sk-ant-` keys, AWS access key IDs, GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack tokens (`xoxb-`, `xoxp-`, ...), bearer tokens, private key blocks, `password=`/`secret=`/`token=`-style pairs, passwords in URLs (`scheme://user:password@`), and `key`/`sig`/`code`/`jwt` query parameters.
- The value of each environment variable whose name contains `token`, `secret`, `password`, `api_key`, `access_key`, `private_key`, `auth`, `session`, `cookie`, `credential`, `webhook`, `dsn`, or `signature` is replaced wherever it appears (values of 8 characters or more).
- The AI prompt, which carries an environment snapshot, is never copied.

Environment values are redacted from the environment of the process that builds the bundle. Use `exportFailures: true` so that the reporter builds the bundle in the test process.

#### CLI

```bash
npx playwright-smart-reporter failures          # one line per failure
npx playwright-smart-reporter failures --json   # the full bundle, for piping into an agent
```

`--data <path>` selects the input. The default is the first of `smart-report-failures.json` and `smart-report-data.json` that is in the current directory. The command also accepts the `exportJson` output (`smart-report-data.json`) and the `<name>-data.js` file that `assetMode: 'external'` writes. For these inputs the command builds the bundle on the fly. Paths resolve against the current directory, so run the command from the Playwright root directory. The `exportJson` output has no steps, line numbers, network data, or history.

#### MCP server

```bash
npx playwright-smart-reporter mcp --data ./smart-report-failures.json
```

This command starts an MCP server on stdio with three tools:

| Tool | Input | Returns |
|---|---|---|
| `list_failures` | none | Run info and one summary for each failure: id, title, `file:line`, project, status, first error line, anomaly |
| `get_failure` | `id` | The whole failure entry except the `trace` lanes |
| `get_trace_context` | `id` | `steps`, `network` and `console` for that failure |

The server reads the data file on every tool call. An agent that fixes a test and runs the suite again gets the new failures, and you can register the server before the first test run. Until the file exists, each tool returns an error that tells the agent to run the tests.

Register the server with Claude Code from the project root:

```bash
claude mcp add smart-reporter -- npx playwright-smart-reporter mcp --data ./smart-report-failures.json
```

Add `--scope project` to share the server through `.mcp.json`. Then ask Claude Code, for example, "Use smart-reporter to fix the failing login test".

### Code Coverage

![Coverage view](https://raw.githubusercontent.com/qa-gary-parker/playwright-smart-reporter/master/images/v3-coverage-dark.png)
*Coverage view: line, function, and branch totals, and files least covered first*

Measure which lines of your app code your Playwright tests run. Coverage is opt-in: swap the `test` import.

```typescript
// before: import { test, expect } from '@playwright/test';
import { test, expect } from 'playwright-smart-reporter/coverage';
```

Already extending `test`? Wrap your own:

```typescript
import { withCoverage } from 'playwright-smart-reporter/coverage';

export const test = withCoverage(base.extend<MyFixtures>({ /* ... */ }));
```

The reporter picks the data up with no extra options and prints a summary line:

```
   Coverage: 80.95% of lines (17/21) across 3 file(s)
```

The report gains a **Coverage** view (rail entry and `#/coverage`): line, function, and branch totals, then every file with the least covered first. Click a file to see its source with the hit count for each line. Insights shows the five least covered files.

#### What is collected

- Chromium: V8 JavaScript coverage for the `page` fixture, for the whole test, across navigations. Every attempt counts, retries included.
- Any browser: `window.__coverage__` counters from Istanbul-instrumented code (`babel-plugin-istanbul`, `vite-plugin-istanbul`). When present, they replace the V8 data for that test.
- Firefox and WebKit: V8 coverage is skipped with one warning per worker. The test never fails because of coverage.
- Only page scripts (`http`, `https`, `file`) are kept. Files under `node_modules` are left out.
- Pages opened outside the `page` fixture (`context.newPage()`) are not covered.

#### Source maps

- Inline maps, linked `.map` files and `sourcesContent` are resolved, so coverage is reported against your source files, not the bundle.
- The fixture fetches linked maps while the app is still running and stores them with the coverage. Reports built later, including `merge-reports` on another machine, need no access to the app.
- A map that cannot be loaded gives one warning, and that script is reported against its generated code.

#### Sharding

Coverage travels as a test attachment, so `npx playwright merge-reports` combines shards with no extra steps.

#### Coverage gate

```typescript
qualityGates: {
  minCoverage: 80, // minimum line coverage, percent
}
```

From a JSON export (`exportJson: true`), either with a config file:

```bash
echo '{ "minCoverage": 80 }' > gates.json
npx playwright-smart-reporter gate --config gates.json --data smart-report-data.json
```

or with a flag:

```bash
node node_modules/playwright-smart-reporter/dist/bin/gate.js --input smart-report-data.json --min-coverage 80
```

- A run with no coverage data fails the gate.
- Exit codes: `0` = passed, `1` = failed.

#### How lines are counted

- Numbers match [c8](https://github.com/bcoe/c8) for the same code: every source line counts, and a line is covered when V8 ran the code around it.
- Some bundlers (esbuild among them) emit no source map entry for a closing `}`, so the last line of a function that never ran shows as covered. c8 reports the same.
- Percentages are floored to two decimals, like Istanbul.

#### Where the data lives

- Report data (`ReportData.coverage`): totals, per-file totals, per-line hit counts, and file source for line highlighting. Large reports move it to the external data file under `assetMode`.
- JSON export (`smart-report-data.json`): totals and per-file totals only.
- `test-results/`: the raw V8 data, source and source map for each test. Expect about 1.5 MB per test for a 22,000-line app.

### Quality Gates

Evaluate the run against thresholds:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    qualityGates: {
      maxFailures: 0,
      minPassRate: 95,
      maxFlakyRate: 5,
      minStabilityGrade: 'B',
      noNewFailures: true,
      minCoverage: 80,      // see Code Coverage
    },
  }],
]
```

The result shows in the top bar and in the Quality gate panel in Insights, and is logged at the end of the run. A breached gate fails the Playwright run (exit code `1`), even when every test passed.

The CLI gate checks a finished run again, for example in a later CI step. It reads the JSON export (`exportJson: true`) and a JSON file with the same rules:

```bash
echo '{ "minPassRate": 95, "maxFlakyRate": 5 }' > gates.json
npx playwright-smart-reporter gate --config gates.json --data smart-report-data.json
```

`--data` defaults to `smart-report-data.json`. Exit codes: `0` = all gates passed, `1` = a gate failed or the input is missing.

To pass the rules as flags instead of a file, call the standalone script: `node node_modules/playwright-smart-reporter/dist/bin/gate.js --min-pass-rate 95 --max-flaky-rate 5`. It takes `--input <path>` for the JSON export, and `--max-failures`, `--min-stability-grade`, `--no-new-failures`, `--max-a11y-violations`, and `--min-coverage`.

### Flaky Test Quarantine

Automatically detect and quarantine chronically flaky tests. Quarantined tests are tracked in a JSON file and can be excluded from gate failures:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    quarantine: {
      enabled: true,
      outputFile: '.smart-quarantine.json',
      threshold: 0.3,  // flakiness score 0-1
    },
  }],
]
```

Quarantined tests appear in the Quarantined queue and in the Quarantine panel in Insights.

### Executive PDF Export

Generate PDF reports in 3 themed variants: **Corporate**, **Minimal**, and **Dark**. The report's export menu links to each file.

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    exportPdf: true,
  }],
]
```

#### Non-Latin scripts (Arabic, CJK, ...)

The built-in PDF font (Helvetica) only covers Latin. If your test titles or project name use another script, embed a font that covers it:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    exportPdf: true,
    pdfFont: {
      regular: './fonts/Cairo-Regular.ttf',
      bold: './fonts/Cairo-Bold.ttf',     // optional, falls back to regular
    },
  }],
]
```

Pick a font that covers **both** your script and Latin (e.g. [Cairo](https://fonts.google.com/specimen/Cairo) for Arabic) — the report's own labels are English. Arabic renders with joined letters and right-to-left word order. Known limitation: strings mixing Arabic and Latin (e.g. an Arabic path containing `auth.spec.ts`) may display the runs in the wrong order — full bidirectional layout is not supported. `family`/`boldFamily` select a face inside a `.ttc` collection. Alternatively, `exportPdf: true` + `exportPdfFull: true` renders the whole HTML report via Chromium, which handles all scripts natively.

### JSON, JUnit & CTRF Export

Export test results in structured formats for external tools:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    exportJson: true,   // smart-report-data.json
    exportJunit: true,  // smart-report-junit.xml
    exportCtrf: true,   // smart-report-ctrf.json
  }],
]
```

`exportCtrf` writes a [Common Test Report Format](https://github.com/ctrf-io/ctrf) document (`specVersion` 0.1.0) next to the HTML report, so any CTRF tool can read your results.

| Playwright result | CTRF `status` | Notes |
|---|---|---|
| passed | `passed` | |
| passed after a retry (flaky) | `passed` | `flaky: true` |
| failed, timedOut | `failed` | `rawStatus` keeps `timedOut` |
| failed as expected (`test.fail()`) | `passed` | `rawStatus: "failed"` |
| interrupted | `other` | |
| skipped | `skipped` | |

- `retries` is the number of earlier attempts. Each earlier attempt is in `retryAttempts` with its status, duration and error.
- `filePath` is relative to the Playwright `rootDir`, the same as in the JSON and JUnit exports.
- The Playwright project name is in `extra.project`.

The report's export menu also downloads the current results as JSON or CSV, and opens a **Summary card** (`e`) that copies a Markdown summary of the run. When the run wrote them, the menu also links to the full JSON data, JUnit XML, CTRF JSON, and the failure bundle for agents.

### Custom Branding

Customise the report title, logo, and footer:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    branding: {
      title: 'Acme Corp Test Report',
      footer: 'Generated by QA Team',
    },
  }],
]
```

The title shows in the top bar. `logo` replaces the "Smart Reporter" name with an image; when `title` is also set, the title shows next to the logo. The value is used as the image `src` (a URL, a data URI, or a path relative to the HTML file). The footer and the "Playwright Smart Reporter" version line show at the foot of the rail. `hidePoweredBy: true` hides the version line. For colours, see [Themes](#themes).

### AI Suite Health Summary

An AI-generated summary of the run is the first panel in Insights. It combines failure clusters, flakiness trends, performance regressions, and historical pass rate data. Enabled by default when an AI provider is set (see [AI Analysis](#ai-analysis)).

To disable (e.g., to save one AI request per run):

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    enableAISuiteHealth: false,  // Disable AI health summary
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

    // Notifications
    slackWebhook: process.env.SLACK_WEBHOOK_URL,
    teamsWebhook: process.env.TEAMS_WEBHOOK_URL,
    notifications: [],          // [{ channel, config, conditions?, template?, owners? }]

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
    enableAISuiteHealth: true,      // AI health summary in Insights (uses 1 AI request)
    enableNetworkLogs: true,
    enableCausalTimeline: true,     // Timeline and first-anomaly suggestion on failed tests

    // Step and path options
    filterPwApiSteps: false,
    showExpectSteps: true,          // Show standalone expect() assertion steps
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

    // AI (see AI Analysis)
    ai: {},                     // { provider, baseUrl, model, timeoutMs: 60000, maxTotalMs: 300000 }

    // Analysis
    forecast: {},               // { enabled: true, minRuns: 5, threshold: 0.5 }
    ownership: {},              // { enabled, source: 'auto', codeownersPath }; on when CODEOWNERS exists
    accessibility: undefined,   // { enabled, standard: 'WCAG2AA', include, exclude, selector, failOnSeverity }; opt-in

    // Report customisation & exports
    theme: { preset: 'default' },  // default, light, dark, high-contrast, ocean, sunset, dracula, cyberpunk, forest, rose
    exportPdf: false,
    exportPdfFull: false,
    pdfFont: undefined,         // { regular, bold?, family?, boldFamily? } — custom PDF font for non-Latin scripts
    exportJson: false,
    exportJunit: false,
    exportCtrf: false,          // <name>-ctrf.json
    exportFailures: false,      // <name>-failures.json, redacted, for coding agents
    qualityGates: {},           // { maxFailures, minPassRate, maxFlakyRate, minStabilityGrade, noNewFailures, maxA11yViolations, maxA11yCritical, maxA11ySerious, minCoverage }
    quarantine: {},             // { enabled, outputFile: '.smart-quarantine.json', threshold: 0.3, maxQuarantined: 50 }
    branding: {},               // { logo, title, footer, hidePoweredBy }
    live: {},                   // { enabled, outputFile: '.smart-live-results.jsonl', dashboard, notifyOnFirstFailure }

    // Advanced
    assetMode: 'auto',          // 'inline' | 'external' | 'auto'
    cspSafe: false,
    maxEmbeddedSize: undefined, // deprecated, no effect since 3.0.0 (traces are copied next to the report, never embedded)
  }],
]
```

### AI Analysis

AI failure analysis uses your own API key or a local model. Set one of the following environment variables:

```bash
export ANTHROPIC_API_KEY=your-key    # Claude
export OPENAI_API_KEY=your-key       # OpenAI
export GEMINI_API_KEY=your-key       # Google Gemini
```

When a test fails, the reporter sends the failure context to your chosen provider and includes fix suggestions in the report. Your provider bills the cost. The default models are `claude-haiku-4-5`, `gpt-4o-mini`, and `gemini-2.5-flash`.

**Claude subscription (no API key)?** Claude Pro/Team plans issue OAuth tokens, not API keys — putting one in `ANTHROPIC_API_KEY` fails with a 401. Instead, install [Claude Code](https://claude.com/claude-code) and set `CLAUDE_CODE_OAUTH_TOKEN`: the reporter then routes analysis through the local `claude` CLI, billed to your subscription. API keys take precedence when both are set.

If no provider is set, AI analysis is skipped and everything else works as normal. Every failed test still gets a **Copy AI prompt** button.

#### Local models (Ollama and OpenAI-compatible endpoints)

Run AI failure analysis on a local model. No API key is needed, and no failure data leaves your network.

**Ollama**

```bash
ollama pull llama3.2
export OLLAMA_HOST=127.0.0.1:11434   # optional, this is the default
export OLLAMA_MODEL=llama3.2         # optional, this is the default
```

Setting `OLLAMA_HOST` or `OLLAMA_MODEL` turns on local analysis when no cloud key is set. To use Ollama even when a cloud key is set, choose it in the config:

```ts
reporter: [
  ['playwright-smart-reporter', {
    ai: {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'http://gpu-box:11434', // default: OLLAMA_HOST, then http://127.0.0.1:11434
      timeoutMs: 120_000,              // slow CPU-only machine
    },
  }],
],
```

**Other OpenAI-compatible servers** (LM Studio, vLLM, LiteLLM, a company gateway)

```ts
ai: {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1', // requests go to <baseUrl>/chat/completions
  model: 'qwen2.5-7b-instruct',
},
```

- `openai-compatible` needs both `baseUrl` and `model`.
- If `OPENAI_API_KEY` is set, the reporter sends it to `baseUrl` as a Bearer token. Otherwise it sends no `Authorization` header.
- Ollama never gets a key.

#### Options (`ai`)

| Option | Default | Meaning |
|---|---|---|
| `provider` | detected from env | `'anthropic'`, `'openai'`, `'gemini'`, `'ollama'` or `'openai-compatible'`. When set, it wins over every env key and never falls back to another provider. |
| `baseUrl` | per provider | Endpoint for `openai`, `ollama` and `openai-compatible`. Anthropic, Gemini and the Claude CLI ignore it. |
| `model` | per provider | Replaces the model of whichever provider is selected. Defaults: `claude-haiku-4-5`, `gpt-4o-mini`, `gemini-2.5-flash`. For Ollama: `OLLAMA_MODEL`, then `llama3.2`. |
| `timeoutMs` | `60000` | Time limit for one AI call, for every provider. |
| `maxTotalMs` | `300000` | Time limit for all AI analysis in one run. |

#### Provider order when `ai.provider` is not set

The first match wins:

1. `ANTHROPIC_API_KEY`
2. `OPENAI_API_KEY`
3. `GEMINI_API_KEY`
4. `CLAUDE_CODE_OAUTH_TOKEN`, using the Claude Code CLI. A subscription OAuth token (`sk-ant-oat…`) found in `ANTHROPIC_API_KEY` is also sent this way.
5. `OLLAMA_HOST` or `OLLAMA_MODEL`

A cloud key wins over `OLLAMA_*`. When that happens, the reporter prints a warning. Set `ai: { provider: 'ollama' }` to use the local model. Each run prints the provider and model it uses, for example `Analyzing 3 failure(s) with AI (ollama, llama3.2)...`. The report data records the same values in `ai.provider` and `ai.model`, and the AI analysis section shows the model.

#### Limits and failure behaviour

- AI never fails a test run. If the model is unreachable, does not respond within `timeoutMs`, or uses up `maxTotalMs`, the reporter prints one warning. It skips the rest of the analysis and still writes the report. Suggestions made before the stop stay in the report.
- Failures go to the model three at a time. A slow local model may run out of `maxTotalMs` on a large failure set. Raise `timeoutMs` and `maxTotalMs` for CPU-only machines.
- An HTTP 404 from an OpenAI-compatible server usually means the model does not exist there. For Ollama, run `ollama pull <model>`.
- `OLLAMA_HOST` accepts the same forms as Ollama: `0.0.0.0`, `host:port`, `http://host:port`, or a URL that ends in `/v1`.

### Report Size and Asset Mode

The reporter writes report data one test at a time. `assetMode` sets where the data goes:

| `assetMode` | Data location |
|---|---|
| `'auto'` (default) | In the HTML up to 32 MB of data. Above that, in `<name>-data.js` next to the HTML. |
| `'inline'` | Always in the HTML. The report is one file. |
| `'external'` | Always in `<name>-data.js` next to the HTML. |

- `cspSafe: true` always writes `<name>-data.js`.
- The HTML loads the data file with `<script src>`, so the report still opens over `file://`.
- Keep the data file next to the HTML when you copy, upload, or archive the report. Without it the page shows "report data is missing".
- Each run logs the data size and location, for example `Report data: 7.0 MB, inline in the HTML`.

## Stability Grades

Composite score (0-100) from three factors:

| Factor | Weight | Description |
|---|---|---|
| Flakiness | 40% | Inverse of flakiness score |
| Performance | 30% | Execution time consistency |
| Reliability | 30% | Pass rate from history |

Grades: **A** (90-100), **B** (80-89), **C** (70-79), **D** (60-69), **F** (<60). All weights and thresholds are configurable. A test's grade shows in the detail header, and `grade:` filters by it.

## Step Filtering

```typescript
reporter: [
  ['playwright-smart-reporter', {
    filterPwApiSteps: true,  // Only show custom test.step() entries
  }],
]
```

With filtering on, verbose `page.click()`, `page.fill()` steps are hidden — your named `test.step()` entries and `expect()` assertion steps remain.

All `expect()` assertion steps (top-level and nested) are shown by default and are kept even when `filterPwApiSteps` is on. Set `showExpectSteps: false` to hide them.

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
Click **Open trace** in the test detail header, **Open** on a trace attachment, or a trace tile in the Gallery. The built-in viewer has a film strip, actions panel, before/after screenshots, network waterfall, console messages, and errors.

Browsers block the viewer from reading trace files over `file://`. There, the viewer offers **Load from file** and **Copy CLI command** (`npx playwright show-trace`). To open traces with one click, serve the report.

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

Automatically extracted from Playwright trace files — no code changes required. Shows method, URL, status code, and duration. Requires tracing enabled:

```typescript
use: {
  trace: 'retain-on-failure',  // or 'on'
}
```

## Annotations

Playwright annotations show in the **Annotations** section of the test detail, with type and description. Tags show in the detail header; click one to add a `tag:` filter.

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
```

### Uploading the Report

Upload the HTML file together with the files the reporter wrote next to it: `<name>-data.js` (when [asset mode](#report-size-and-asset-mode) moves data out), the `traces/` folder, and `<name>.css`, `<name>.js`, and the screenshot files (with `cspSafe: true`). Uploading the output folder covers all of them.

### CI Auto-Detection

The reporter automatically detects GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure DevOps, and Buildkite. Branch, commit SHA, and build ID are displayed in the report's top bar.

### GitHub Pull Requests

Show the run where reviewers already look:

- **Job summary:** pass rate, quality gate result, failures (new failures first), flaky tests, slowest tests and a link to the report.
- **Annotations:** an error on the line of each failing assertion, not on the test declaration.
- **Pull request comment:** the same summary as one comment. Each run updates that comment, so re-runs do not add more comments.

Turn on the JSON export, then add the action after your tests:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write   # for the pull request comment
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps

      - run: npx playwright test
        continue-on-error: true

      - id: upload-report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: smart-report
          path: smart-report.html

      - uses: qa-gary-parker/playwright-smart-reporter@v3.0.0
        if: always()
        with:
          data: smart-report-data.json
          report-url: ${{ steps.upload-report.outputs.artifact-url }}
```

| Input | Default | Description |
|---|---|---|
| `data` | `smart-report-data.json` | Path to the JSON export |
| `report-url` | workflow run page | Link to the uploaded report |
| `github-token` | `github.token` | Token for the pull request comment |

- The comment is written only for `pull_request` and `pull_request_target` events. Other events get the summary and annotations.
- `pull_request` runs from forks get a read-only token. The action skips the comment and still writes the summary and annotations. A 403 response does the same and shows a warning. The step does not fail.
- GitHub shows at most 10 error annotations per step. The action writes the first 10 failures and logs how many it left out.
- The action uses the reporter version installed in your project. If it is not installed, `npx` downloads the latest version.

You can also run the command without the action, for example in a custom workflow step:

```bash
npx playwright-smart-reporter github --data smart-report-data.json --report-url "$REPORT_URL"
```

It needs the `gh` CLI and `GH_TOKEN` for the comment. Outside GitHub Actions it prints the summary to stdout.

### Azure DevOps

Azure DevOps has no pull request comment or annotation support in Smart Reporter. Use these pipeline features instead:

```yaml
steps:
  - script: npx playwright test
    continueOnError: true

  # HTML report as a pipeline artifact
  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: smart-report.html
      artifact: playwright-smart-report
    condition: always()

  # Native "Tests" tab, from exportJunit: true
  - task: PublishTestResults@2
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: '**/smart-report-junit.xml'
    condition: always()

  # Markdown summary on the run's "Extensions" tab, from exportJson: true
  - script: |
      GITHUB_STEP_SUMMARY="$(Build.ArtifactStagingDirectory)/smart-summary.md" npx playwright-smart-reporter github --data smart-report-data.json
      echo "##vso[task.uploadsummary]$(Build.ArtifactStagingDirectory)/smart-summary.md"
    condition: always()
```

- The `github` command writes its markdown to the file named in `GITHUB_STEP_SUMMARY`. It also prints `::error` lines, which Azure DevOps shows as plain log text.
- Branch, commit and build ID are detected from the Azure DevOps environment and shown in the report header.

### Quality Gates in CI

```yaml
# GitHub Actions example; the reporter needs exportJson: true
- run: npx playwright test
  continue-on-error: true

- run: npx playwright-smart-reporter gate --config gates.json --data smart-report-data.json
  # Exits non-zero if gates fail — blocks the pipeline
```

`gates.json` holds the rules, for example `{ "minPassRate": 95, "maxFlakyRate": 5 }`. See [Quality Gates](#quality-gates).

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

For environments with a strict Content Security Policy (e.g., Jenkins):

```typescript
reporter: [
  ['playwright-smart-reporter', { cspSafe: true }],
]
```

When enabled, the reporter writes three companion files next to the HTML report:

- `<name>.css`, loaded with `<link rel="stylesheet">`
- `<name>.js`, the app, loaded with `<script src>`
- `<name>-data.js`, the report data, loaded with `<script src>`

The HTML has no inline `<script>` or `<style>`. The bundled fonts are left out, because CSP `font-src` rules block data-URI fonts; the report uses the system font stack. Screenshots are saved as files instead of being embedded, and traces are not embedded.

The UI tests render a cspSafe report under this policy and check that the app causes no violations:

```
default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'
```

**Jenkins CSP configuration** — Add to Jenkins script console or startup:

```
System.setProperty("hudson.model.DirectoryBrowserSupport.CSP",
  "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self';")
```

> **Note**: The trace viewer is carried over from 2.x and still uses inline event handlers and inline styles. Under an enforced strict CSP its controls do not work. Use **Download** on the trace attachment, then open it with `npx playwright show-trace <file>`.

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

## Upgrading from 2.x

- The report is a single-page app. It still opens over `file://` with no server.
- Failures (the landing view) and Insights replace Overview. Trends and Comparison are tabs of History. Filters moved from the sidebar to the filter bar.
- Number keys now open Failures, All tests, Insights, History, and Gallery (`1`–`5`).
- `theme.preset` values `ocean`, `sunset`, `dracula`, `cyberpunk`, `forest`, and `rose` now set the accent colour only. `default`, `light`, `dark`, and `high-contrast` set the mode.
- The report no longer requests Google Fonts. Geist Sans and Geist Mono are bundled.
- `assetMode: 'auto'` (the default) writes `<name>-data.js` when the data is above 32 MB. Keep that file next to the HTML.
- `cspSafe: true` now writes `<name>-data.js` as well as `<name>.css` and `<name>.js`.
- The executive PDF variants are links in the export menu. The PDF files are unchanged.
- A breached quality gate in the reporter options now fails the Playwright run (exit code `1`). In 2.x it was only logged.
- New options are opt-in, except three that are on by default: `enableCausalTimeline`, `forecast`, and `ownership` (only when a CODEOWNERS file exists). Opt-in: `ai`, `accessibility`, `exportCtrf`, `exportFailures`, and code coverage (import `test` from `playwright-smart-reporter/coverage`). `assetMode` defaults to `'auto'`.
- The history file gains `stepDurations` per test entry and `forecasts` per run.
- `maxEmbeddedSize` has no effect. Traces are copied to `traces/` next to the report and are never embedded. The option is kept so existing configs still type-check.

## FAQ

### Is this really free?

Yes. Everything is MIT-licensed and included — no tiers, no license keys. AI analysis is the only feature with an external cost, and that's billed directly by your AI provider via your own API key. Local models have no per-request cost.

### RangeError with large test suites?

Update to 3.x. 2.x built the report as one string and failed with `RangeError: Invalid string length` on large suites (issue #19). 3.x writes report data one test at a time. In a synthetic benchmark (`docs/investigations/report-scale.md`), 2.x failed at 14,000 tests. 3.x wrote the same 14,000-test report in 215 ms with a 478 MB peak.

### Different flakiness than Playwright's HTML report?

They use different methodologies — see [Flakiness Detection](#flakiness-detection) above.

### Report too large or browser hangs?

3.x stores much less data than 2.x. In the same benchmark at 10,000 tests:

| | 2.x | 3.x |
|---|---|---|
| Report data | 401 MB of HTML | 70 MB |
| Peak memory while writing | 1,116 MB | 412 MB |

- With `assetMode: 'auto'` (default), data above 32 MB goes to `<name>-data.js`, so the browser does not parse one very large HTML document. See [Report Size and Asset Mode](#report-size-and-asset-mode).
- The test list renders through a virtual list. The UI tests scroll 10,000 rows.
- Screenshots are embedded as data URIs. `cspSafe: true` saves them as files instead.
- Reduce `maxHistoryRuns` to keep less history in the report.

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| No history data | History file missing or wrong path | Check `historyFile` path, use CI caching |
| No network logs | Tracing not enabled | Add `trace: 'retain-on-failure'` to config |
| No AI suggestions | No AI provider set | Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` with Claude Code installed, or `OLLAMA_HOST`/`ai.provider` for a local model |
| `Anthropic API error: 401` | Claude subscription OAuth token used as API key | Unset `ANTHROPIC_API_KEY`; set `CLAUDE_CODE_OAUTH_TOKEN` to use the Claude Code CLI |
| Ollama set but a cloud provider is used | A cloud key is also set and wins | Set `ai: { provider: 'ollama' }` |
| Page says "report data is missing" | `<name>-data.js` was not kept next to the HTML | Copy or upload the companion files with the HTML |
| Mixed project metrics | Shared history file | Use `projectName` to isolate |
| Quality gate not failing CI | The test step has `continue-on-error` (or `continueOnError`), so its exit code is ignored | Run `npx playwright-smart-reporter gate --config gates.json` as its own CI step |

## Development

```bash
npm install
npm run build
npm test
npm run test:demo
npm run ui:specimen   # build the UI specimen and report previews to .ui-specimen/
npm run test:ui       # Playwright tests for the report UI
```

## Contributors

- [Gary Parker](https://github.com/qa-gary-parker) — Creator and maintainer
- [Filip Gajic](https://github.com/Morph93) — v1.0.0 UI redesign
- [Liam Childs](https://github.com/liamchilds) — Parameterized project support

## License

MIT
