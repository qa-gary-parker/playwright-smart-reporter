import { describe, it, expect } from 'vitest';
import { renderSummary } from './summary';
import type { JsonExportData } from '../generators/json-exporter';
import type { RunSummary, TestResultData } from '../types';

const WORKSPACE = '/home/runner/work/shop/shop';
const ROOT = `${WORKSPACE}/e2e/tests`;

const run: RunSummary = { runId: 'r', timestamp: '2026-10-08T10:00:00.000Z', total: 6, passed: 3, failed: 2, skipped: 1, flaky: 1, slow: 0, duration: 83_400, passRate: 50 };
const timedOut = { testId: 'b', title: 'totals | tax', file: 'cart.spec.ts', status: 'timedOut', duration: 30_000, retry: 1, steps: [], history: [] } as TestResultData;

const data: JsonExportData = {
  metadata: { generatedAt: '2026-10-08T10:00:00.000Z', reporterVersion: '3.0.0', rootDir: ROOT },
  summary: { total: 6, passed: 3, failed: 2, skipped: 1, flaky: 1, duration: 83_400, passRate: 50 },
  tests: [
    {
      testId: 'a', title: 'checkout @smoke', project: 'Desktop Chrome', file: 'cart.spec.ts', line: 4, column: 5,
      status: 'failed', outcome: 'unexpected', retry: 1, duration: 4200,
      error: `Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1\n    at ${ROOT}/cart.spec.ts:6:17`,
      errorLocation: { file: 'cart.spec.ts', line: 6, column: 17 },
    },
    {
      testId: 'b', title: 'totals | tax', file: 'cart.spec.ts', line: 27, column: 5,
      status: 'timedOut', outcome: 'unexpected', retry: 1, duration: 30_000, error: 'Test timeout of 30000ms exceeded.',
    },
    { testId: 'c', title: 'login', file: 'auth.spec.ts', status: 'passed', outcome: 'flaky', retry: 1, duration: 1500 },
    { testId: 'd', title: 'renders `price`', file: 'cart.spec.ts', status: 'passed', outcome: 'expected', retry: 0, duration: 800 },
    { testId: 'e', title: 'known bug', file: 'cart.spec.ts', status: 'failed', outcome: 'expected', retry: 0, duration: 300 },
    { testId: 'f', title: 'later', file: 'cart.spec.ts', status: 'skipped', outcome: 'skipped', retry: 0, duration: 0 },
  ],
  comparison: {
    baselineRun: run,
    currentRun: run,
    changes: { newFailures: [timedOut], fixedTests: [], newTests: [], regressions: [], improvements: [], notInBaseline: [], newFlaky: [] },
  },
  qualityGates: {
    passed: false,
    rules: [
      { rule: 'maxFailures', passed: false, actual: '2', threshold: '≤ 0' },
      { rule: 'minPassRate', passed: true, actual: '50%', threshold: '≥ 40%' },
      { rule: 'noNewFailures', passed: true, actual: 'N/A', threshold: '≤ 0', skipped: true },
    ],
  },
};

describe('renderSummary', () => {
  it('renders pass rate, gates, failures (new first), flaky, slowest and the report link', () => {
    expect(renderSummary(data, { reportUrl: 'https://example.test/runs/1#artifacts', workspace: WORKSPACE })).toBe(`## Playwright Smart Reporter

**Failed:** 2 of 6 tests failed.

| Pass rate | Passed | Failed | Flaky | Skipped | Duration |
|---|---|---|---|---|---|
| 50% | 3 | 2 | 1 | 1 | 1.4m |

**Quality gates: failed** (1 of 2 rules breached)

| Rule | Actual | Threshold | Result |
|---|---|---|---|
| Max failures | 2 | ≤ 0 | Failed |
| Min pass rate | 50% | ≥ 40% | Passed |
| No new failures | N/A | ≤ 0 | Skipped |

### Failures (2, 1 new)

| Test | Location |
|---|---|
| **New** \`totals \\| tax\` | \`e2e/tests/cart.spec.ts:27\` |
| \`checkout @smoke [Desktop Chrome]\` | \`e2e/tests/cart.spec.ts:6\` |

### Flaky tests (1)

| Test | Passed on retry |
|---|---|
| \`login\` | 1 |

### Slowest tests

| Test | Duration |
|---|---|
| \`totals \\| tax\` | 30.0s |
| \`checkout @smoke [Desktop Chrome]\` | 4.2s |
| \`login\` | 1.5s |
| \`\` renders \`price\` \`\` | 800ms |
| \`known bug\` | 300ms |

[Open the full report](https://example.test/runs/1#artifacts)
`);
  });

  it('names a rule by its id or scope, and shows a breached warn rule as a warning, not a failure', () => {
    const qualityGates = {
      passed: true,
      rules: [
        { rule: 'minPassRate', passed: true, actual: '100%', threshold: '≥ 100%', id: 'critical paths' },
        { rule: 'maxFlakyRate', passed: false, actual: '50%', threshold: '≤ 2%', scope: 'project chromium', severity: 'warn' as const },
        { rule: 'maxFailures', passed: true, actual: 'N/A', threshold: '≤ 0', skipped: true, skipReason: 'no test in scope', scope: 'tag @x' },
      ],
    };
    const lines = renderSummary({ ...data, qualityGates }, { workspace: WORKSPACE }).split('\n');
    const at = lines.findIndex((l) => l.startsWith('**Quality gates'));
    expect(lines.slice(at, at + 7)).toEqual([
      '**Quality gates: passed with 1 warning** (1 of 2 rules passed)',
      '',
      '| Rule | Actual | Threshold | Result |',
      '|---|---|---|---|',
      '| critical paths | 100% | ≥ 100% | Passed |',
      '| Max flaky rate (project chromium) | 50% | ≤ 2% | Warning |',
      '| Max failures (tag @x) | N/A | ≤ 0 | Skipped |',
    ]);
  });

  it('renders a passing run without gate, failure or flaky sections or a link', () => {
    const passing: JsonExportData = {
      metadata: { generatedAt: '2026-10-08T10:00:00.000Z', reporterVersion: '3.0.0' },
      summary: { total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, duration: 950, passRate: 100 },
      tests: [{ testId: 'a', title: 'home', file: 'home.spec.ts', status: 'passed', outcome: 'expected', retry: 0, duration: 950 }],
    };
    expect(renderSummary(passing, { workspace: WORKSPACE })).toBe(`## Playwright Smart Reporter

**Passed:** 1 of 1 tests passed.

| Pass rate | Passed | Failed | Flaky | Skipped | Duration |
|---|---|---|---|---|---|
| 100% | 1 | 0 | 0 | 0 | 950ms |

### Slowest tests

| Test | Duration |
|---|---|
| \`home\` | 950ms |
`);
  });

  it('lists every failure without a "new" split when there is no baseline run', () => {
    const { comparison: _c, ...noBaseline } = data;
    const out = renderSummary(noBaseline, { workspace: WORKSPACE });
    expect(out).toContain(`### Failures (2)

| Test | Location |
|---|---|
| \`checkout @smoke [Desktop Chrome]\` | \`e2e/tests/cart.spec.ts:6\` |
| \`totals \\| tax\` | \`e2e/tests/cart.spec.ts:27\` |
`);
  });

  it('marks a failure that did not run in the baseline run and counts it in the heading', () => {
    const checkout = { testId: 'a', title: 'checkout @smoke', file: 'cart.spec.ts', status: 'failed', duration: 4200, retry: 1, steps: [], history: [] } as TestResultData;
    const comparison = { ...data.comparison!, changes: { ...data.comparison!.changes, notInBaseline: [checkout] } };
    const out = renderSummary({ ...data, comparison }, { workspace: WORKSPACE });
    expect(out).toContain(`### Failures (2, 1 new, 1 not in baseline)

| Test | Location |
|---|---|
| **New** \`totals \\| tax\` | \`e2e/tests/cart.spec.ts:27\` |
| **Not in baseline** \`checkout @smoke [Desktop Chrome]\` | \`e2e/tests/cart.spec.ts:6\` |
`);
  });

  it('names the branch and commit of the baseline run under the totals', () => {
    const baselineRun = { ...run, ciInfo: { provider: 'github', branch: 'main', commit: 'abc12345' } };
    const out = renderSummary({ ...data, comparison: { ...data.comparison!, baselineRun } }, { workspace: WORKSPACE });
    expect(out).toContain(`| 50% | 3 | 2 | 1 | 1 | 1.4m |

**Baseline run:** \`main\` @ \`abc12345\`

**Quality gates: failed**`);
  });

  it('shows the pass rate as n/a when every test was skipped', () => {
    const skipped = data.tests.filter((t) => t.status === 'skipped');
    const summary = { total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0, duration: 0, passRate: null };
    const out = renderSummary({ ...data, tests: skipped, summary, comparison: undefined, qualityGates: undefined }, { workspace: WORKSPACE });
    expect(out).toContain('| n/a | 0 | 0 | 0 | 1 | 0ms |');
  });

  it('headlines a run where nothing passed or failed by what happened, not as passed', () => {
    const headline = (tests: JsonExportData['tests'], summary: JsonExportData['summary']) =>
      renderSummary({ ...data, tests, summary, comparison: undefined, qualityGates: undefined }, { workspace: WORKSPACE }).split('\n')[2];
    const skipped = data.tests.filter((t) => t.status === 'skipped');
    expect(headline(skipped, { total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0, duration: 0, passRate: null })).toBe('**Skipped:** all 1 tests were skipped.');
    expect(headline([], { total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, duration: 0, passRate: 0 })).toBe('**No tests ran.**');
  });
});
