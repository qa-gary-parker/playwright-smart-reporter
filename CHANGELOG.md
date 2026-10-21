# Changelog

All notable changes to this project will be documented in this file.

## [4.0.0] - 2026-10-21

### Breaking changes
- **AI analysis is opt-in** (#56). `enableAIRecommendations` defaults to `false`. A provider key in the environment no longer turns it on. `enableAISuiteHealth` (default `true`) applies only when `enableAIRecommendations` is `true`. Without it the report shows "AI is off for this run".
- **Pass rate leaves out skipped tests** (#48). Pass rate is passed tests out of the tests that ran. 5 passed and 5 skipped was 50% and is now 100%. When every test is skipped, the pass rate is `null` (shown as "n/a"): `minPassRate` is skipped (it failed before) and `maxPassRate` notifications do not fire. `passRate` in `RunSummary`, `ReportSummary`, and the JSON export is `number | null`. History pass-rate trends step up at 4.0.0 for runs with skipped tests.
- **Flaky rate leaves out skipped tests** (#48). `maxFlakyRate` counts flaky tests out of the tests that ran. 1 flaky, 1 passed, and 8 skipped was 10% (it passed a 40% limit) and is now 50% (it fails). When no test ran, the rule is skipped (it passed at 0%).
- **JUnit names** (#55). The testcase name is `[project] describe › title`, with the project prefix only for named projects. `classname` is the file path (`tests/auth/login.spec.ts`, was `tests.auth.login`). There is one `<testsuite>` per project and file, with `hostname` set to the project. This matches the Playwright junit reporter with `includeProjectInTestName: true`. A `test.fail()` test that passes is a `<failure message="Expected to fail, but passed">`.
- **Comparison uses only the baseline run** (#50). Compare and `noNewFailures` compare with the baseline run, not with each test's own last history entry. A test that ran earlier but not in the baseline run goes to the new `notInBaseline` group, not to fixed or new tests. Example: run A runs all tests and `other` fails, run B runs `--grep @smoke`, run C runs all tests and all pass. In C, fixed tests was `[other]` and is now `[]`, and `notInBaseline` is `[other]`.
- **Report data `schemaVersion: 4`** (#50). `comparison.changes` and `ComparisonKey` gain `notInBaseline` (test ids in report data, full objects in `smart-report-data.json`). The `failures` command and the MCP server still read 3.x report data.
- **History run files** (#67). Every run also writes a run file to `test-history.runs/` next to `historyFile`: `<runId>.json`, or `<runId>.shard-<i>-of-<n>.json` for a shard. The folder follows `{project}` and `projectName`. `test-history.json` stays a complete index, so a CI cache that saves only that file keeps working.
- **Unknown `qualityGates` keys stop the run** (#70). An unknown key, including a typo in a flat key, stops the run before any test runs and fails both gate CLIs. 3.x ignored it.
- **Quarantine file** (#77). When no test qualifies, the reporter rewrites the quarantine file with `entries: []`. 3.x left the old file, so its tests stayed excluded. Entries gain `source` (`'auto'`, `'manual'`, or `'annotation'`), and `flakinessScore` is optional.

### Added
- **Failure cluster tracking** (#74). History saves the `clusterId` of each failed test. Insights labels each cluster New, Recurring (N runs, with the first date and commit in the tooltip), or Regressed, with a sparkline, and has a Resolved clusters panel. Report data and the JSON export carry `clusters[].tracking`, `failureClusters[].tracking`, and `resolvedClusters`. New notification condition `newClusters: true`.
- **Commit range for new failures** (#73). Each new failure and cluster shows the last-passed and first-failed commit from history CI info, with GitHub and GitLab compare links. It shows in test detail, the cluster label tooltip, the job summary, and the PR comment, and in the JSON export as `tests[].commits` and `failureClusters[].tracking.commits`. A test that passed and failed at the same commit shows "no code change" and links to that commit. `suspects: true` (default `false`) lists the files changed in that range with `git diff --name-only`. In a shallow clone or without git, there are no suspects and the range still shows.
- **Full CI info** (#73). Each run summary in history (`ciInfo`) and the JSON export (`metadata.ci`) records the full `sha`, `repoUrl`, `prNumber`, and `targetBranch` for GitHub Actions, GitLab, CircleCI, Jenkins, Azure DevOps, and Buildkite. CircleCI has no target branch. Credentials in clone URLs are removed.
- **Branch-aware baselines** (#78), opt-in. `baseline: { branch: 'target' }` compares with the latest run on the pull request target branch; `baseline: { branch: '<name>' }` compares with the latest run on that branch. The branch is the recorded `ciInfo.branch`, and a leading `origin/` (Jenkins freestyle `GIT_BRANCH`) is ignored. A run with no target branch keeps the previous run as the baseline and prints a note. The reporter also prints a note when no run in history is on the branch. `filterHistory: true` also computes flakiness and performance from that branch's runs only. `baselineRunId` wins over `baseline`. The Compare tab, the job summary, and the PR comment name the baseline run's branch and commit whenever they are recorded.
- **Scoped quality gate rules** (#70). `qualityGates.rules` applies a gate to a scope (`tag`, `project`, `file`, `owner`), and `severity: 'warn'` reports a breach in the terminal, report, PDF, and GitHub summary without failing the run. Example: `qualityGates: { minPassRate: 95, rules: [{ id: 'critical paths', scope: { tag: '@critical' }, minPassRate: 100 }, { scope: { project: 'chromium' }, maxFlakyRate: 2, severity: 'warn' }, { scope: { file: 'checkout/**', owner: '@shop-team' }, maxFailures: 0 }] }`. One rule per entry. A scope that matches no test skips the rule with "no test in scope". `minCoverage` cannot be scoped.
- **New quality gates**. `maxDurationRegression: 20` fails when the summed duration of the tests the performance analyzer compared is more than 20% above the sum of their passing-run medians (`--max-duration-regression`); it is skipped with "no duration history". `noNewFlaky: true` fails on a test that passed on retry in this run but on the first attempt in the baseline run; the comparison gains `newFlaky` (`--no-new-flaky`). `noNewClusters: true` fails when a failure cluster is New, that is, no run in the last `maxHistoryRuns` had it (`--no-new-clusters`); it is skipped with "clustering off" or "no cluster history". `noExpiredQuarantine: true` fails on an expired quarantine entry (`--no-expired-quarantine`); it works in `rules` but cannot be scoped, and is skipped with "no quarantine data". The gate CLIs read failure cluster tracking, tags, projects, and owners from the JSON export, and both take `--quarantine-file <path>` (default `.smart-quarantine.json` next to the data file).
- **Quarantine sources and expiry** (#77). Quarantine entries carry `source`, `owners`, `ticket`, `reason`, and `expiresAt`. Add entries by hand in `quarantine.manualFile` (default `.smart-quarantine.manual.json`; `testId` and `title` are required), for example `{ "entries": [{ "testId": "checkout.spec.ts::pays by card", "title": "pays by card", "ticket": "PAY-12", "reason": "Card sandbox times out", "owners": ["@acme/payments"], "expiresAt": "2026-11-30T00:00:00.000Z" }] }`, or with a `@quarantine(<ticket>)` tag or a `{ type: 'quarantine', description: '<ticket>' }` annotation. `quarantine.expiresAfterDays` sets an expiry on the other entries. The console lists expired entries. `quarantineEvents: true` on a Slack or Teams channel sends one "Quarantine changes:" message per run.
- **Redaction** (#71), off by default. `redact: true` masks secret environment values, credential pairs, and tokens in error messages, snippets, step titles, the Copy AI prompt, timeline text, and network log URLs before any report file is written. `redact: { patterns: [...] }` also masks regex matches. It covers the HTML, JSON, JUnit, CTRF, and PDF outputs, `test-history.json`, `history-runs/`, the failure bundle, the live results file, and AI prompts. It does not cover trace zips, screenshots, videos, attachments, test titles, ids and paths, annotations, request bodies, or accessibility results. An invalid pattern, or one that matches an empty string, stops the run when the reporter is created and names the entry.
- **Efficiency panel** (#76). Insights shows retry waste (for the run, per test, and as a trend), the share of run time in the slowest 5% and 10% of tests, the setup gap from run start, shard wall time, and worker busy and idle time. Report data and the JSON export carry `efficiency`. `ciCostPerMinute` (off by default) prices the retry waste. Worker and shard views need an unmerged run, because `merge-reports` drops the shard; a merged report says so. Each attempt keeps `workerIndex`, `parallelIndex`, and `startTime`, the report keeps `shard`, and history entries keep `retryWaste`.
- **Matrix view** (#75). A run with two or more projects gets a Matrix view of the tests whose outcome differs between projects, with one cell per project. `environmentInsights` names tests that fail in one project only, the same by browser, and failures that all ran on one worker slot. The test list can group by worker and shard.
- **Evidence of earlier attempts** (#53). Detail › Attempts shows the screenshots, videos, and traces of each earlier attempt of a flaky test. Report data gains optional `attempts[].attachments` and `attempts[].tracePath`. Traces are copied to `traces/<test>-attempt-<n>-trace-<i>.zip`.
- **Attempt divergence** (#72). Detail, the failure bundle (`divergence`), and the AI prompt (`# Attempts`, with each attempt's status, duration, and first error line) get a one-line summary of where the attempts diverged. Steps record `parent` and `depth`. For a flaky test, Detail › Attempts compares the traces of the failed and the passing attempt: requests seen in one attempt only or with a different status, and console errors and warnings that only the failed attempt logged (up to 50 of each; `tests[].attemptDiff`). Without both traces it names the missing one and says to set `trace: 'on'`. `redact` masks it.
- **Flakiness confidence** (#51, #69). `flakinessRuns` (the sample size) shows in Most flaky, quarantine entries (`runs`), the JSON export, and the digest. `flakinessInterval` (a 95% Wilson interval) is in report data and the JSON export. Detail shows, for example, "Flakiness 45% 21–72% over 11 runs".
- **Slow steps** (#69). Detail marks each `test.step` of a passed test that is slower than its passing-run median, for example login 100 ms over 5 runs and 310 ms now shows "3.1× slower". It needs 4 passing runs that include the step, a change above `performanceThreshold`, and at least 100 ms. Report data gains `stepTrends`.
- **Metrics export** (#79), off by default. `exportMetrics` writes `<name>-metrics.prom` and `<name>-metrics.otlp.json` per project and test file: tests, passed, failed, flaky, skipped, pass ratio, retry waste, run duration, and per-test duration, labelled with branch, project, and suite. Sample line: `smart_reporter_pass_ratio{branch="main",project="chromium",suite="cart.spec.ts"} 0.75`. `exportMetrics.push` POSTs one format to a Pushgateway or an OTLP/HTTP receiver with a 10 s timeout, for example `exportMetrics: { push: { url: 'http://pushgateway:9091/metrics/job/playwright', format: 'prometheus', headers: { Authorization: 'Basic …' } } }`.
- **GitHub issues** (#79), off by default. `github --issues` (action input `issues: true`) opens one GitHub issue per New failure cluster, with the label, tests, redacted error, commit range, suspects, and report link. A hidden marker makes later runs comment on the open issue. It opens up to 5 issues per run. It needs `issues: write`; a 403 prints a warning and exits 0.
- **Not in baseline** (#50). History › Compare has a "Not in baseline run" group. The job summary and the PR comment mark these tests and count them in the Failures heading. The Insights Failed card counts them, for example "1 new, 1 not in baseline".
- **History merging** (#57, #67). `merge-history -n` is short for `--max-runs`. History load also reads run files that the index does not list, so copying run files into `test-history.runs/` merges them. `merge-history` and `mergeHistories()` read the `.runs` folder next to each input.

### Changed
- **Failure clusters** (#68) group by a fingerprint: the error class or matcher, the masked message without the call log, the file, and the locator. Labels read like `toBeVisible on getByRole('button', { name: 'Save' }) at pages/checkout.page.ts:42`. Two locator timeouts that were one "Timeout Error" cluster are now two clusters. `order 1041` and `order 2087` were two clusters and are now one. Test timeouts form one cluster per file. Cluster ids are 16-hex SHA-256 prefixes (were 7–8 hex).
- A cluster has no New or Recurring label when history cannot tell: on the first run, and when history has failures but no cluster ids (runs before 4.0.0, or clustering off). A history with no failures still compares, so the first failure after green runs is New. The JSON export leaves out `failureClusters` when clustering is off (was `[]`).
- **Insufficient history** (#69). Below 5 runs (this run included), a test's flakiness status is `insufficient-history`, shown as "⚪ Insufficient history". In 3.x, 1 failure in 4 runs was 🟡 Unstable and 4 failed runs were 🔴 Failing. A pass on retry in this run is still Flaky. The duration trend shows "→ Insufficient history" until there are 4 passing runs; in 3.x one passing run could give "↑ 200% slower". The digest no longer lists a test with fewer than 5 runs as newly flaky.
- `noNewFailures` and `noNewFlaky` also count a failing or flaky test that did not run in the baseline run, including a new test with no history. The Insights Failed card, the job summary, and the PR comment count and mark a failing new test as new.
- The Insights gate panel and the executive PDF show readable rule names. The PDF said "Maximum Failures" and now says "Max failures". The accessibility, coverage, `maxDurationRegression`, and `noNewFlaky` rules no longer show as raw keys. The JSON export includes `performanceMetrics` per test.
- On GitHub `pull_request` runs, GitLab merged results pipelines, and Azure DevOps PR builds, the commit shown is the PR head, not the CI merge commit (#73). `commit` stays short.
- Detail › Attempts pairs steps by title path, not by position, and indents nested steps (#72). A `test.fail()` test's attempts are paired by its expected status.
- `mergeHistories(files, out, max)` keeps the test entries from the last `max` runs (#57). It kept the last `max` entries per test.
- Loaded history is trimmed to `maxHistoryRuns`.
- Quarantine (#77): `quarantinedAt` keeps its first value. A test that does not run keeps its entry. `maxQuarantined` caps only entries from the flakiness score. Automatic quarantine needs the flakiness status Flaky as well as the score threshold. Quarantine is built before quality gates are evaluated.
- Removed the unused `PerformanceAnalyzer.calculateSmartThreshold()`.

### Fixed
- `minPassRate` and `maxFlakyRate` compare the exact rate (#47). 299 of 300 no longer passes `minPassRate: 100`: it showed 100% and now shows 99.6%. Rates that are not whole numbers show one decimal.
- The executive PDF shows a grey "NO TESTS RAN" when every test was skipped or there were no tests (#48). It showed a green "ALL TESTS PASSED". `{{passRate}}` renders `n/a` when no test ran.
- Under `merge-reports`, the history duration, timestamp, and run id describe the run, not the merge (#49).
- Notifications, the PDF, ownership, Slack, Teams, PagerDuty, and live counters count a `test.fail()` test that passed as failed and an interrupted test as skipped (#66). The PDF per-file pass rate counts flaky tests as passed. All outputs read one `computeRunStats()`. The `minPassRate` skip reason is "no test ran".
- Every AI prompt (failure, cluster, and suite health, for all providers including the Claude CLI) is redacted before it is sent (#56): secret environment values, `password=` and `api_key=` pairs, bearer tokens, and known token formats. This does not cover PII, page text, or typed values. The README no longer says the prompt carries an environment snapshot.
- JUnit: a flaky test gets one `<flakyFailure>` per failed attempt, not counted as a failure (#55). A test interrupted on a retry after a failure counts once, as a failure (was an error).
- Tags (#63): an email address in a title no longer adds a tag. A dotted tag such as `@smoke.fast` no longer also adds `@smoke` (the title fallback now applies only on Playwright before 1.42).
- Suites in unnamed projects (#63): a test's suites are `[file, ...describes]`, and a top-level test gets `[file]`. This changes Group by suite, the `suite:` filter, JSON `suites` and `suite`, the CTRF suite, and the failure bundle `titlePath`. The command palette no longer offers a test file as a `suite:` filter. Group by suite groups describe blocks only, and tests outside a describe block go under (none).
- The baseline is no longer built in O(tests × history) time (#59): 137 ms at 10,000 tests.
- `live.notifyOnFirstFailure` fired on the first failed attempt, even when the test then passed on retry (#54). It now fires only when the last attempt fails. A `test.fail()` test that fails as expected does not send.
- With `notifications` set, the first failure sent a one-test run summary (total 1, 0% passed) to every channel, including PagerDuty and email, and Slack got a second message when `slackWebhook` was also set (#54). Now it sends "First failure detected" to the Slack and Teams channels in `notifications` only, routed by owners and conditions. `notifications` takes precedence over `slackWebhook` and `teamsWebhook`.
- ANSI stripping removes all CSI sequences and OSC 8 hyperlinks (BEL or ST terminated) from error text and from the stdout, stderr, and errors in AI prompts (#65).
- The retry summary counts attempts (#64): "Passed on attempt 2 of 2" (was "Passed on retry 2/2").
- The performance baseline is the median of passing runs (#52). History of 2000, 2000, and 30000 ms (failed), then 5000 ms now, shows "↑ 150% slower" (was "↓ 56% faster"). With no passing run it shows "→ Baseline". `averageDuration` and `performanceMetrics.averageDuration` hold the median (the names are unchanged), and Detail labels it "Median" (was "Avg"). The health digest also compares with the passing-run median: a 1.0 s → 1.5 s regression hidden by one 30 s timeout is now 50% slower, and one slow failure no longer reports a stable test as 925% slower.
- A fixed test no longer shows as flaky (#51). Failed 5 runs, then passed 6, is now 🟢 Stable with score 0.45 (was 🔴 Flaky, 0.5). A pass on a retry in this run is Flaky (was Stable after 9 clean passes).
- `mergeHistories()`, `src/merge-history.ts`, and `test:merge-local` use the `merge-history` bin's merge (#57). Two shards from one cache: test `a` entries 5 → 3, and the shared run total 1 → 2. Merging one file twice no longer doubles the entries (6 → 3). `forecasts` and `runFiles` are kept, and dropped for runs that `--max-runs` leaves out.
- Runs that share a history folder no longer lose each other's results (#58). If A and B load, then A saves, then B saves, the summaries were `['run-B']` and are now `['run-A', 'run-B']`. The index is rebuilt under `test-history.json.lock`: a run waits up to 10 s, and takes over a lock older than 30 s; if it cannot get the lock, its run file stays and the next run adds it. A re-run with the same `runId` replaces the earlier attempt. Shards on a shared folder record one run. With `enableHistoryDrilldown`, `history-runs/` snapshots outside the window or not in the index are deleted.
- Flaky tests keep the screenshots, videos, and traces of their failed attempts (#53); 3.x kept only the last attempt's. A test that fails every attempt keeps only its final attempt's evidence. The example suite report grows from 11.9 MB to 14.2 MB. `cspSafe` no longer leaves orphan screenshots.
- `serve` opens the report in the browser on Windows (was a console window) (#60). It uses no shell, so a file name cannot run a command.
- Ctrl+C on `serve` stops the run it started, on every OS (#61). On Windows, Cancel stops the whole run, and Run works again immediately.
- The Live view gets each result line once and whole: after partial writes, split characters, a late viewer, or macOS event bursts (#62).
- A skipped `minStabilityGrade` says "no stability grades" (was "no comparison data").
- Quarantine (#77): Insights no longer says "Not enabled" when quarantine is on and empty. The PDF says "due to high flakiness" only for automatic entries. A JSON error in the manual file names the file. An invalid `expiresAt` or `quarantinedAt` prints a warning and is ignored; an invalid `quarantinedAt` crashed the run with `expiresAfterDays`.
- **Python package:** `playwright-smart-reporter-python` writes a report again. Its bridge loaded a file that 3.0.0 removed. It now builds the same single-page report as the Node reporter, and the wheel ships the UI files. The footer shows the real version (was 0.0.0), and the empty Live view is gone. `python/README.md` lists what the Python path does not do.

### Upgrading from 3.x
- To keep AI analysis, set `enableAIRecommendations: true`.
- Pass rate and flaky rate now leave out skipped tests. Check `minPassRate` and `maxFlakyRate` limits and `maxPassRate` notification conditions on suites with many skipped tests.
- JUnit `classname` and testcase names changed. CI tools that key test history on classname and name (Azure DevOps, GitLab, Jenkins) start a new history. Rules that match the dotted classname must match the file path.
- Code that reads report data and checks `schemaVersion === 3` must also accept `4`. Sharded runs merged with `merge-history` should share one `runId`.
- If history is in the repository, add `test-history.runs/` to `.gitignore`. Cache or upload that folder only to combine shards from separate machines.
- Fix unknown or misspelt `qualityGates` keys before you upgrade: the run now stops on them.
- `noNewFailures` and `noNewFlaky` now fail on a new test that fails or is flaky.
- History from 3.x has no cluster ids. Until a 4.0.0 run records them, clusters have no New or Recurring label and `noNewClusters` is skipped with "no cluster history".
- Scripts that read `.smart-quarantine.json` directly must handle `entries: []` and entries without `flakinessScore`.

## [3.0.0] - 2026-10-15

### Breaking changes
- **New report renderer.** The template-string HTML report is replaced by a Preact single-page app built from a versioned `ReportData` payload (`schemaVersion: 3`). The report still opens over `file://` with no server. Insights (the landing view) and Failures replace Overview; Trends and Comparison are tabs of History; filters move from the sidebar to a filter bar. Number keys `1`–`5` now open Failures, All tests, Insights, History, and Gallery.
- **Theme presets.** `ocean`, `sunset`, `dracula`, `cyberpunk`, `forest`, and `rose` now set the accent colour only, on the active mode. `default`, `light`, `dark`, and `high-contrast` set the mode. No preset value errors.
- **Report data file.** `assetMode` defaults to `'auto'`: above 32 MB of data the reporter writes `<name>-data.js` next to the HTML. `cspSafe: true` always writes `<name>-data.js`, as well as `<name>.css` and `<name>.js`. Keep these files next to the HTML.
- **Quality gates fail the run.** A run with a breached reporter-side gate now exits 1. See Fixed.
- **Test ids.** A test inside `test.describe` now has the id `[project] file::describe › title`. In 2.x it was `[project] file::title`, so two tests with one title in different describe blocks shared one result and one history. The id no longer depends on which tests run together (a shard, `--grep`). History saved under a 2.x id moves to the new id the first time the test runs. Where two tests shared a 2.x id, only the tests in that first run keep the shared history. The JSON export, failure bundle, and quarantine file use the new ids.
- **Requirements.** The Playwright peer dependency is unchanged (`@playwright/test >=1.40.0`). New runtime dependency `@modelcontextprotocol/sdk` 1.31.0 (Node 18 or later), loaded only by the `mcp` command. New optional peer dependency `@axe-core/playwright >=4.0.0`, needed only for accessibility scanning.

### Added
- **Failures inbox and queues**: Failures, Flaky, Regressions, Quarantined, and All tests, in a virtualised list (10,000 rows tested) with a resizable detail pane. Failures groups by failure cluster.
- **Test detail** in triage order: error, expected/received diff, source frame, causal timeline, AI analysis, attempts with a step-by-step retry comparison, steps, network, console, attachments, history, accessibility, annotations. Section state is saved in `localStorage`.
- **Navigation**: command palette (⌘K), filter tokens (`status:`, `tag:`, `file:`, `project:`, `suite:`, `grade:`, `signal:`, `owner:`), grouping by cluster, file, project, suite, tag, status, grade, or owner, hash deep links, and a keyboard map (`?`).
- **History**: Trends (with a three-run average and markers for runs more than two standard deviations from the mean), a Reliability heatmap (test against run), and Compare. With `enableHistoryDrilldown`, a past run opens read only.
- **Insights**: stats row with sparklines, outcome bar, and panels for AI summary, quality gate, clusters, at-risk tests, coverage, regressions, slowest, most flaky, fixed, new tests, quarantine, and owners.
- **Accessibility view** and a per-test Accessibility section.
- **Theme control** with four modes (System, Light, Dark, High contrast) and seven accents. Geist Sans and Geist Mono are bundled.
- **Causal failure timeline** (`enableCausalTimeline`, default `true`): steps, network, and console on one time axis for each failed test, with a heuristic first-anomaly suggestion that also feeds the AI prompt. History stores `test.step` durations (`stepDurations`) as the slow-step baseline.
- **Local AI models** (`ai` option): Ollama via `OLLAMA_HOST`/`OLLAMA_MODEL` and any OpenAI-compatible endpoint. Every AI call has a timeout (`timeoutMs`, default 60 s) and the run has a total cap (`maxTotalMs`, default 300 s).
- **Flake forecasting** (`forecast`, on by default): names first-try passes whose history trends unstable. Advisory only; it never quarantines or gates. Risks are recorded per run in the history file (`forecasts`).
- **Ownership and routing** (`ownership`): owners from CODEOWNERS (last match wins) or git authors. Notifications accept `owners` and include only those owners' failures.
- **Code coverage** (opt-in): import `test` from `playwright-smart-reporter/coverage`, or wrap your own with `withCoverage()`. Collects V8 coverage in Chromium and Istanbul `window.__coverage__` counters in any browser, resolves source maps, and merges across shards through `merge-reports`. The report gains a Coverage view (files least covered first, source with per-line hit counts) and an Insights panel. `qualityGates.minCoverage` and `--min-coverage` on `dist/bin/gate.js` gate on line coverage.
- **Accessibility scanning** (opt-in): axe-core scans through `playwright-smart-reporter/accessibility` and `withAccessibility()`, with `qualityGates.maxA11yViolations`, `maxA11yCritical`, and `maxA11ySerious`.
- **CTRF export** (`exportCtrf`): `<name>-ctrf.json`, validated against the CTRF schema.
- **GitHub integration**: `playwright-smart-reporter github` and a composite action (`action.yml`) write a job summary, error annotations at the failing assertion, and one sticky pull request comment.
- **Agent-ready output**: `exportFailures` writes a redacted `<name>-failures.json`; `playwright-smart-reporter failures [--json]` prints it; `playwright-smart-reporter mcp` serves it over MCP (`list_failures`, `get_failure`, `get_trace_context`).
- `assetMode` option (`'inline'`, `'external'`, `'auto'`).
- The JSON export carries `line`, `column`, `errorLocation`, `rootDir`, the quality gate result, `a11y`, `timeline`, `owners`, and coverage totals.

### Changed
- Report data is written one test at a time instead of as one string. At 10,000 tests in the benchmark (`docs/investigations/report-scale.md`): 70 MB of data instead of 401 MB of HTML, and a 412 MB memory peak instead of 1,116 MB.
- Custom `theme` colours map onto the design tokens and apply in every mode.
- Executive PDF variants are links in the export menu instead of a picker dialog. The PDFs are unchanged.
- Annotations show as type and description in the test detail, without coloured badges. Stability grades move from list rows to the detail header.
- A test now counts as slower or faster (the Regressions queue, the `regression` and `slow` signals, Compare) only when it passed and its duration changed by both `performanceThreshold` (default 20%) and 250 ms. In 2.x, 95 ms to 155 ms counted, and so did a failed test that waited for a timeout.
- `maxEmbeddedSize` is deprecated and has no effect. Traces are copied to `traces/` next to the report and never embedded, so the reporter no longer reads each trace into memory.

### Fixed
- **Security:** `serve --run-command` passed filter values from `POST /run` to a shell after only stripping some characters, so a `"` in a file or grep filter could run any command. Any website open in the browser could send that request. Filter values are now quoted as single arguments. `/run` accepts only JSON from the report's own origin. The server answers only requests addressed to localhost, which blocks DNS rebinding. Outside the report folder it serves only trace and media files, never files such as `.env`. The live stream is no longer readable by other origins. (2.x bug.)
- `serve` no longer crashes on a malformed URL, a `--cwd` that does not exist, or a non-numeric `--port`. (2.x bug.)
- A breached quality gate set in the reporter options (`qualityGates`) now fails the Playwright run (exit code 1). In 2.x Playwright overrode the exit code, so a breached gate was only logged when every test passed.
- Large suites no longer fail with `RangeError: Invalid string length` (#19). In the benchmark 2.x failed at 14,000 tests; 3.x completes.
- The report no longer requests Google Fonts, so it renders the same offline.
- A cspSafe report no longer needs `'unsafe-inline'` for the app: it renders under `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'` (the trace viewer still does; see Known limitations).
- The Live tab's filter clear no longer replaces the test list's clear-filters action (2.x bug).
- A failed report write no longer skips history, exports, notifications, or quality gates.

### Known limitations
- The trace viewer is carried over from 2.x and uses inline event handlers. Under an enforced strict CSP its controls do not work; download the trace and run `npx playwright show-trace <file>`.
- Local model support is tested against a stub OpenAI-compatible server. It has not yet been run end to end against a real Ollama instance.

### Migration from 2.x
- Copy or upload `<name>-data.js` (and, with `cspSafe`, `<name>.css` and `<name>.js`) together with the HTML report.
- If you used a novelty preset for its background colours, set `theme.background`, `theme.surface`, and `theme.text` instead.
- See "Upgrading from 2.x" in the README.

## [2.2.0] - 2026-09-01

### Added
- `expect()` assertion steps now appear in the Step Timeline (#41). They are shown by default and kept even when `filterPwApiSteps` is on. Set `showExpectSteps: false` to restore the previous output.
- Claude Code CLI as an AI analysis provider (#40): set `CLAUDE_CODE_OAUTH_TOKEN` (Claude Pro/Team subscription) and analysis runs through the local `claude` CLI — no Anthropic API key needed. API keys take precedence when both are set. The CLI runs with all tools disabled (`--restricted --tools ""`), so it is text-in/text-out like the HTTP providers.
- An OAuth token mistakenly placed in `ANTHROPIC_API_KEY` is detected (`sk-ant-oat` prefix) and rerouted to the CLI provider with a warning instead of failing every request with a 401.
- `pdfFont` option for the executive PDF export (#42): embed a custom TTF/OTF (or TTC via `family`) so non-Latin scripts render instead of tofu. Arabic letters join and pure-Arabic lines read right-to-left; mixed-direction (Arabic+Latin) strings remain a known limitation — use `exportPdfFull: true` for full bidi via Chromium. Invalid font paths warn and fall back to Helvetica.

### Fixed
- The Anthropic 401 error now explains that subscription OAuth tokens are not API keys and points to the CLI provider instead of dumping a raw stack trace context.

## [2.1.0] - 2026-08-06

### Added
- **Copy AI Prompt** button on failed tests — copies a ready-to-paste, Playwright-style prompt (error, call log, code frame) for use with any AI assistant. No API key needed.
- `Failing` badge for consistently failing tests, distinct from `Flaky`.

### Fixed
- **Flaky classification**: tests that fail on every historical run are now classified as `Failing` instead of `Flaky`. Flakiness requires mixed pass/fail results. This corrects the flaky counts in the overview, sidebar filters, AI prompts, suite stability score, and the "Most Flaky Test" insight (which previously could highlight a test with a 100% failure rate).
- **Failure cluster names**: Playwright assertion failures now cluster by matcher (e.g. `Assertion: toBeVisible`) instead of producing a meaningless `Error` cluster.
- **Network logs summary**: shows the true request total with "(showing N)" when the list is capped, and status groups render as `2xx`/`4xx` instead of `200xx`/`400xx`.
- **Breadcrumbs**: now reflect the active view (previously always rooted at "Tests") and the test-title crumb only appears when a test is selected.
- **Pass-rate trend bars** (Overview quick insight) are colour-coded by rate instead of always green.
- The duration-trend chip (`→ Stable`, `↑ 20%`) is now labelled with a timer icon and tooltip so it isn't mistaken for a stability verdict.

## [2.0.0] - 2026-08-06

### Changed
- **Fully open source again.** All licensing, tiers, trials, and paid gating removed — every feature (AI analysis, exports, quality gates, quarantine, themes, branding, notifications, live run controls) is now available to everyone under MIT.
- AI failure analysis is bring-your-own-key again: set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY`. The StageWright managed AI proxy is gone.
- Report branding defaults to "Playwright Smart Reporter" (custom `branding.title` still supported).

### Removed
- `licenseKey` option and `SMART_REPORTER_LICENSE_KEY` env var (now ignored — safe to delete from configs).
- StageWright Cloud upload (`uploadToCloud`, `apiKey`, `projectId`, `cloudEndpoint`, `uploadArtifacts` options).
- Trial/upgrade banners, upgrade modal, and "Starter" badges in the HTML report.

### Migration from 1.x
- Remove `licenseKey` and any cloud upload options from your reporter config.
- To keep AI analysis, set one of the AI provider API keys above.
- Everything else is backwards compatible.

## [1.6.4] - 2026-03-05

### Added

- **Mobile responsive report**: Three-breakpoint responsive CSS (768px tablet, 600px phone, 480px small phone) — sidebar becomes overlay drawer on phones, hero stats stack to 2-col grid, master-detail stacks vertically, compact padding/fonts throughout, full-width menus on mobile

## [1.6.3] - 2026-03-04

### Added

- **Upgrade CTA Banner**: Dismissible banner at the top of the Overview tab for Local (free) tier users, linking to pricing
- **Contextual Upgrade Modals**: Clicking any gated feature (Quality Gates, Quarantine, AI Health Summary, PDF/JSON/JUnit exports, Live controls) now opens a descriptive modal with upgrade CTA instead of silently blocking
- **Feature Usage Summary Card**: "Your Plan: Local" card in Overview showing active vs locked features at a glance
- **Live tab always visible**: The Live tab now appears by default for all users; Local tier sees it gated as an upsell. Disable explicitly with `live: { enabled: false }`

### Changed

- Renamed "Community" tier label to "Local" across the report UI
- All pricing links now point to `stagewright.dev/#pricing` (was broken `/pricing` route)
- Updated README feature table with benefit-focused wording

## [1.6.0] - 2026-03-04

### Added

- **Live Section Starter Tier Gating**: Live execution controls (run/cancel/filter) now require Starter tier or above. Community tier users see the Live tab with a "Starter" badge and a greyed-out preview of the full interface
- **Enriched Live Failure Items**: Static failure feed now shows clickable cards with screenshot thumbnails, full error text, and "View Details" links that navigate to the Tests tab detail view
- **Live SSE Failure Context**: During live runs, failure items include structured layout with `data-testid` and a "View details after run completes" label
- **`prefers-reduced-motion` support**: Counter animations now respect the user's reduced motion preference

### Changed

- Error truncation in live SSE events increased from 200 to 500 characters for more useful failure previews
- Staggered list animations now play only once via `.animate-entrance` class (no re-triggering on tab switch)
- `setStatusAccent()` queries scoped to `#view-tests` to prevent cross-view side effects
- Design enhancement comments renumbered sequentially (1–9)

### Fixed

- Live section no longer flashes during tab switch when gated (disabled `viewFadeIn` animation on `.live-section-gated`)
- Run-row visibility now uses CSS class (`.live-run-row-hidden`) instead of inline style, fixing specificity issues with gated override
- Dark theme hover fallback changed from `rgba(0,0,0,0.04)` to `rgba(128,128,128,0.1)` for visibility
- Removed duplicate `.hero-stat-card` and `.insight-card` transition/hover rules (overridden by design enhancements)
- Moved `position: relative` to canonical `.top-bar` rule (was duplicated)
- Removed unnecessary `!important` from `barGrow` keyframe
- Screenshot thumbnails in failure feed guard against base64 data URIs to prevent report bloat

### Security

- Live run controls are cosmetic-only gating (CSS + JS) — documented that actual run capability requires server-side license validation on the `/run` endpoint

## [1.5.0] - 2026-03-02

### Added

- **AI Suite Health Summary** (Starter+): AI-generated executive summary in the Overview tab combining failure clusters, flakiness trends, performance regressions, and historical pass rate into natural-language insights. Enabled by default; disable with `enableAISuiteHealth: false` to preserve AI quota (counts as 1 AI request per run).

## [1.4.0] - 2026-02-28

### Added

- **Smooth area curves with gradient fills** on Trends tab — replaces flat bar charts with modern area visualisations matching the Overview sparkline style
- **Chart display toggles** — global "3-run avg" and "Bars" buttons in the Trends header let teams switch between area curves and bar charts, and show/hide the moving average line
- **Smooth moving average line** — the 3-run average now uses monotone cubic interpolation instead of straight-segment polylines

### Changed

- Moving average line colour changed from yellow (`#ffcc00`) to sky blue (`#38bdf8`) to avoid collision with the Flaky Tests chart colour
- Overview sparklines (Quality Gates, Quarantine) now include the current run as the rightmost data point, matching the Trends tab data exactly
- Overview sparklines now use fixed y-axis scaling (0–100 for pass rate, 0–max for flaky count) to match Trends chart proportions
- Anomaly markers simplified to red dots only (removed dashed bar stroke)

### Fixed

- Defensive `?? 0` for `s.flaky` in sparkline data to prevent `NaN` from legacy history files missing the flaky field
- Trend controls now correctly hide when the Trends section is collapsed

### Removed

- Dead `.chart-bar-anomaly` CSS class (no longer referenced after anomaly marker simplification)

## [1.3.0] - 2026-02-26

### Added

- **CSP-safe external files** (#31): When `cspSafe: true`, the reporter now generates companion `.css` and `.js` files alongside the HTML report. Styles and scripts are loaded via `<link>` and `<script src>` instead of inline tags. Report data is embedded in `<script type="application/json">` tags. This enables reports to render under Jenkins' Content Security Policy (requires `script-src 'self' 'unsafe-inline'`).
- `GeneratedReport` type exported from `html-generator` for programmatic access to companion file contents

### Fixed

- **Skipped test navigation broken** (#33): Clicking status counts in the overview now correctly filters tests. `filterByStatus()` was updating DOM chip classes but not the `activeFilters` state, causing `applyFilters()` to read stale data.
- **Flaky filter mismatch** (#30): The "Flaky" filter now catches tests that are flaky by either outcome (passed on retry) or history (flakinessScore >= 0.3). Previously, the sidebar count used outcome-based detection while the filter chip used history-based detection, causing mismatches.
- **Tests labeled "New" despite history** (#30): Tests with all-skipped history are now labeled "Skipped" instead of "New". Path normalization in `getTestId()` (forward slashes, strip leading `./`) reduces history lookup misses across CI environments.
- Removed duplicate inline flakiness/performance calculation in `SmartReporter.onTestEnd()` — analyzers are now the sole authority
- Companion file paths now use `path.join()` instead of regex replacement for robustness

### Security

- HTML-escaped `outputBasename` and `data-theme` attribute values to prevent attribute injection
- Fixed JSON entity-escaping order (`&` now replaced before `<`/`>` to prevent double-encoding)
- CSP JS extraction uses explicit `@csp-split` marker instead of fragile `indexOf` string matching

## [1.2.0] - 2026-02-25

### Breaking Changes

- **AI analysis is now a managed service** — BYOK provider keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) are no longer used. AI is powered by GPT-4o-mini via the StageWright proxy and requires a Starter or Pro license.

### Added

- **Managed AI Proxy**: failure analysis calls `stagewright.dev/api/ai/analyze` with automatic license validation and rate limiting
- **Starter Tier** (£5/mo, ~$6): 2,000 AI analyses/month, 6 extra themes, PDF/JSON/JUnit export, quality gates, quarantine, custom branding
- **Pro Tier** (£9/mo, ~$12): 5,000 AI analyses/month, fully custom theme colours, 3 PDF styles, priority email support
- AI quota tracking with remaining count and reset date logged after first analysis

### Changed

- `AIAnalyzer` rewritten to call StageWright proxy instead of direct provider APIs
- AI gated behind Starter/Pro license — community tier shows upsell message
- `NetworkLogEntry.requestBody` and `responseBody` types changed from `any` to `unknown`

### Removed

- BYOK AI provider support (Anthropic, OpenAI, Gemini direct API calls)
- `AIConfig` interface (`model`, `systemPrompt`, `promptTemplate`, `maxTokens` options)
- `ai-analyzer-config.test.ts` (obsolete BYOK tests)

### Fixed

- AI proxy URL corrected (`/api/ai/analyze`, not `/api/v1/ai/analyze`)
- `resetAt` type mismatch between server (ISO string) and client (expected number)
- Duplicate upsell console.log removed from `AIAnalyzer.analyzeFailed()`
- `tryParseJson` return type changed from `any` to `unknown`

### Security

- 20KB prompt size limit on AI proxy
- Explicit tier allowlist for AI access
- Module-scope rate limiter (not re-created per request)
- Rate limit key normalized to prevent bypasses
- Payment status verified before license issuance

## [1.1.1] - 2026-02-24

### Changed

- Updated README with Pro features documentation, screenshots, and pricing info
- Added dark theme screenshots
- Improved npm keywords for discoverability

## [1.1.0] - 2026-02-24

### Added

- **Pro Tier** — premium features behind ES256 JWT license validation
- **Quality Gates**: configurable thresholds (min pass rate, max flaky rate, min stability grade) with CI exit codes via `npx playwright-smart-reporter gate`
- **Flaky Test Quarantine**: auto-detection and JSON-based tracking with `getQuarantinedPattern()` helper for `test.skip()`
- **Executive PDF Export**: three themed variants (Corporate, Minimal, Dark) via pdfkit with PDF style picker modal in HTML report
- **6 Themes**: Ocean, Sunset, Dracula, Cyberpunk, Forest, Rose
- **Custom Branding**: configurable report title, footer text, accent colours, and logo
- **AI Health Digest**: weekly/daily/monthly trend summaries from history data via `npx playwright-smart-reporter digest`
- **Notification System**: Slack, Microsoft Teams, email (SendGrid), and PagerDuty integrations with configurable rules
- **Cloud Upload**: StageWright Cloud integration with presigned artifact uploads
- **CLI Tools**: `gate` (quality gate evaluation), `serve` (local HTTP server with trace viewer CORS), `view-trace`, `merge-history`
- 36 new tests for collectors, notifiers, exporters, gates, quarantine, and digest

### Security

- XSS escaping for JS contexts in HTML generator
- Path traversal prevention in serve CLI
- Webhook URL validation for notification endpoints
- `.npmignore` hardening to exclude keys, tests, and examples from published package

## [1.0.8] - 2026-02-06

### Added

- **Step Timeline**: flamechart visualisation with colour-coded categories (navigation, assertion, action, API, wait) for step-level timing analysis
- **Enhanced Trend Charts**: moving averages and 2-sigma anomaly detection for pass rate, duration, flaky count, and slow test trends
- **CI Environment Detection**: auto-detect GitHub Actions, GitLab CI, CircleCI, Jenkins, Azure DevOps, and Buildkite; display CI badge in report header
- **Configurable Thresholds**: `ThresholdConfig` for flakiness, performance regression percentages, stability weights, and grade boundaries
- **AI Analysis Batching**: concurrent batched requests (3 at a time) for large test suites
- **Virtual Scroll Pagination**: smooth rendering for test lists with 500+ tests
- **Keyboard Navigation**: `1-5` switch views, `j/k` navigate tests, `f` focus search, `e` export summary
- **Exportable Summary Card**: one-click export of test run summary
- **Python/pytest Integration**: monorepo bridge approach with PyPI-publishable package (#28)

### Security

- Sanitise `runId` in HTML attributes and filenames to prevent XSS and path traversal
- Guard empty project names in test IDs

## [1.0.7] - 2026-02-03

### Added

- **Browser/Project Badges**: display browser badges (chromium, firefox, webkit) and project names for multi-browser/multi-project setups ([#23](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/23))
- **Full Annotations Support**: capture and display all test annotations (`@slow`, `@fixme`, `@skip`, custom) with icons and coloured badges
- **Step Filtering**: `filterPwApiSteps` option to hide verbose `pw:api` steps and show only custom `test.step()` entries ([#22](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/22))
- **Path Resolution**: `relativeToCwd` option to resolve `outputFile` and `historyFile` relative to CWD instead of Playwright's rootDir ([#20](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/20))
- **Project History Isolation**: `projectName` option with `{project}` placeholder in `historyFile` path for per-project history ([#21](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/21))
- Cucumber integration documentation (playwright-bdd and cucumber-playwright)

### Fixed

- **RangeError with Large Test Suites** ([#19](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/19)): prevent crash when processing suites with many tests
- Improved badge layout with dedicated row, visual separators, and consistent spacing
- Project name extraction uses Playwright project config directly

## [1.0.5] - 2026-01-26

### Fixed

- **Retries Double-Counted** ([#17](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/17))
  - Test retries no longer inflate test counts (e.g., 509 tests showing as 530)
  - Only the final attempt for each test is counted
  - Uses Playwright's `test.outcome()` to properly identify flaky tests

- **Expected Failures Incorrectly Reported** ([#16](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/16))
  - Tests marked with `test.fail()` that actually fail are now counted as passed (expected behavior)
  - Uses Playwright's `expectedStatus` to determine expected outcomes
  - Expected failures are excluded from failure clustering

### Added

- **Improved Tag Extraction** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Tags now extracted from `test.tags` property (Playwright's built-in collection)
  - Falls back to annotations and title parsing for backwards compatibility
  - Tags are visible in the test cards and sidebar filters

- **Better Console Output** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Report path now includes helpful commands to open the report
  - Shows `npx playwright show-report` and `open` commands

- **Custom Attachments Support** ([#15](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/15))
  - Attachments added via `testInfo.attach()` are now collected and displayed
  - Custom attachments appear in test details with appropriate icons

- **Inline Trace Viewer** ([#13](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/13))
  - View Playwright traces directly in the dashboard without CLI commands
  - Full-featured viewer with timeline, actions, snapshots, console, and network tabs
  - Includes JSZip for client-side trace extraction
  - Fallback to CLI command when viewing from file:// protocol

- **Attachment Gallery** ([#14](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/14))
  - Gallery view displays all screenshots, videos, and traces in a grid
  - Lightbox support for screenshot viewing with keyboard navigation
  - Filter by attachment type (screenshots, videos, traces)

## [1.0.4] - 2026-01-26

### Added

- **Google Gemini AI Support** ([#18](https://github.com/qa-gary-parker/playwright-smart-reporter/pull/18))
  - Added `GEMINI_API_KEY` environment variable for Google Gemini API integration
  - Uses `gemini-2.5-flash` model for fast, cost-effective failure analysis
  - Provider priority: Anthropic Claude → OpenAI → Google Gemini
  - Comprehensive test coverage for AI analyzer (31 new tests)
  - Thanks to [@TheAntz](https://github.com/TheAntz) for this contribution!

## [1.0.3] - 2026-01-21

### Fixed

- **Timed Out Tests Now Counted as Failed** ([#12](https://github.com/qa-gary-parker/playwright-smart-reporter/issues/12))
  - Tests with `timedOut` status are now correctly counted as failed in summary stats
  - Comparison detection for new failures and fixed tests now includes timedOut status
  - Previously, timedOut tests showed as 0 failed in stats

## [1.0.2] - 2026-01-21

### Added

- **Network Logs**: Zero-config extraction of network requests from Playwright trace files
  - View HTTP method, URL, status code, duration, and payload sizes
  - Expandable entries show headers, request body, and timing breakdown
  - Configurable via `enableNetworkLogs`, `networkLogExcludeAssets`, `networkLogMaxEntries`
- **Tag-Based Filtering**: Filter tests by tags like `@smoke`, `@critical`
  - Tags extracted from test annotations and test titles
  - Tags displayed as badges on test cards
- **Suite-Based Filtering**: Filter by test suite from `test.describe()` blocks
  - Suite name shown in test card header
  - Hierarchical suite support

### Changed

- **Branding Update**: Renamed to "StageWright Local" with tagline "Get your test stage right."

### Fixed

- **Sidebar Stats Click**: Clicking Passed/Failed/Flaky stats now works from any view (switches to Tests view)
- **Expand/Collapse in Detail Panel**: Test cards in detail panel now expand correctly
  - Fixed event handling for cloned cards
  - Removed redundant expand icon from detail panel cards

## [1.0.0] - 2026-01-20

### Major Release - Full Reporter Redesign

This release represents a complete visual overhaul of the Smart Reporter, featuring a modern sidebar-based navigation system and numerous UX improvements.

**Special thanks to [Filip Gajic](https://github.com/Morph93) (@Morph93) for designing and implementing the core UI redesign!**

### Added

- **Sidebar Navigation**: New collapsible sidebar with organized views (Overview, Tests, Trends, Comparison, Gallery)
- **Theme Support**: Light, dark, and system theme modes with persistent preference
- **Interactive Trend Charts**: Clickable chart bars to navigate to historical runs
- **Historical Run Navigation**: View test results from any previous run with "Back to Current Run" functionality
- **Per-Test History Dots**: Click through historical results for individual tests
- **Attention-Based Filtering**: Visual badges and filters for New Failures, Regressions, and Fixed tests
- **Failure Clusters**: Enhanced error grouping showing error preview, affected test names, and file locations
- **Quick Insights Cards**: Clickable cards for Slowest Test, Most Flaky Test, and Test Distribution
- **Interactive Mini-Bars**: Click test distribution bars to filter by status
- **Clickable Progress Ring**: Navigate to tests view by clicking the pass rate indicator
- **Suite Health Grade**: Overall health score with pass rate, stability, and performance metrics
- **Trace Viewer Integration**: Per-test trace viewer access
- **Generator Smoke Tests**: Comprehensive test coverage for HTML, chart, and card generators
- **ARIA Accessibility**: Improved keyboard navigation and screen reader support

### Changed

- **Navigation Layout**: Reorganized from single-page scroll to multi-view navigation
- **Sidebar Behavior**: Persistent sidebar (no overlay) with smooth close animation
- **Duration Formatting**: Cleaner display with whole milliseconds and 1 decimal for seconds/minutes
- **Filter Chips**: Rounded design with improved hover states
- **Section Headers**: Refined styling with bottom borders
- **Test Cards**: Subtle box shadows for better visual hierarchy
- **Stat Cards**: Colored left borders matching their status

### Fixed

- Button element CSS reset for styled navigation buttons
- SVG coordinate precision in chart generation
- Duration bar height calculations in test cards
- Step bar width calculations

## [0.9.0] - Previous Release

- Initial Smart Reporter implementation
- AI-powered failure analysis
- Flakiness detection and scoring
- Performance regression alerts
- Retry analysis
- Stability scoring
