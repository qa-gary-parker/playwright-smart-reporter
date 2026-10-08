## Causal failure timeline

Every failed test gets one time axis that lines up its steps, network requests and console output. Smart Reporter also suggests the **possible first anomaly**: the earliest unusual event before the failure.

The first anomaly is a heuristic suggestion. It is not a diagnosis. It points you at where to look first.

### What counts as an anomaly

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

### Where it appears

- Report data: `tests[].timeline` (schema in `src/types.ts`, `CausalTimeline`). All times are milliseconds from the start of the failed attempt.
- JSON export (`exportJson: true`): `tests[].timeline`.
- AI analysis and **Copy AI prompt**: a `# Possible first anomaly (heuristic)` section after the error details.

### Requirements

- **Network and console lanes** need a trace for the failed attempt, for example `trace: 'retain-on-failure'`. Without a trace, the timeline has steps only.
- **Slow-step detection** needs history. Each run stores `test.step` durations in the history file (`stepDurations`). Only passing runs count.
- Console events need the trace's clock anchor (`monotonicTime` in `context-options`). A trace without it keeps its network timing and drops console events, so nothing is placed at the wrong time. Verified with Playwright 1.57.

### Option

```ts
['playwright-smart-reporter', {
  enableCausalTimeline: true, // default; false turns off the timeline, the prompt section and step-duration history
}]
```

### Limits

- Each lane keeps at most 1,000 entries (earliest first). Console text is cut at 500 characters.
- The network log (`networkLogs`) is unchanged and still reads the first browser context only. The timeline reads every context in the trace.
