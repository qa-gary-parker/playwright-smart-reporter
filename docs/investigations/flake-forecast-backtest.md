# Flake Forecast Backtest

**Date:** 2026-10-08
**Scope:** roadmap Phase 7 acceptance item "backtest over the repo's own recorded history".
**Reproduce:** `npm run build && node scripts/backtest-forecast.mjs example`

## TL;DR

- 85% of resolved flags (17 of 20) were followed by a fail or a retry within 3 runs.
- 73% of failure onsets with enough history (11 of 15) were flagged in the green run before.
- 0 of 4 first-ever failures were flagged. None had a precursor in duration, retries, or outcomes.
- 0 of 6 tests that quarantine would catch were flagged first. Quarantine fires on 2-3 runs of history; the forecast needs 5.
- On this data the forecast warns about recurrence in tests that already flipped once. It did not predict a first failure.

## Data

- `example/test-history.json` (144 tests, up to 10 entries each) and 30 run snapshots in `example/history-runs/`. Both are local and gitignored.
- 1,574 test-runs after merging the two sources by run id. The history file wins where both hold the same run.
- The suites are demo suites: deliberately broken and random-failure tests, plus `comprehensive-demo.spec.ts` series that look generated.

## Method

- Replay each test run by run. At each run, the forecast sees the previous 10 runs plus the current one, as the reporter does with `maxHistoryRuns: 10`.
- A forecast is made only at first-try passes (1,193 runs).
- Flag: risk at or above 0.5 (default).
- Hit: a fail or a retry within the next 3 non-skipped runs. False alarm: 3 clean runs follow. Unresolved: fewer than 3 runs follow.
- Onset: a fail or retry straight after a first-try pass.
- Quarantine: the run where `FlakinessAnalyzer` plus `isFlakyScore(score, 0.3)` would first quarantine the test, as the reporter does.

## Results (minRuns 5, threshold 0.5)

| Measure | Value |
|---|---|
| Forecast candidates (first-try passes) | 1,193 |
| Insufficient history (never flagged) | 445 |
| Scored | 748 |
| Flags | 27 |
| Hits / false alarms / unresolved | 17 / 3 / 7 |
| Onsets with enough history | 15 |
| Onsets flagged the run before | 11 |
| First-ever onsets with enough history / flagged | 4 / 0 |
| Tests quarantine would catch / flagged before quarantine | 6 / 0 |

Flagged tests:

| Test | History | Flags | Top reason at first flag |
|---|---|---|---|
| `demo.spec.ts::flaky behavior - random failure` | `FF.FF...F..F..FFFFF.FrrF.Frr.r` | 10 | outcome-instability |
| `comprehensive-demo.spec.ts::real-time updates display` | `F...F..F..` | 4 | outcome-instability |
| `comprehensive-demo.spec.ts::search autocomplete suggestions` | `...F......` | 4 | outcome-instability |
| `[Mobile Chrome] demo.spec.ts::flaky behavior - random failure` | `.r.rrr..r.` | 3 | retry-trend |
| `comprehensive-demo.spec.ts::update user profile information` | `....FF.F..` | 3 | outcome-instability |
| `[Desktop Chrome] demo.spec.ts::flaky behavior - random failure` | `r..rr.rrF.` | 2 | retry-trend |
| `trace-demo.spec.ts::comprehensive trace test - search and interact` | `......F.F` | 1 | outcome-instability |

Key: `.` first-try pass, `r` pass after retry, `F` fail.

- All 3 false alarms are `search autocomplete suggestions`: one failure, then flagged for 3 runs with no recurrence.
- The 4 unflagged first-ever onsets are `demo.spec.ts::documentation link works`, `trace-demo ... search and interact`, and `parallel/test2.spec.ts::h2 should be visible` (both projects). Before the break each had only first-try passes, no retries, and flat or falling durations (one single 4.3s spike in the Mobile Chrome `h2` test). Three of the four then failed every later run, which reads as a deterministic break, not drift towards flakiness.

## Change made from this backtest

- The first run flagged `[Desktop Chrome] feature-demo.spec.ts::navigation links are present` (never failed) at risk 0.71 on duration variance.
- Cause: at 6 runs each half holds 3 durations, and one spike (4,673ms among ~650ms) moved the median absolute deviation.
- Fix: duration signals now need at least 4 runs in each half (8 runs). Pinned by a unit test using that exact series.
- Effect: flags 28 to 27, false alarms 4 to 3, hit rate of resolved flags 81% to 85%. No hit or flagged onset was lost.

## Sensitivity: minRuns 3

| Measure | minRuns 5 | minRuns 3 |
|---|---|---|
| Scored | 748 | 970 |
| Flags (hits / false alarms / unresolved) | 27 (17 / 3 / 7) | 32 (22 / 3 / 7) |
| Onsets with enough history / flagged | 15 / 11 | 21 / 15 |
| Flagged before quarantine | 0 of 6 | 1 of 6 (`demo.spec.ts::flaky behavior`, 1 run ahead) |

- The default stays at 5. The roadmap names scoring on thin history as the main trap. The gain at 3 is 1 test 1 run earlier.

## Limits

- Small sample: 15 scored onsets and 27 flags, from demo suites.
- No suite here drifts slowly towards flakiness, so `duration-drift` and `duration-variance` have no hits to show. Their behaviour is pinned by unit tests on synthetic series only.
- Re-run the script on real CI history before changing any weight or threshold.
