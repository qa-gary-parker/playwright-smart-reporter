### Code Coverage

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

**What is collected**

- Chromium: V8 JavaScript coverage for the `page` fixture, for the whole test, across navigations. Every attempt counts, retries included.
- Any browser: `window.__coverage__` counters from Istanbul-instrumented code (`babel-plugin-istanbul`, `vite-plugin-istanbul`). When present, they replace the V8 data for that test.
- Firefox and WebKit: V8 coverage is skipped with one warning per worker. The test never fails because of coverage.
- Only page scripts (`http`, `https`, `file`) are kept. Files under `node_modules` are left out.
- Pages opened outside the `page` fixture (`context.newPage()`) are not covered.

**Source maps**

- Inline maps, linked `.map` files and `sourcesContent` are resolved, so coverage is reported against your source files, not the bundle.
- The fixture fetches linked maps while the app is still running and stores them with the coverage. Reports built later, including `merge-reports` on another machine, need no access to the app.
- A map that cannot be loaded gives one warning, and that script is reported against its generated code.

**Sharding**

Coverage travels as a test attachment, so `npx playwright merge-reports` combines shards with no extra steps.

**Coverage gate**

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

**How lines are counted**

- Numbers match [c8](https://github.com/bcoe/c8) for the same code: every source line counts, and a line is covered when V8 ran the code around it.
- Some bundlers (esbuild among them) emit no source map entry for a closing `}`, so the last line of a function that never ran shows as covered. c8 reports the same.
- Percentages are floored to two decimals, like Istanbul.

**Where the data lives**

- Report data (`ReportData.coverage`): totals, per-file totals, per-line hit counts, and file source for line highlighting. Large reports move it to the external data file under `assetMode`.
- JSON export (`smart-report-data.json`): totals and per-file totals only.
- `test-results/`: the raw V8 data, source and source map for each test. Expect about 1.5 MB per test for a 22,000-line app.
