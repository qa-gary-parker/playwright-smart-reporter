# Issue backlog plan: #47–#79 (4.0.0 and 4.x)

**TLDR**
- I checked all 33 open issues against master `6f809cb` (v3.0.0). The evidence is code reading plus repros.
- Bugs: all 19 are real.
  - 4 have wrong details in the issue (#48, #62, #63, #64).
  - The Windows parts of #60 and #61 are confirmed from code only.
- Enhancements: all 14 have accurate premises. 8 are split across phases (#69, #70, #72, #73, #75, #76, #77, #79).
- Delivery: one `v4` branch, one PR and one `4.0.0` release. There is one commit or more per phase, so the PR can be reviewed in order.
- The work runs in four waves of parallel worktree agents. They are ordered by dependency and integrated by cherry-pick (see "Delivery waves").
- Some parts are out of scope, because they need a server or credentials, or because the data does not exist (see "Excluded").

**Settled 2026-10-16:**
- One PR and one 4.0.0 release for every phase. This replaces the earlier three-release split.
- All breaking changes ship together now as 4.0.0. They are: AI opt-in (#56), skipped tests left out of the pass rate (#48), qualified JUnit names (#55), and a baseline taken from one run (#50).
- Scope is every bug plus every part of an enhancement that fits.

**Delivered 2026-10-21 (branch `v4`):**
- All 37 phases are done, one commit or more per phase. Phase 14 is folded into Phase 19.
- The Python bridge fix is in the same PR. The `app.js` size budget is 136 KB (was 128 KB).
- No `clusterKey` hook is built. The fingerprint is fixed, so 4.0.0 adds no extension API.
- Two breaking changes are outside Release A: an unknown `qualityGates` key stops the run (Phase 25), and the quarantine file is cleared when nothing qualifies (Phase 35).
- `noNewFailures` and `noNewFlaky` also count a failing or flaky test with no history, and tests not in the baseline run.
- `noNewClusters` is skipped with "no history" when the window has no runs, and with "no cluster history" when it has failures but no cluster ids. Otherwise it evaluates, so after green runs any cluster is New.
- Cluster ids are 16-hex SHA-256 prefixes without the line number. Earlier-attempt evidence is kept for flaky tests only.
- Phase 21 shows the baseline run's branch and commit whenever they are recorded. Phase 37 uses REST through `gh api`, not `gh issue create`, because a GraphQL 403 cannot be detected.

---

## Baseline (2026-10-16, master @ 6f809cb, v3.0.0)

- npm shows 3.0.0 as the latest version. It was released 2026-10-15.
- All 33 issues come from one external reporter, filed 2026-10-15 between 20:24 and 20:40.
- CI: `demo.yml` runs `npm test`, `test:acceptance`, `lint:css` and `test:ui` on PRs to master.
  - Every job runs on `ubuntu-latest`. There is no Windows job.
- `SCHEMA_VERSION` is 3 (`src/report-data/schema.ts:15`).
- There is no Python option-parity test. `python/.../converter.py:126` hardcodes `enableAIRecommendations: True`.
- No unit test calls `onTestEnd`. For reporter-behaviour tests, use the acceptance harness: `example/acceptance/`, run with `ACCEPTANCE_E2E=1` after a build.
- `npm test` at baseline: 53 files, 901 tests, all passing.

## Triage

| # | Verdict | Size | Phase | Note |
|---|---|---|---|---|
| 47 | Confirmed, both directions | S | 1 | The issue's float compare breaks on exact boundaries (29/100 vs 29). Compare integers instead. |
| 48 | Confirmed, mostly | M | 3, 4 | `executive-pdf` uses the notifier's definition. `calculateSuiteStats` has no caller. `builder.summarize` is missing from the issue's list. |
| 49 | Confirmed (real merge run: 40 ms vs 4353 ms) | S | 2 | `timestamp` and `runId` are also taken at merge time. |
| 50 | Confirmed (e2e) | S–M | 8 | Changes what `noNewFailures` and the comparison report. |
| 51 | Confirmed | M | 13 | Keep the score format (1.0 = always failing). Add a classification and a sample size. |
| 52 | Confirmed | S | 12 | Example: a regression of 150% slower currently reads as "56% faster". |
| 53 | Confirmed | M | 16 | With `cspSafe`, extra attempt screenshots are left behind as orphan files. |
| 54 | Confirmed (real run) | S | 9 | The one-shot flag is used up by a flaky test, so a real failure later never notifies. |
| 55 | Confirmed | S×3 | 7 | Unexpected pass shows as green. No `flakyFailure`. Names collide. |
| 56 | Confirmed (mock-server capture) | S | 5 | Typed passwords and page text reach the provider. The "env snapshot" claim is false. |
| 57 | Confirmed | M | 15 | The bin also drops `runFiles` and `forecasts`, and the README documents this. |
| 58 | Confirmed (two-process race) | S–M | 14 | A reused `runId` duplicates summaries. |
| 59 | Confirmed (137 ms at 10k tests) | S | 8 | Same loop as #50. |
| 60 | Confirmed from code only | S | 17 | `start "<url>"` treats the URL as the window title. There is no `--open` flag, only `--no-open`. |
| 61 | Ctrl+C part confirmed on macOS; Windows part from code only | S | 17 | Ctrl+C leaves the run going on every OS. |
| 62 | Partly confirmed | S | 18 | Partial lines break the stream. Late clients get duplicates, not a missing `start`. |
| 63 | Confirmed | S | 6 | The issue's regex, used with `.match`, keeps the whitespace. Named projects include the file; unnamed ones do not. |
| 64 | Confirmed, latent | S | 11 | Nothing in production reads the label. |
| 65 | Confirmed | S | 10 | A second copy of the regex is in `prompt-builder.ts:25`. |
| 66 | Confirmed, with more cases than listed | M | 3 | About 20 sites and 3 definitions. |
| 67 | Premise confirmed | L | 19 | Name clash with the existing opt-in `history-runs/`. |
| 68 | Fits | M | 22 | Cluster ids are 32-bit hashes, so collisions will happen once they are stored. |
| 69 | Premise confirmed, bundles 3 deliverables | L | 12, 27, 28 | The Detail view already shows the sample size. |
| 70 | Premise confirmed | L | 25, 26 | Unknown gate keys are ignored silently. |
| 71 | Partly confirmed | M–L | 29 | Redact in `onTestEnd`, not in `buildReportData`. |
| 72 | Fits in part | L | 33, 34 | The step-level compare already ships. Screenshot-at-step cannot be built. |
| 73 | Fits in part | L | 20, 24 | `RunSummary.ciInfo` is declared but never written. |
| 74 | Fits | L | 23 | — |
| 75 | Fits in part | M | 32 | OS is excluded. |
| 76 | Fits in part | L | 30, 31 | The rebalance suggestion is excluded. |
| 77 | Fits in part | M–L | 35 | Auto-release is excluded. `quarantinedAt` is rewritten on every run. |
| 78 | Fits | M | 21 | Opt-in, because of the compatibility rules. |
| 79 | Fits in part | XL | 36, 37 | ADO API, Jira and Azure Boards are excluded. |

## Scope decisions

**Excluded, with the reason to record when closing or splitting the issue**
- #79: the ADO Test Results API, Jira and Azure Boards need credentials and network calls in core. ADO users get correct results through the fixed JUnit output (Phase 7).
- #72: a screenshot at the same step. Screenshots exist only at failure, and traces are not mined for frames (v3 roadmap).
- #75: OS as a matrix dimension. Each OS is a separate job and history, and testIds collide when results are merged.
- #76: the shard rebalance suggestion. There is no verified way for a user to apply a custom shard split.
- #77: automatic release after clean runs. Quarantined tests do not run, so they produce no clean-run data.
- #73: coverage-based suspects. They need per-test coverage file sets, which are not collected (only summed hits are).

**Compatibility contract (4.x, carried over from v3)**
- The default output stays one HTML file that opens over `file://`.
- 4.0.0 changes only the defaults listed under Release A, plus the always-on run files from Phase 19. Each change has a migration note in the CHANGELOG.
- Any feature that adds a network call, a git call, or a new kind of output ships behind a new key that is off by default.
- Every new or changed option is updated in `python/playwright_smart_reporter_python/converter.py` in the same PR.

**Gates for every phase**
- Run `npm test` and `npm run build`. Run `ACCEPTANCE_E2E=1 npm run test:acceptance` when reporter behaviour changes.
- Run `lint:css` and `test:ui` when the UI changes. Update Linux baselines only with `npm run test:ui:docker`.
- Show each new or changed test failing before the fix and passing after. Assert exact values, not negations.
- Add a CHANGELOG entry. Update the README wherever documented behaviour changes.

## Phase order and critical path

```
Release A — 4.0.0
  1 (#47) ─┐
  2 (#49) ─┼─▶ 3 (#66 module) ─▶ 4 (#48 denominator)
           │
  5 (#56 redact + opt-in)
  6 (#63) ─▶ 7 (#55 JUnit)
  8 (#50+#59 baseline)

Release B — 4.0.x / 4.1 (after 4.0.0; independent unless noted)
  9 #54 · 10 #65 · 11 #64 · 12 #52+stats helpers ─▶ 13 #51
  14 #58 · 15 #57 · 16 #53 · 17 #60+#61 · 18 #62

Release C — 4.x minors
  19 #67 storage (design gate first)
  20 #73.1 ciInfo ─▶ 21 #78 branch baseline (needs 8, ideally 19)
  10 ─▶ 22 #68 fingerprint ─▶ 23 #74 cluster tracking (needs 8; 19 for "Regressed")
  20 + 23 ─▶ 24 #73.2 first-failed commit + suspects
  1+3+8 ─▶ 25 #70 scoped gates ─▶ 26 #70 new rules
  12+13 ─▶ 27 #69 confidence ─▶ 28 #69 step trends
  5 ─▶ 29 #71 artifact redaction
  30 execution metadata ─▶ 31 #76 efficiency, 32 #75 matrix (needs 6)
  16+11 ─▶ 33 #72 step compare ─▶ 34 #72 network/console diff
  13 ─▶ 35 #77 quarantine lifecycle
  3+2+30 ─▶ 36 #79 metrics export
  23+24+5 ─▶ 37 #79 GitHub issue per cluster
```

---

## Delivery waves

All phases ship in one 4.0.0 release, so the release headings below only group the phases. Each wave starts from `v4` after the previous wave has been integrated.

- **Wave 1:**
  - Stats core: 1, 2, 3, 4.
  - Serve and live: 17, 18.
  - AI: 5.
  - Text and analyzers: 10, 11, 12.
  - JUnit: 6, 7.
  - Fingerprint: 22.
  - Attempt evidence: 16.
- **Wave 2:**
  - History storage: 19 (14 is folded in), 15, 20.
  - Comparison: 8.
  - Flakiness: 13, 27, 28.
  - Notify: 9.
  - Redaction: 29.
  - Attempt compare: 33, 34.
- **Wave 3:**
  - Execution metadata: 30, 31, 32.
  - Cluster tracking: 23.
  - Branch baseline: 21.
  - Gates: 25, 26.
  - Quarantine: 35.
- **Wave 4:**
  - Suspects and GitHub issues: 24, 37.
  - Metrics: 36.
- **Close-out:**
  - Version 4.0.0, CHANGELOG and README.
  - Full validation, including `test:ui:docker`.
  - Review, then the PR.

Agents do not edit `CHANGELOG.md`. Each one reports its entry, and the entries are written once at close-out.

## Release A — 4.0.0 breaking batch

### Phase 1 — Gate threshold compare (#47)
- **Goal:** `minPassRate` and `maxFlakyRate` give the right answer at every boundary.
- **Deliverables:**
  - In `quality-gate-evaluator.ts:86` and `:108`, compare integers: `passed*100 >= threshold*total` and `flaky*100 <= threshold*total`.
  - The display value `actual` is a whole number when the rate is exact, otherwise 1 decimal place.
  - Round the pass rate down and the flaky rate up, so a failing gate never displays `100% ≥ 100%`.
- **Acceptance evidence:**
  - 300 tests with 1 failure and `minPassRate:100`: `passed === false`.
  - 300 tests with 1 flaky and `maxFlakyRate:0`: `passed === false` and `actual === '0.4%'`.
  - 497/500 with `minPassRate:99.4`: `passed === true`.
  - Sweep every t ≤ 1000 with integer thresholds: no wrong boundary results.
- **Traps:**
  - Do not use `(p/t)*100 >= thr`. 29/100 then fails a threshold of 29.
  - `quality-gate-evaluator.test.ts:611` pins `'33%'`. It becomes `'33.3%'`. Update it on purpose.
- **Semver:** behaviour change (gates get stricter). CHANGELOG note.

### Phase 2 — History run clock under merge-reports (#49)
- **Goal:** under `merge-reports`, history `duration`, `timestamp` and `runId` describe the original run.
- **Deliverables:** pass the reporter's corrected start time and duration into `HistoryCollector.updateHistory` (`smart-reporter.ts:909`, `history-collector.ts:89,165`).
- **Acceptance evidence:**
  - Unit test: build the collector at T0, advance 50 ms, call `updateHistory(..., 600_000)`, and assert `summaries[0].duration === 600_000`.
  - Real 2-shard merge run: the history duration matches the JSON `summary.duration` within 100 ms.
- **Trap:** `builder.ts:83` uses `input.startTime`. Use the same value in both places.

### Phase 3 — Single run-statistics module (#66, #48 definitions)
- **Goal:** every output computes passed, failed, skipped, flaky and pass rate in one function. The current denominator stays.
- **Deliverables:**
  - `computeRunStats(results)` in `src/utils/`, built on `isPassedTest`, `isFailedTest` and `isSkippedTest`. It returns the counts, the raw ratio and a display value.
  - One `RunSummary` builder replaces the three at `builder.ts:83`, `history-collector.ts:167` and `smart-reporter.ts:618`.
  - Move onto the module every site in the inventory, including `report-data/comparison.ts:30-35`:
    - `notification-manager.ts`, `executive-pdf.ts:190`, `ownership.ts:253`;
    - `json-exporter.ts`, gates, AI stats;
    - `live-writer.ts`, the Slack, Teams and PagerDuty notifiers, `ui/app/data.ts`.
  - Gates keep the integer compare from Phase 1, now using the module's counts.
  - Delete `stability-scorer.calculateSuiteStats`, which has no production caller, and its tests.
  - Keep one grade average. There are 3 copies today: `json-exporter.ts`, `executive-pdf.ts:203` and the gate.
- **Acceptance evidence:** one table-driven test asserts that every consumer returns the same `{passed, failed, skipped, flaky, passRate}`. Scenarios:
  - 5 pass + 5 skipped;
  - a `test.fail()` that passes unexpectedly;
  - an interrupted test;
  - flaky by outcome vs flaky by score.
  - Today the notification payload gives `failed:0, passed:2` and the JSON gives `failed:1, passed:1`.
- **Traps:**
  - Keep per-run flaky (`outcome==='flaky'`) separate from history flaky (score).
  - The issue's table puts the PDF in the wrong group. Use the inventory, not the issue.
- **Semver:** output changes only for unexpected passes and interrupted tests.

### Phase 4 — Pass rate excludes skipped tests (#48, breaking)
- **Goal:** a run with 0 failures shows 100% whatever the skip count.
- **Deliverables:**
  - In `computeRunStats` only: `passRate = passed / (total - skipped)`.
  - A run with every test skipped returns `null`, and outputs display "n/a".
  - CHANGELOG migration note: pass-rate trends in history files step up at the 4.0.0 boundary.
- **Acceptance evidence:**
  - 5 pass + 5 skipped: `passRate === 100` in the gate, JSON, history, PDF and notifications.
  - All skipped: `passRate === null`, and `minPassRate` reports the rule as skipped, not passed.
- **Tests that pin the old policy, to update on purpose:** `json-exporter.test.ts:127`, `report-data.test.ts:34`, `notification-boundary.test.ts:384-392`.
- **Trap:** for the all-skipped run, decide how the PDF colours and `maxPassRate` notification conditions treat `null`. Test both.

### Phase 5 — AI: redact prompts, make opt-in (#56, breaking)
- **Goal:** no data goes to a third-party model unless the user asks for it. What is sent passes through redaction.
- **Deliverables:**
  - `enableAIRecommendations` defaults to `false`. A key in the environment alone no longer turns on AI.
  - Build one `createRedactor(env)` instance. Apply it in `callAI` (`ai-analyzer.ts` about line 385), which covers all three prompts and every provider.
  - Python `converter.py:126` follows the new default.
  - README:833, README:1340 and README:543 match the behaviour. Remove the stale "env snapshot" claims there and in the comment at `smart-reporter.ts:467`.
- **Acceptance evidence:**
  - Unit test: with `MY_TOKEN=tokenvalue-12345678` and an error containing `api_key=abcd1234efgh tokenvalue-12345678`, the fetch body `messages[0].content` equals the expected text with `api_key=[REDACTED]` and `[REDACTED]`.
  - With only `OPENAI_API_KEY` set and no option: the mock server receives 0 requests.
- **Traps:**
  - The redactor does not mask PII, page text or typed values. That is why opt-in is the main fix. Do not claim redaction covers them.
  - Env-name matching masks URLs too: `NEXTAUTH_URL` turns `http://localhost:3000` into `[REDACTED]`. Record this in the README. Do not redesign the redactor in this phase.
  - The `aiPrompt` text embedded in the HTML for "Copy AI prompt" is not covered here. Phase 29 covers it.

### Phase 6 — Tag fallback and suite path (#63)
- **Goal:** emails are not read as tags. `suites` has the same shape for named and unnamed projects.
- **Deliverables:**
  - Tag fallback at `smart-reporter.ts:293`: use `matchAll` with the capture group `(?:^|\s)(@[\w-]+)`.
  - The fallback is needed only before Playwright 1.42.
  - At `smart-reporter.ts:303`, drop the first element only when the project name is non-empty. Unnamed projects then get `[file, ...describes]`, the same as named projects.
- **Acceptance evidence (acceptance harness):**
  - Title `login as user@example.com @smoke`: `tags` equals `['@example.com','@smoke']`. `@example.com` comes from Playwright's own `test.tags`.
  - Unnamed project with describe `A`: `suites` equals `['<file>','A']`.
- **Trap:** do not adopt the issue's `describePath()` change. It changes `suite` for every named-project user, and the UI depends on the file coming first (`ui/app/data.ts:25`).

### Phase 7 — JUnit correctness and identity (#55, breaking)
- **Goal:** the JUnit output agrees with Playwright's exit code, and every testcase is unique.
- **Deliverables:**
  - A failure means `isFailedTest`. An unexpected pass gets `<failure message="Expected to fail, but passed">`.
  - `<flakyFailure>` is built from `attempts` for flaky tests.
  - `name` and `classname` follow Playwright's built-in JUnit reporter (titles joined with ` › `, classname from the file). The project goes into the testsuite grouping.
- **Acceptance evidence:**
  - Unexpected pass: `failures="1"` and one `<failure>`.
  - 2 projects × 2 describe blocks with the same title: 4 distinct `(classname, name)` pairs.
  - A golden fixture run compares the output with Playwright 1.57's own `junit` reporter on the same suite.
- **Tests to update on purpose:** `junit-exporter.test.ts:252-310`, `:329-336`, `:416`.
- **Trap:** whether CI tools read `<flakyFailure>` is unverified. Emit it as additional information only, never as a failure.

### Phase 8 — Comparison baseline from one run (#50, #59)
- **Goal:** the fixed and new-failure lists compare against one baseline run.
- **Deliverables:**
  - The baseline is the run returned by `getBaselineRun()` (`smart-reporter.ts:630-648`).
  - Tests that did not run in that baseline go into a new `notInBaseline` bucket in `report-data/comparison.ts` and `schema.ts` `ComparisonKey`.
  - `SCHEMA_VERSION` goes from 3 to 4.
  - Replace `this.results.find` in the loop with a `Map` (#59).
  - Default for the gate (assumed, fail-safe): `noNewFailures` still counts a failing test from `notInBaseline` as a new failure. This keeps PR smoke runs against a nightly baseline from passing silently.
- **Acceptance evidence (acceptance harness):**
  - Run A: full, `other` fails. Run B: `--grep @smoke`. Run C: full, all pass.
  - Assert C's `fixedTests` equals `[]` and `notInBaseline` contains `other`.
  - Today `fixedTests` contains `other`.
- **Trap:** `buildComparison` currently labels every test that is missing from the baseline as "new" (`comparison.ts:23-26`). A test with history that is missing from the baseline is not new.

## Release B — non-breaking fixes (in 4.0.0)

### Phase 9 — First-failure notification (#54)
- **Deliverables:**
  - Fire only when `result.retry >= test.retries` and the final status is failed or timedOut.
  - Send a first-failure message for the test. Do not send a 1-test run summary (`smart-reporter.ts:512-528`).
- **Acceptance evidence:** with `retries:2` and `fetch` stubbed:
  - 0 calls at retry 0.
  - 1 call when retry 2 fails.
  - The body contains the test title and does not match `/total=1/`.
- **Trap:** while the code is open, check the duplicate send when both `slackWebhook` and `notifications` are set. Fix it only if it is in the same code path.

### Phase 10 — Complete ANSI stripping (#65)
- **Deliverables:**
  - Use the ansi-regex v6 pattern in `sanitizers.ts:75`. It covers CSI with any final byte, and OSC ended by BEL or ST.
  - `prompt-builder.ts:25` imports it instead of keeping its own copy.
- **Acceptance evidence:**
  - `stripAnsiCodes('\x1b[2Kerr\x1b]8;;https://x\x07link\x1b]8;;\x07') === 'errlink'`.
  - The ST-terminated variant also passes.
  - A prompt-builder case asserts `Error: errlink`.
- **Trap:** do not use Playwright's internal regex. It is not public API and does not handle ST.

### Phase 11 — Retry label, dead threshold code (#64)
- **Deliverables:**
  - `retry-analyzer.ts:80`: the label reads `Passed on attempt 2 of 2`.
  - Delete `calculateSmartThreshold` and its tests (`performance-analyzer.test.ts:237-258`).
- **Acceptance evidence:** with `retry=1`, status passed, `getRetrySummary` returns exactly `'Passed on attempt 2 of 2'`.
- **Trap:** `retry-analyzer.test.ts:141` pins the wrong label. Correct that expectation on purpose; do not delete the test.

### Phase 12 — Shared stats helpers, clean duration baseline (#52, #69 part 1)
- **Deliverables:**
  - Move `median`, `mad`, `recency`, `clamp01` and the flip rate from `flake-forecast.ts:260-285` into `src/utils/stats.ts`.
  - The baseline in `performance-analyzer.ts:31-39` uses passed, non-skipped entries only, and takes the median.
- **Acceptance evidence:**
  - History `[2000 pass, 2000 pass, 30000 fail]`, current 5000: baseline 2000, trend `↑ 150% slower`.
  - `[2000×3, 30000 pass]`: the median still shows the slowdown.
- **Trap:** the test helper `createHistoryEntry` hardcodes `passed: true` (`performance-analyzer.test.ts:19`). Make it take a parameter first.

### Phase 13 — Flakiness that measures instability (#51)
- **Goal:** fixed tests do not show as flaky. Tests that flaked in this run do not show as stable.
- **Deliverables:**
  - Include the current run in the series (`smart-reporter.ts:483` runs before `:909`).
  - Classify flaky, failing and stable by flip rate plus passes after retry, using the Phase 12 helpers.
  - Add the sample size `n`. Show it in Insights, quarantine, JSON and the digest.
  - Keep `flakinessScore` and the clamp that keeps 1.0 for always-failing tests.
- **Acceptance evidence:**
  - `[F×5, P×5]`: indicator exactly `'🟢 Stable'`. Today it is `'🔴 Flaky'`.
  - Current run `{outcome:'flaky', retry:1}` with 9 passes before it: exactly `'🔴 Flaky'`.
  - A fixed test is not a quarantine candidate.
- **Traps:**
  - Many consumers depend on the 1.0 encoding: `isConsistentlyFailingScore`, `getStatus`, the Insights filter, stability `(1-score)`, the AI text, and the `bin/gate.ts` sort. Do not turn the score into a flip rate.
  - The existing "1 failure in 10 runs" test is titled "stable" but asserts Unstable. Decide the intended result and give the test a matching title.

### Phase 14 — History write merges by runId (#58), folded into Phase 19

Phase 19 ships in the same release, so it takes over this phase's acceptance evidence. The stopgap is not built.
Pruning orphan `history-runs/` snapshots stays in scope and moves to Phase 19.

### Phase 15 — One merge implementation (#57)
- **Deliverables:**
  - Move the merge logic from `src/bin/merge-history.ts`, which runs `main()` on import, into a shared module.
  - The exported `mergeHistories()` (`smart-reporter.ts:1002-1076`) and `src/merge-history.ts` delegate to it. The signature stays the same.
  - Accept `-n` in the bin as an alias of `--max-runs`.
- **Acceptance evidence (real tmp files, no fs mock):**
  - Merging the two shards gives `tests.a.length === 3` (today 5), and the `run-3` summary has `total === 2` (today 1).
  - Merging the same file twice gives the same counts as merging it once.
- **Trap:** `smart-reporter.test.ts:8-235` mocks fs and asserts the old behaviour. Replace those tests with real-file tests; do not loosen them.

### Phase 16 — Keep failed-attempt evidence (#53)
- **Deliverables:**
  - `AttemptData` gets optional `attachments`, `tracePath` and `error` (`types.ts:296`).
  - Non-final attempts keep their screenshots, traces and videos (`smart-reporter.ts:491-498`).
  - Traces are copied per attempt (`-attempt-<n>-trace-<i>.zip`).
  - The Attempts section in `Detail.tsx` shows the evidence.
  - Remove the orphan `cspSafe` screenshots.
- **Acceptance evidence:**
  - A fixture with `retries:1` attaches a screenshot to attempt 0, which fails, and the retry passes. `attempts[0].attachments.screenshots.length === 1`.
  - No unreferenced files remain in the output directory.
- **Trap:** report size grows. Measure it on the example suite and record the growth in the PR. Keep only screenshots, traces and videos for non-final attempts.

### Phase 17 — serve process handling on every OS (#60, #61)
- **Deliverables:**
  - `browserCommand(platform, url)`: on win32, `spawn('cmd', ['/c','start','""',url])`. Elsewhere, `open` or `xdg-open`. No shell.
  - `killTree(child)`: on win32, `taskkill /pid <pid> /T /F`. Elsewhere, `process.kill(-pid)`. It is used by `DELETE /run`.
  - `SIGINT` and `SIGTERM` handlers kill the tree, then exit.
  - On win32, `detached` is false and `windowsHide` is true.
  - A `windows-latest` job in `demo.yml` runs `serve.test.ts` only.
- **Acceptance evidence:**
  - A pure unit test pins `browserCommand('win32', url)` to the exact argv.
  - The run command spawns a worker that writes its pid to a file. After SIGINT to `serve`'s process group, `process.kill(pid, 0)` throws ESRCH. This goes red on macOS and Linux today.
  - The same worker-pid assertion after `DELETE /run` passes on `windows-latest`.
- **Traps:**
  - The existing cancel test (`serve.test.ts:89`) spawns no grandchild, so it cannot catch this bug. Add the grandchild.
  - Adjacent, not in scope: `view-trace.ts:62` spawns `npx.cmd` without a shell. Newer Node on Windows rejects that with EINVAL. Unverified; list it for Gary.

### Phase 18 — SSE line integrity (#62)
- **Deliverables:**
  - Keep a pending-bytes buffer with `node:string_decoder`, and emit only complete lines (`sse-handler.ts:42-51`).
  - Advance `lastOffset` even when no client is connected.
  - Do not reset to 0 on a `rename` event while the file still exists.
- **Acceptance evidence (extend `serve-sse.test.ts`):**
  - Half a line, then a wait of more than 500 ms: 0 events. The rest of the line: exactly 1 event, equal to the full line.
  - An `é` split across two writes: 1 event containing `café`.
  - 2 lines with no client, then the client connects: exactly 2 events. Today 4.
- **Trap:** the `rename` reset is what triples deliveries during write bursts on macOS. Test it with a burst, not only with spaced writes.

## Release C — enhancements (in 4.0.0)

### Phase 19 — Per-run history files and a rebuilt index (#67, #58)

**Design (settled 2026-10-16)**
- **Run files:**
  - Location: `<history base>.runs/<runId>.json` beside the history file, for example `test-history.runs/run-123.json`.
  - Sharded runs: `<runId>.shard-<i>-of-<n>.json`, from `config.shard`.
  - The name is distinct from the drilldown `history-runs/`. It follows the `{project}` and `projectName` isolation automatically.
- **Run file content:** `{ version: 1, summary: RunSummary, tests: Record<testId, TestHistoryEntry>, forecasts?: Record<testId, number> }`.
  - Each file is written once, with tmp + rename.
  - If the same runId and shard run again, the new file replaces the old one, so a CI re-run replaces the earlier attempt (#58.2).
- **Index:**
  - `test-history.json` keeps the `TestHistory` shape, and it stays complete on its own.
  - So README cache recipes that save only that file keep working.
  - `HealthDigest.analyze`, the merge bin and external readers are unchanged.
- **Write:**
  1. Take the lock `<history>.lock` (`open 'wx'`). Retry with backoff for up to 10 s. A lock older than 30 s is stale and is taken over.
  2. Re-read the index and every run file.
  3. Rebuild: the index runs whose runId has no run file, plus every run file. Use the shared merge from Phase 15, which combines shard files that share a runId.
  4. Trim to `maxHistoryRuns`.
  5. Write the index with tmp + rename.
  6. Prune run files outside the window.
- **Load:** read the index, plus any run file that the index does not have yet (for example one copied in from another shard or machine). Copying run files into one folder is a merge.
- **Merge bin:** it also reads `<input>.runs/` beside each input file.
- **Retention:** `maxHistoryRuns` stays the only setting (default 10).
- **Excluded:**
  - Compaction of older runs into aggregates.
  - Pluggable backends. SQLite needs a native dependency. S3 and Azure Blob need credentials and network.
  - Revisit both when users need windows of more than 100 runs.
- **Limit (README):** the reporter cannot merge two CI caches saved by different jobs. Upload `test-history.runs/` as an artifact and copy the run files together, or use `merge-history`.

**Depends on:** 3 (the summary builder), 15 (the shared merge). Build them in the same agent.

**Deliverables**
- The run file writer, the locked index rebuild, load-time pickup of new run files, and pruning.
- The merge bin reads run folders.
- README sections on history, sharding and caching.
- A CHANGELOG note on the new `test-history.runs/` folder.

**Acceptance evidence**
- Two collectors on one directory: both load, then A writes, then B writes. `summaries` contains `['run-A','run-B']`. Today only `['run-B']` survives.
- Two sequential runs with the same `runId`: `summaries.length === 1`.
- Two shard run files with one runId: one summary with `total` equal to the sum of the shards.
- Round trip: deleting the index and running once rebuilds it from the run files to an equal `TestHistory`.
- A held lock older than 30 s is taken over. A fresh one is waited on.

**Traps**
- Existing CI steps for merge-history users must keep working.
- A lock left behind by a crashed run must never block runs forever.

### Phase 20 — Persist CI info per run (#73 part 1)
- **Deliverables:**
  - The `RunSummary` builder from Phase 3 writes `ciInfo`.
  - `CIInfo` gains the full sha, repo URL, PR number and target branch (`GITHUB_BASE_REF` and the equivalents for other CI systems).
  - The JSON export includes `ci`.
- **Acceptance evidence:**
  - With GitHub env vars set, `summaries[0].ciInfo` equals the expected object.
  - JSON `metadata.ci` is present.
- **Traps:**
  - On `pull_request` events, `GITHUB_SHA` is the merge commit. Record the PR head sha from the event payload when it is available.
  - `commit` is truncated to 8 characters today (`ci-detector.ts:14`). Keep the short form for display only.

### Phase 21 — Branch-aware baselines, opt-in (#78)
- **Depends on:** 8, 20. Ideally 19.
- **Deliverables:**
  - `baseline: { branch: 'target' | '<name>' }`.
  - Baseline selection filtered by `ciInfo.branch`. Flakiness and performance history are optionally filtered the same way.
  - The baseline branch and commit appear in the Compare header and the PR comment.
- **Acceptance evidence:** history with main runs and PR runs mixed together, `baseline.branch:'main'`: the baseline `runId` is the latest main run.
- **Traps:**
  - The default stays as it is (compatibility contract).
  - PR runs can push main's runs out of the 10-run window. The README must document the cache-key recipe.

### Phase 22 — Fingerprint clustering (#68)
- **Depends on:** 10.
- **Deliverables:**
  - The fingerprint uses error type, masked message, top in-project frame and locator.
  - Mask digits, UUIDs, hex ids, quoted values and URLs.
  - Generate a readable label.
  - Ids use a stronger hash, because they will be stored.
  - Add an optional `clusterKey` hook. It is new; check it against the deferred extensibility non-goal and record the decision. Decision: not built (see TLDR).
- **Acceptance evidence:**
  - Two timeouts on different locators give 2 clusters.
  - The same assertion with different numbers gives 1 cluster.
  - The ids are stable across runs.

### Phase 23 — Cluster tracking across runs (#74)
- **Depends on:** 22, 8. 19 is needed for "Regressed".
- **Deliverables:**
  - `clusterId` on `TestHistoryEntry`.
  - New, Recurring and Regressed labels, a Resolved panel and a sparkline.
  - A `noNewClusters` gate rule.
  - An "only new clusters" notification condition.
  - Clusters in the JSON export.
- **Acceptance evidence:**
  - A cluster seen in run 1, gone in run 2 and back in run 3 is labelled Regressed in run 3.
  - `noNewClusters` fails only on a cluster never seen before.

### Phase 24 — First-failing commit and suspects (#73 part 2)
- **Depends on:** 20, 23.
- **Deliverables:**
  - Last-passed and first-failed commits for each new failure or cluster.
  - Optional changed-file suspects from local `git diff`, with a fallback when git is unavailable. The pattern is in `analyzers/ownership.ts`.
- **Acceptance evidence:** on a fixture history, a test that fails in run 3 shows the commit range from run 2 to run 3.
- **Trap:** on a shallow checkout, `git diff a..b` fails. Detect this and show the commit range without suspects. Do not error.

### Phase 25 — Scoped gate rules and warn severity (#70 part 1)
- **Depends on:** 1, 3, 8.
- **Deliverables:**
  - `rules: [{ scope: { tag | project | file }, severity: 'fail' | 'warn', ...rule }]`. The flat config stays as shorthand.
  - Validate unknown keys and reject them loudly.
  - The CLI's `toTestResultData` carries `tags`, `project`, `owners` and `file`.
  - `quality-gate-reporter.ts:19` uses per-rule skip reasons.
  - Add a rule id, because duplicate names break `ruleLabels`.
- **Acceptance evidence:**
  - Scoped `minPassRate:100` on `@critical`, with one critical failure among many passes: `passed === false`.
  - A warn rule breach: `passed === true`, with the rule flagged.
  - `{ rules: [{ bogus: 1 }] }` throws.

### Phase 26 — New gate rules (#70 part 2)
- **Depends on:** 25, 2, 12.
- **Deliverables:**
  - `maxDurationRegression`, based on the median from Phase 12.
  - `noNewFlaky`, which needs the baseline `retry` carried through `comparison.ts`.
- **Acceptance evidence:** a fixture where the median duration rises 30% against `maxDurationRegression:20` fails the gate.

### Phase 27 — Confidence and minimum samples (#69 part 2)
- **Depends on:** 12, 13.
- **Deliverables:**
  - Wilson intervals on flakiness.
  - An explicit "insufficient history" state below a minimum number of runs, for flakiness and performance.
- **Acceptance evidence:**
  - `wilson(1,3)` is about `[0.06,0.79]`, and `wilson(30,90)` is about `[0.25,0.43]`.
  - 3 history runs: indicator `insufficient history`.
- **Trap:** existing tests with 2–4 history entries will start reporting insufficient history. Make their fixtures longer; do not lower the minimum.

### Phase 28 — Step-level duration trends (#69 part 3)
- **Depends on:** 12.
- **Deliverables:** median-based trends per step from the stored `stepDurations`, shown in Detail.
- **Acceptance evidence:** `login` at `[100×5]`, current 310: shows "3.1× slower".

### Phase 29 — Opt-in artifact redaction (#71)
- **Depends on:** 5.
- **Deliverables:**
  - `redact: true | { patterns }`. `createRedactor` takes `patterns`.
  - Apply `.string()` to a fixed list of fields in `onTestEnd`:
    - error, snippet, stdout, steps, timeline;
    - `aiPrompt`, the URLs in `networkLogs`;
    - the live JSONL error line.
- **Acceptance evidence:**
  - Acceptance run with `MY_API_TOKEN` set and `redact:true`: the value appears in none of the HTML data, JUnit, CTRF, `history-runs/*.json` or `aiPrompt`, and `[REDACTED]` appears in each.
  - A control string that is not secret survives.
- **Traps:**
  - Do not use `.deep()`. It blanks any value under a key like `session`.
  - The README must say that trace zips, screenshots and base64 attachments are not redacted.

### Phase 30 — Execution metadata capture (feeds #75, #76)
- **Deliverables:**
  - Store `workerIndex`, `parallelIndex` and `startTime` per result.
  - Read `config.shard`.
  - Add retry waste (time spent on failed attempts) to history entries.
- **Acceptance evidence:** a 2-worker fixture run: every result has `workerIndex` in {0,1}, and the retry waste equals the sum of the failed attempts' durations.
- **Trap:** what survives `merge-reports` and `merge-history` for shard and worker data is unverified. Prove it with a real merge run before Phases 31 and 32 depend on it.

### Phase 31 — CI efficiency panel (#76)
- **Depends on:** 30, 2.
- **Deliverables:**
  - Retry waste for the run and as a trend.
  - Long-tail share.
  - Worker balance and idle time.
  - Shard wall time.
  - The setup gap, estimated from `onBegin` to the first test start.
  - An optional cost-per-minute estimate.
  - JSON fields for all of the above.
- **Acceptance evidence:** on a synthetic run with known durations, every metric equals a value computed by hand.

### Phase 32 — Environment matrix (#75)
- **Depends on:** 30, 6.
- **Deliverables:**
  - A matrix view of project × browser, plus shard and worker for unmerged runs.
  - An insight for failures that occur in one cell only.
  - Group-by options for shard and worker.
- **Acceptance evidence:** a fixture where a test fails on firefox only produces the insight "firefox only".

### Phase 33 — Attempt comparison: steps (#72 part 1)
- **Depends on:** 16, 11.
- **Deliverables:**
  - `StepData` gets depth and parent.
  - Align steps by title path, not by array index.
  - A one-line divergence summary.
  - Attempts in the failure bundle (`failure-bundle.ts:66`) and in the AI prompt.
- **Acceptance evidence:** a step inserted in the passing attempt does not shift the diff. Only the inserted step is marked.

### Phase 34 — Attempt comparison: network and console (#72 part 2)
- **Depends on:** 33.
- **Deliverables:**
  - A network and console diff when both attempts have traces.
  - Otherwise the reason it is unavailable, naming the trace config.
- **Acceptance evidence:** with `trace:'on'`, a request that returns 500 only in the failing attempt is listed. With `retain-on-failure`, the panel names the missing trace.

### Phase 35 — Quarantine lifecycle (#77)
- **Depends on:** 13.
- **Deliverables:**
  - Entry metadata: owner, ticket, reason, expiry and source.
  - A manual quarantine file plus an `@quarantine(ticket)` annotation.
  - Keep `quarantinedAt` stable instead of rewriting it every run (`quarantine-generator.ts:18,36`).
  - Clear the file when nothing qualifies.
  - An expiry report and an expiry gate rule.
  - Owner routing for quarantine events.
- **Acceptance evidence:**
  - An expired entry fails the expiry rule.
  - `quarantinedAt` stays the same across two runs.
  - A test that is not run in the next run keeps its entry.
- **Trap:** tests that are not run produce no results today, so entries flap. Keep entries for tests that are absent from the run.

### Phase 36 — Metrics file export (#79 part 1)
- **Depends on:** 3, 2, 30.
- **Deliverables:**
  - Prometheus text format and OTLP JSON files.
  - Labels for project, branch and suite.
  - An optional push to an endpoint (opt-in network, the same class as the notifiers).
  - No new dependency.
- **Acceptance evidence:** a golden-file comparison of the Prometheus output for a fixture run. The push is tested against a local mock server.

### Phase 37 — GitHub issue per new cluster (#79 part 2)
- **Depends on:** 23, 24, 5.
- **Deliverables:**
  - An opt-in `gh`-based subcommand that creates or updates one issue per new cluster, with a marker. It reuses the pattern from `pr-comment.ts:60`.
  - The issue body uses the redacted error.
- **Acceptance evidence:**
  - Against a stubbed `gh`: the first run calls `issue create`, and a later run for the same cluster calls `issue comment`.
  - No call is made unless the option is set.

---

## Cross-cutting risks
- Phases 3, 4, 8 and 13 change numbers users already watch. Each CHANGELOG entry states the old value and the new value for an example run.
- `test:ui` screenshot baselines: Phases 3, 13, 16, 22, 23 and 31–35 touch the UI. Regenerate baselines only in Docker. List every intended baseline change in the PR.
- Python parity drift: no automated test exists. Each phase that adds an option updates `converter.py` and its tests by hand.
- Scope creep into the deferred extensibility API: the `clusterKey` hook (Phase 22) was the only proposed hook, and it was not built. Any hook needs a decision.

## Corrections for the issue thread (for Gary to post; not posted)
- **#47:** the suggested float compare fails at exact boundaries. The fix uses integer cross-multiplication.
- **#48:** the PDF uses the notifier's definition. `calculateSuiteStats` has no production caller. `builder.summarize` is also a source.
- **#56:** the real prompt path is `aiPrompt` from `prompt-builder.ts`. The provider is already logged once per run. There is no env snapshot.
- **#57:** the bin also drops `runFiles` and `forecasts`, and this is documented.
- **#60:** the flag is `--no-open`. Opening is the default.
- **#62:** late clients receive duplicate events, not a missing `start`.
- **#63:** the suggested regex with `.match` keeps the leading whitespace. Named projects include the file in `suites`.
- **#65:** a second copy of the regex lives in `prompt-builder.ts`.
- **#69:** the Detail view already shows the sample size.
- **#72:** the step-level attempt compare already ships in Detail › Attempts.

## Open items
- Phase 17's Windows evidence comes from the new `windows-latest` job. It cannot be proven locally.
- npm publish of 4.0.0 needs Gary (npm login and 2FA).
- Adjacent findings, not planned. Each needs a decision:
  - The README says quarantined tests "can be excluded from gate failures", but no code does this.
  - `exportJson` fails with ENOENT when the output directory is missing.
  - `ai-analyzer.ts:230` sends an empty prompt when `aiPrompt === ''` (not reproduced).
  - `view-trace.ts:62` spawns `npx.cmd` without a shell on Windows.
