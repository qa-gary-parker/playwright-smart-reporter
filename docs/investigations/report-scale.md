# Report generation at scale

**TLDR**
- v3 writes report data per test, so no single string grows with the suite. 2.x failed at 14,000 tests with `RangeError: Invalid string length` (issue #19); v3 completes.
- At 10,000 tests v3 produces 70 MB of data (2.x: 401 MB of HTML) and peaks at 412 MB of memory (2.x: 1,116 MB).
- `assetMode: 'auto'` moves data to `<name>-data.js` above 32 MB. Below that, a report stays a single file.

## Method

- Synthetic suite, same for both versions: 20 steps and 10 history entries per test; 10% of tests fail with a 30-line stack, 2 retries, and one 48 KB base64 screenshot.
- v3: `node benchmark/report-scale.mjs <tests>` (built `dist/`, real builder and writer).
- 2.x: the same results through `generateHtml` at 1939e77 (v2.2.0).
- macOS, Node 24, 2026-10-08. Peak memory is process RSS.

## Results

| Tests | v3 time | v3 peak RSS | v3 data | v3 mode | 2.x time | 2.x peak RSS | 2.x HTML |
|---|---|---|---|---|---|---|---|
| 1,000 | 24 ms | 94 MB | 7.0 MB | inline | 69 ms | 196 MB | 40.8 MB |
| 5,000 | 82 ms | 223 MB | 35.1 MB | external | 267 ms | 636 MB | 201.1 MB |
| 10,000 | 176 ms | 412 MB | 70.2 MB | external | 523 ms | 1,116 MB | 401.4 MB |
| 14,000 | 215 ms | 478 MB | 98.2 MB | external | failed: `Invalid string length` | — | — |

2.x embedded each screenshot several times (test card, gallery, and the client test list), which is most of the difference in size.

## Threshold

- 32 MB keeps typical suites (up to about 4,500 tests with this failure profile) in one file that opens over `file://`.
- Above it, the browser loads data from a companion script instead of parsing one very large HTML document. Every run logs the mode and data size.
- The UI renders 10,000 rows through a virtual list; `src/ui/tests/app.spec.ts` asserts the window size, scroll frame time, and row content at the top, middle, and end.
