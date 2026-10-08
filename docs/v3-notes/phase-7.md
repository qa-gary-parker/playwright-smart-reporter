### Flake Forecasting

Lists tests that passed this run but whose history is trending unstable, before they fail. On by default. Forecasts are advisory: they never quarantine a test or fail a quality gate.

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
