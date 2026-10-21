import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderSummary } from '../../src/github/summary';
import type { ReportData } from '../../src/report-data/schema';
import type { TestHistory } from '../../src/types';

// Runs run-data.fixtures.ts through the built reporter (dist/) and checks its counts against
// Playwright's JSON reporter on the same run. Needs `npm run build`; run with `npm run test:acceptance`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');
const FILE = 'run-data.fixtures.ts';
const TIMEOUT = 60_000;

let tmp: string;

function runSuite(out: string, options: object, args: string[] = [], env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options), ACCEPTANCE_MATCH: FILE, ...env },
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function reportData(out: string): ReportData {
  const html = fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8');
  const start = html.indexOf('window.__SMART_DATA__=') + 'window.__SMART_DATA__='.length;
  return JSON.parse(html.slice(start, html.indexOf(';</script>', start)));
}

function history(out: string): TestHistory {
  return JSON.parse(fs.readFileSync(path.join(out, 'test-history.json'), 'utf8'));
}

// Playwright's own counts for the run, in the reporter's terms: flaky tests and expected failures passed.
function playwright(out: string) {
  const { expected, unexpected, flaky, skipped } = JSON.parse(fs.readFileSync(path.join(out, 'pw.json'), 'utf8')).stats;
  return { total: expected + unexpected + flaky + skipped, passed: expected + flaky, failed: unexpected, skipped, flaky };
}

function counts(s: { total: number; passed: number; failed: number; skipped: number; flaky: number }) {
  return { total: s.total, passed: s.passed, failed: s.failed, skipped: s.skipped, flaky: s.flaky };
}

// The live file's final counters, in the same terms. Its passed bucket leaves out flaky tests.
const live = (out: string) => ({ live: { enabled: true, outputFile: path.join(out, 'live.jsonl') } });
function liveCounts(out: string) {
  const { counters: c } = JSON.parse(fs.readFileSync(path.join(out, 'live.jsonl'), 'utf8').trim().split('\n').at(-1)!);
  return { total: c.completed, passed: c.passed + c.flaky, failed: c.failed, skipped: c.skipped, flaky: c.flaky };
}

const id = (title: string) => `${FILE}::${title}`;

// What CI tools key test history and counts on: each testsuite with its counts and its testcases' identity.
function junit(file: string) {
  const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  return fs.readFileSync(file, 'utf8').split(/<testsuite\s/).slice(1).map((suite) => {
    const { name, hostname, tests, failures, skipped } = attrs(suite.slice(0, suite.indexOf('>')));
    const testcases = [...suite.matchAll(/<testcase\s([^>]*)>/g)].map(([, tag]) => attrs(tag)).map(({ classname, name }) => ({ classname, name }));
    return { name, hostname, tests, failures, skipped, testcases };
  });
}

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist/smart-reporter.js'))) throw new Error('dist/ is missing: run `npm run build` first');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-run-data-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('test ids', () => {
  it('keeps the same title in two describe blocks as two tests, and leaves other ids alone', () => {
    const out = path.join(tmp, 'describe-blocks');
    runSuite(out, {}, ['--grep', 'same title|fails when asked', '--retries=0']);

    const data = reportData(out);
    const ids = [id('first block › same title'), id('second block › same title'), id('fails when asked')].sort();
    expect(data.tests.map((t) => t.testId).sort()).toEqual(ids);
    expect(playwright(out)).toEqual({ total: 3, passed: 2, failed: 1, skipped: 0, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(Object.keys(history(out).tests).sort()).toEqual(ids);
  }, TIMEOUT);

  it('gives a test in a describe block the same id whichever other tests run with it', () => {
    const out = path.join(tmp, 'describe-alone');
    runSuite(out, {}, ['--grep', 'first block', '--retries=0']);
    runSuite(out, {}, ['--grep', 'same title', '--retries=0']);

    expect(Object.keys(history(out).tests).sort()).toEqual([id('first block › same title'), id('second block › same title')]);
    expect(history(out).tests[id('first block › same title')].map((e) => e.passed)).toEqual([true, true]);
  }, TIMEOUT);

  it('moves history saved under the old file::title id to the describe-path id', () => {
    const out = path.join(tmp, 'legacy-id');
    fs.mkdirSync(out, { recursive: true });
    const legacy = { passed: false, duration: 5, timestamp: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(path.join(out, 'test-history.json'), JSON.stringify({ runs: [], tests: { [id('same title')]: [legacy] }, summaries: [] }));
    runSuite(out, {}, ['--grep', 'first block', '--retries=0']);

    const tests = history(out).tests;
    expect(Object.keys(tests)).toEqual([id('first block › same title')]);
    expect(tests[id('first block › same title')].map((e) => [e.passed, e.timestamp === legacy.timestamp])).toEqual([[false, true], [true, false]]);
  }, TIMEOUT);

  it('reports each --repeat-each copy as its own test, and only retries as attempts', () => {
    const out = path.join(tmp, 'repeat-each');
    runSuite(out, {}, ['--grep', 'fails when asked|passes on retry', '--repeat-each=2']);

    const data = reportData(out);
    const attempts = data.tests.map((t) => [t.testId, t.attempts?.map((a) => a.retry)] as const);
    expect(attempts.sort(([a], [b]) => a.localeCompare(b))).toEqual([
      [id('fails when asked'), [0]],
      [id('fails when asked (repeat 1)'), [0]],
      [id('passes on retry'), [0, 1]],
      [id('passes on retry (repeat 1)'), [0, 1]],
    ]);
    expect(playwright(out)).toEqual({ total: 4, passed: 4, failed: 0, skipped: 0, flaky: 2 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(Object.keys(history(out).tests)).toHaveLength(4);
  }, TIMEOUT);
});

describe('test.fail()', () => {
  it('counts a test.fail() test that passed as a failure everywhere', () => {
    const out = path.join(tmp, 'unexpected-pass');
    const options = { qualityGates: { maxFailures: 0, minPassRate: 100 }, ...live(out) };
    runSuite(out, options, ['--grep', 'expected failure that passes']);

    const data = reportData(out);
    const pw = playwright(out);
    expect(pw).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0, flaky: 0 });
    expect(counts(data.summary)).toEqual(pw);
    expect(liveCounts(out)).toEqual(pw);
    expect(counts(history(out).summaries!.at(-1)!)).toEqual(pw);
    expect(history(out).tests[id('expected failure that passes')].map((e) => e.passed)).toEqual([false]);
    expect(data.gates?.rules.map((r) => [r.rule, r.actual])).toEqual([['maxFailures', '1'], ['minPassRate', '0%']]);

    runSuite(out, options, ['--grep', 'expected failure that passes']);
    expect(counts(reportData(out).comparison!.currentRun)).toEqual(playwright(out));
  }, TIMEOUT);

  it('does not report a test.fail() test that fails as expected as a new failure, so noNewFailures passes', () => {
    const out = path.join(tmp, 'expected-failure');
    const options = { qualityGates: { noNewFailures: true } };
    runSuite(out, options, ['--grep', 'expected failure that fails']);
    const second = runSuite(out, options, ['--grep', 'expected failure that fails']);

    expect(reportData(out).comparison?.changes.newFailures).toEqual([]);
    expect(playwright(out)).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 });
    expect(second.status).toBe(0);
  }, TIMEOUT);

  it('does not report a test.fail() test that passes again as fixed', () => {
    const out = path.join(tmp, 'unexpected-pass-twice');
    runSuite(out, {}, ['--grep', 'expected failure that passes']);
    runSuite(out, {}, ['--grep', 'expected failure that passes']);

    expect(reportData(out).comparison?.changes).toMatchObject({ newFailures: [], fixedTests: [] });
  }, TIMEOUT);
});

describe('comparison', () => {
  it('does not report a test that was skipped last run and passes now as fixed', () => {
    const out = path.join(tmp, 'skipped-then-passed');
    runSuite(out, {}, ['--grep', 'skipped when asked'], { ACCEPTANCE_SKIP: '1' });
    expect(playwright(out)).toEqual({ total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0 });
    runSuite(out, {}, ['--grep', 'skipped when asked']);

    expect(playwright(out)).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 });
    expect(reportData(out).comparison?.changes.fixedTests).toEqual([]);
  }, TIMEOUT);

  // Run A has both tests, run B (the baseline) only the first block, as a --grep or --shard run would.
  const both = ['--grep', 'first block|fails when asked', '--retries=0'];
  const baselineOnly = ['--grep', 'first block', '--retries=0'];

  it('compares against the baseline run only: a test that did not run in it is not fixed, it is not in the baseline', () => {
    const out = path.join(tmp, 'partial-baseline-fixed');
    const options = { exportJson: true };
    runSuite(out, options, both, { ACCEPTANCE_FAIL: '1' });
    runSuite(out, options, baselineOnly);
    runSuite(out, options, both);

    const { comparison } = reportData(out);
    expect(comparison?.baselineRun.total).toBe(1);
    expect(comparison?.changes).toMatchObject({ fixedTests: [], newFailures: [], newTests: [], notInBaseline: [id('fails when asked')] });
    const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    expect(json.comparison.changes.notInBaseline.map((t: { testId: string }) => t.testId)).toEqual([id('fails when asked')]);
  }, TIMEOUT);

  it('fails noNewFailures for a test that fails now and did not run in the baseline run', () => {
    const out = path.join(tmp, 'partial-baseline-failed');
    const options = { qualityGates: { noNewFailures: true } };
    runSuite(out, options, both);
    runSuite(out, options, baselineOnly);
    runSuite(out, options, both, { ACCEPTANCE_FAIL: '1' });

    const data = reportData(out);
    expect(data.comparison?.changes).toMatchObject({ newFailures: [], notInBaseline: [id('fails when asked')] });
    expect(data.gates?.rules).toEqual([{ rule: 'noNewFailures', passed: false, actual: '1', threshold: '≤ 0' }]);
  }, TIMEOUT);
});

describe('interrupted and not-run tests', () => {
  it('counts an interrupted test as not run, not as a failure', () => {
    const out = path.join(tmp, 'interrupted');
    runSuite(out, live(out), ['--grep', 'three seconds|fails after a second', '--retries=0', '--workers=2', '--fully-parallel', '--max-failures=1']);

    const data = reportData(out);
    expect(data.tests.map((t) => [t.testId, t.status]).sort()).toEqual([[id('fails after a second'), 'failed'], [id('runs for three seconds'), 'interrupted']]);
    expect(playwright(out)).toEqual({ total: 2, passed: 0, failed: 1, skipped: 1, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(liveCounts(out)).toEqual(playwright(out));
    expect(counts(history(out).summaries!.at(-1)!)).toEqual(playwright(out));
    expect(history(out).tests[id('runs for three seconds')].map((e) => [e.passed, e.skipped])).toEqual([[false, true]]);

    runSuite(out, {}, ['--grep', 'three seconds']);
    const next = reportData(out);
    expect(next.tests[0].flakinessScore).toBeUndefined();
    expect(next.comparison?.changes.fixedTests).toEqual([]);
  }, TIMEOUT);

  it('reports the tests --max-failures never started as skipped', () => {
    const out = path.join(tmp, 'max-failures');
    runSuite(out, {}, ['--grep-invert', 'three seconds|fails after a second', '--retries=0', '--max-failures=1']);

    const data = reportData(out);
    expect(playwright(out)).toEqual({ total: 8, passed: 2, failed: 1, skipped: 5, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(counts(history(out).summaries!.at(-1)!)).toEqual(playwright(out));
    expect(data.tests.filter((t) => t.status === 'skipped').map((t) => t.testId).sort()).toEqual(
      ['expected failure that fails', 'expected failure that passes', 'fails when asked', 'passes on retry', 'skipped when asked'].map(id),
    );
  }, TIMEOUT);

  it('reports a test the global timeout cut off', () => {
    const out = path.join(tmp, 'global-timeout');
    runSuite(out, {}, ['--grep', 'three seconds', '--global-timeout=1500']);

    const data = reportData(out);
    expect(playwright(out)).toEqual({ total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(data.tests.map((t) => [t.testId, t.outcome])).toEqual([[id('runs for three seconds'), 'skipped']]);
  }, TIMEOUT);
});

describe('pass rate', () => {
  const passRates = (out: string) => [
    reportData(out).summary.passRate,
    history(out).summaries!.at(-1)!.passRate,
    JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8')).summary.passRate,
  ];

  it('leaves skipped tests out of the pass rate in the report, history and JSON', () => {
    const out = path.join(tmp, 'pass-rate-skipped');
    runSuite(out, { exportJson: true }, ['--grep', 'first block|skipped when asked'], { ACCEPTANCE_SKIP: '1' });

    expect(playwright(out)).toEqual({ total: 2, passed: 1, failed: 0, skipped: 1, flaky: 0 });
    expect(passRates(out)).toEqual([100, 100, 100]);
  }, TIMEOUT);

  it('has no pass rate when every test was skipped, and skips minPassRate instead of failing it', () => {
    const out = path.join(tmp, 'pass-rate-all-skipped');
    const run = runSuite(out, { exportJson: true, qualityGates: { minPassRate: 90 } }, ['--grep', 'skipped when asked'], { ACCEPTANCE_SKIP: '1' });

    expect(playwright(out)).toEqual({ total: 1, passed: 0, failed: 0, skipped: 1, flaky: 0 });
    expect(passRates(out)).toEqual([null, null, null]);
    expect(reportData(out).gates?.rules).toEqual([{ rule: 'minPassRate', passed: true, actual: 'N/A', threshold: '≥ 90%', skipped: true, skipReason: 'no test ran' }]);
    expect(run.output).toContain('○ Min pass rate        (skipped — no test ran)');
    expect(run.status).toBe(0);
  }, TIMEOUT);
});

describe('history', () => {
  it('does not save a run with no tests, so it never becomes the baseline', () => {
    const out = path.join(tmp, 'empty-run');
    runSuite(out, {}, ['--grep', 'fails when asked']);
    const [first] = history(out).summaries!;
    runSuite(out, {}, ['--grep', 'no test has this title']);

    expect(playwright(out)).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
    expect(history(out).summaries).toEqual([first]);
    runSuite(out, {}, ['--grep', 'fails when asked']);
    expect(reportData(out).comparison?.baselineRun.runId).toBe(first.runId);
  }, TIMEOUT);

  it('gives the report the run id history saves the run under', () => {
    for (const [name, options] of [['run-id', { runId: 'ci-7' }], ['run-id-default', {}]] as const) {
      const out = path.join(tmp, name);
      runSuite(out, options, ['--grep', 'fails when asked']);

      const data = reportData(out);
      const saved = history(out).summaries!.map((s) => s.runId);
      expect(data.meta.runId).toBe(saved[0]);
      expect(data.trends.map((t) => t.runId)).toEqual(saved);
    }
    expect(reportData(path.join(tmp, 'run-id')).meta.runId).toBe('run-ci-7');
  }, TIMEOUT);
});

describe('baselineRunId', () => {
  it('compares the run and each test against the chosen run, given by the runId it ran with', () => {
    const out = path.join(tmp, 'baseline');
    const failing = { ACCEPTANCE_FAIL: '1' };
    runSuite(out, { runId: 'base' }, ['--grep', 'fails when asked']);
    runSuite(out, { runId: 'mid' }, ['--grep', 'fails when asked', '--retries=0'], failing);

    for (const baselineRunId of ['base', 'run-base']) {
      runSuite(out, { runId: `now-${baselineRunId}`, baselineRunId }, ['--grep', 'fails when asked', '--retries=0'], failing);
      const { comparison } = reportData(out);
      expect(comparison?.baselineRun.runId).toBe('run-base');
      expect(comparison?.changes.newFailures).toEqual([id('fails when asked')]);
    }
  }, TIMEOUT);
});

describe('baseline.branch', () => {
  // A GitHub Actions run: a push to main, or a pull request from feature/cart into main
  const github = (runNumber: string, pullRequest: boolean) => ({
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '', GITHUB_RUN_ID: runNumber, GITHUB_SHA: `c0ffee${runNumber}`.padEnd(40, '0'),
    GITHUB_REF: pullRequest ? 'refs/pull/7/merge' : 'refs/heads/main', GITHUB_REF_NAME: pullRequest ? '7/merge' : 'main',
    GITHUB_HEAD_REF: pullRequest ? 'feature/cart' : '', GITHUB_BASE_REF: pullRequest ? 'main' : '',
    GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop',
  });

  it('compares a pull request run with the latest run on main, and with filterHistory scores flakiness on main runs only', () => {
    const out = path.join(tmp, 'baseline-branch');
    const args = ['--grep', 'fails when asked', '--retries=0'];
    runSuite(out, { runId: 'main-1' }, args, github('1', false));
    runSuite(out, { runId: 'pr-1' }, args, github('2', true));
    runSuite(out, { runId: 'main-2' }, args, github('3', false));
    runSuite(out, { runId: 'pr-2' }, args, github('4', true));

    for (const branch of ['main', 'target']) {
      runSuite(out, { runId: `now-${branch}`, exportJson: true, baseline: { branch, filterHistory: true } }, args, github('5', true));
      const data = reportData(out);
      expect(data.comparison?.baselineRun.runId).toBe('run-main-2');
      // The 2 main runs in history, and this run
      expect(data.tests[0].flakinessRuns).toBe(3);
      const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
      expect(renderSummary(json, { workspace: ROOT })).toContain('**Baseline run:** `main` @ `c0ffee30`');
    }
  }, TIMEOUT);
});

describe('flaky', () => {
  it('counts a run as flaky only for tests that passed on retry in it, the same in the report, the trend and history', () => {
    const out = path.join(tmp, 'flaky-by-history');
    // Failed, passed, failed, passed: flaky by history, but this run it passes first time.
    for (const fail of [true, false, true, false, false]) {
      if (fail) runSuite(out, {}, ['--grep', 'fails when asked', '--retries=0'], { ACCEPTANCE_FAIL: '1' });
      else runSuite(out, {}, ['--grep', 'fails when asked']);
    }

    const data = reportData(out);
    expect(data.tests[0].signals).toContain('flaky');
    expect(playwright(out)).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
    expect(counts(data.trends.at(-1)!)).toEqual(playwright(out));
    expect(counts(data.comparison!.currentRun)).toEqual(playwright(out));
    expect(counts(history(out).summaries!.at(-1)!)).toEqual(playwright(out));
  }, TIMEOUT);

  it('scores a test that passed on retry last run as flaky, so quarantine picks it', () => {
    const out = path.join(tmp, 'flaky-by-retry');
    const outputFile = path.join(out, 'quarantine.json');
    const options = { quarantine: { enabled: true, threshold: 0.3, outputFile } };
    runSuite(out, options, ['--grep', 'passes on retry']);
    expect(playwright(out)).toEqual({ total: 1, passed: 1, failed: 0, skipped: 0, flaky: 1 });
    runSuite(out, options, ['--grep', 'passes on retry']);

    const [test] = reportData(out).tests;
    expect([test.flakinessScore, test.flakinessIndicator]).toEqual([0.99, '🔴 Flaky']);
    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries.map((e: { testId: string }) => e.testId)).toEqual([id('passes on retry')]);
  }, TIMEOUT);

  it('counts this run: a fixed test is stable and not quarantined, a retry pass after clean runs is flaky', () => {
    const out = path.join(tmp, 'flaky-this-run');
    const outputFile = path.join(out, 'quarantine.json');
    const entries = (results: boolean[]) => results.map((passed) => ({ passed, duration: 5, timestamp: new Date(0).toISOString() }));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'test-history.json'), JSON.stringify({
      runs: [],
      summaries: [],
      tests: {
        // Broken for 5 runs, then fixed
        [id('passes')]: entries([false, false, false, false, false, true, true, true, true, true]),
        [id('passes on retry')]: entries(Array(9).fill(true)),
      },
    }));
    runSuite(out, { quarantine: { enabled: true, threshold: 0.01, outputFile } }, ['--grep', 'passes', '--grep-invert', 'expected failure']);

    const flakiness = Object.fromEntries(reportData(out).tests.map((t) => [t.title, [t.flakinessIndicator, t.flakinessRuns, t.signals.includes('flaky')]]));
    expect(flakiness).toEqual({ passes: ['🟢 Stable', 11, false], 'passes on retry': ['🔴 Flaky', 10, true] });
    const entriesOut = JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries.map((e: { testId: string; runs?: number }) => [e.testId, e.runs]);
    expect(entriesOut).toEqual([[id('passes on retry'), 10]]);
  }, TIMEOUT);

  it('reports insufficient history for flakiness and duration below 5 runs, this run included', () => {
    const out = path.join(tmp, 'short-history');
    const entries = (n: number, duration: number) => Array.from({ length: n }, () => ({ passed: true, duration, timestamp: new Date(0).toISOString() }));
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'test-history.json'), JSON.stringify({
      runs: [],
      summaries: [],
      tests: { [id('passes')]: entries(3, 5), [id('runs for three seconds')]: entries(1, 1000) },
    }));
    runSuite(out, {}, ['--grep', 'passes|three seconds', '--grep-invert', 'expected failure|retry']);

    const trends = Object.fromEntries(reportData(out).tests.map((t) => [t.title, [t.flakinessIndicator, t.performanceTrend]]));
    expect(trends).toEqual({
      passes: ['⚪ Insufficient history', '→ Insufficient history'],
      'runs for three seconds': ['⚪ Insufficient history', '→ Insufficient history'],
    });
  }, TIMEOUT);
});

describe('execution metadata', () => {
  interface PwResult { retry: number; workerIndex: number; parallelIndex: number; startTime: string; duration: number }
  interface PwSuite { suites?: PwSuite[]; specs?: Array<{ title: string; tests: Array<{ results: PwResult[] }> }> }
  const pwAttempts = (out: string) => {
    const walk = (s: PwSuite): Array<[string, number, number, number, number, number]> => [
      ...(s.specs ?? []).flatMap((spec) => spec.tests.flatMap((t) => t.results.map((r) =>
        [spec.title, r.retry, r.workerIndex, r.parallelIndex, Date.parse(r.startTime), r.duration] as [string, number, number, number, number, number]))),
      ...(s.suites ?? []).flatMap(walk),
    ];
    return JSON.parse(fs.readFileSync(path.join(out, 'pw.json'), 'utf8')).suites.flatMap(walk).sort();
  };

  it('keeps the worker, worker slot and start of every attempt, and the time spent in retried attempts', () => {
    const out = path.join(tmp, 'execution-metadata');
    runSuite(out, {}, ['--grep', 'passes$|passes on retry|same title', '--workers=2', '--fully-parallel']);

    const attempts = reportData(out).tests.flatMap((t) => (t.attempts ?? []).map((a) => [t.title, a.retry, a.workerIndex, a.parallelIndex, a.startTime, a.duration]));
    expect(attempts.sort()).toEqual(pwAttempts(out));
    expect([...new Set(attempts.map((a) => a[3]))].sort()).toEqual([0, 1]);
    const retried = pwAttempts(out).filter(([title, retry]) => title === 'passes on retry' && retry === 0);
    expect(history(out).tests[id('passes on retry')].map((e) => e.retryWaste)).toEqual([retried[0][5]]);
    expect(history(out).tests[id('passes')].map((e) => e.retryWaste)).toEqual([undefined]);
  }, TIMEOUT);
});

describe('efficiency', () => {
  interface PwResult { retry: number; parallelIndex: number; startTime: string; duration: number }
  interface PwSuite { suites?: PwSuite[]; specs?: Array<{ tests: Array<{ results: PwResult[] }> }> }
  const pwRun = (out: string) => {
    const json = JSON.parse(fs.readFileSync(path.join(out, 'pw.json'), 'utf8'));
    const walk = (s: PwSuite): PwResult[][] => [...(s.specs ?? []).flatMap((spec) => spec.tests.map((t) => t.results)), ...(s.suites ?? []).flatMap(walk)];
    return { stats: json.stats as { startTime: string; duration: number }, tests: (json.suites as PwSuite[]).flatMap(walk) };
  };
  const GREP = ['--grep', 'passes$|passes on retry|same title', '--fully-parallel'];

  it('takes retry waste, worker time and the setup gap from the attempts Playwright reports', () => {
    const out = path.join(tmp, 'efficiency');
    runSuite(out, { exportJson: true, ciCostPerMinute: 60 }, [...GREP, '--workers=2']);

    const pw = pwRun(out);
    const attempts = pw.tests.flat();
    const retryWaste = pw.tests.flatMap((results) => results.slice(0, -1)).reduce((sum, r) => sum + r.duration, 0);
    const slots = [0, 1].map((slot) => {
      const on = attempts.filter((r) => r.parallelIndex === slot);
      return [slot, on.length, on.reduce((sum, r) => sum + r.duration, 0)];
    });
    const e = reportData(out).efficiency!;
    expect(retryWaste).toBeGreaterThan(0);
    expect(e.retryWaste).toBe(retryWaste);
    expect(e.cost).toEqual({ perMinute: 60, retryWaste: Math.round(retryWaste / 10) / 100 });
    expect(e.workers!.slots.map((s) => [s.slot, s.attempts, s.busy])).toEqual(slots);
    expect(e.setupGap).toBe(Math.min(...attempts.map((r) => Date.parse(r.startTime))) - Date.parse(pw.stats.startTime));
    expect(e.shard).toBeUndefined();
    expect(JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8')).efficiency).toEqual(e);
  }, TIMEOUT);

  it('gives a shard its wall time, and leaves out the shard and workers once merge-reports joins the shards', () => {
    const blobs = path.join(tmp, 'efficiency-blobs');
    fs.mkdirSync(blobs, { recursive: true });
    const shards = [1, 2].map((n) => {
      const out = path.join(tmp, `efficiency-shard${n}`);
      runSuite(out, {}, [...GREP, `--shard=${n}/2`], { ACCEPTANCE_BLOB: path.join(out, 'blob') });
      for (const f of fs.readdirSync(path.join(out, 'blob'))) fs.copyFileSync(path.join(out, 'blob', f), path.join(blobs, f));
      return out;
    });
    expect(reportData(shards[1]).efficiency!.shard).toEqual({ current: 2, total: 2, wallTime: pwRun(shards[1]).stats.duration });

    const out = path.join(tmp, 'efficiency-merged');
    const merge = spawnSync(process.execPath, [CLI, 'merge-reports', `--config=${CONFIG}`, blobs], {
      cwd: ROOT,
      env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: '{}' },
      encoding: 'utf8',
    });
    expect(merge.status).toBe(0);
    const e = reportData(out).efficiency!;
    expect([e.merged, e.shard, e.workers]).toEqual([true, undefined, undefined]);
    expect(e.retryWaste).toBe(shards.reduce((sum, s) => sum + reportData(s).efficiency!.retryWaste, 0));
  }, TIMEOUT);
});

describe('environment matrix', () => {
  it('reports a test that fails on firefox and passes on chromium and webkit as firefox only', () => {
    const out = path.join(tmp, 'environment');
    runSuite(out, { exportJson: true }, ['--retries=0'], { ACCEPTANCE_MATCH: 'environment.fixtures.ts', ACCEPTANCE_PROJECTS: 'chromium,firefox,webkit' });

    const insights = [{ dimension: 'project', value: 'firefox', testIds: ['[firefox] environment.fixtures.ts::fails on firefox'], text: '1 test fails on firefox only' }];
    expect(reportData(out).environmentInsights).toEqual(insights);
    expect(JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8')).environmentInsights).toEqual(insights);
  }, TIMEOUT);
});

describe('JUnit export', () => {
  const junitFile = (out: string) => path.join(out, 'smart-report-junit.xml');

  // Playwright 1.57's junit reporter (includeProjectInTestName: true) on this file, with ACCEPTANCE_SKIP set.
  const golden = (project: string) => ({
    name: FILE, hostname: project, tests: '8', failures: '2', skipped: '1',
    testcases: [
      'passes', 'first block › same title', 'second block › same title', 'expected failure that fails',
      'expected failure that passes', 'passes on retry', 'fails when asked', 'skipped when asked',
    ].map((title) => ({ classname: FILE, name: project ? `[${project}] ${title}` : title })),
  });

  it('groups, names and counts testcases the same as Playwright\'s JUnit reporter', () => {
    for (const projects of ['', 'alpha,beta']) {
      const out = path.join(tmp, `junit-${projects || 'unnamed'}`);
      runSuite(out, { exportJunit: true }, ['--grep-invert', 'three seconds|fails after a second'], { ACCEPTANCE_SKIP: '1', ACCEPTANCE_PROJECTS: projects });

      const expected = (projects ? projects.split(',') : ['']).map(golden);
      expect(junit(path.join(out, 'pw-junit.xml'))).toEqual(expected);
      expect(junit(junitFile(out))).toEqual(expected);
    }
  }, TIMEOUT);

  it('gives the same title in two projects and two describe blocks four distinct testcases', () => {
    const out = path.join(tmp, 'junit-identity');
    runSuite(out, { exportJunit: true }, ['--grep', 'same title', '--retries=0'], { ACCEPTANCE_PROJECTS: 'alpha,beta' });

    expect(junit(junitFile(out)).flatMap((s) => s.testcases.map((t) => [t.classname, t.name]))).toEqual([
      [FILE, '[alpha] first block › same title'],
      [FILE, '[alpha] second block › same title'],
      [FILE, '[beta] first block › same title'],
      [FILE, '[beta] second block › same title'],
    ]);
  }, TIMEOUT);

  it('reports a test.fail() test that passed as a failure, as Playwright\'s exit code does', () => {
    const out = path.join(tmp, 'junit-unexpected-pass');
    const run = runSuite(out, { exportJunit: true }, ['--grep', 'expected failure that passes', '--retries=0']);

    const xml = fs.readFileSync(junitFile(out), 'utf8');
    expect(run.status).toBe(1);
    expect(xml).toContain('<testsuites name="Smart Reporter" tests="1" failures="1" errors="0" skipped="0" ');
    expect(xml.match(/<failure [^>]*>/g)).toEqual(['<failure type="AssertionError" message="Expected to fail, but passed">']);
  }, TIMEOUT);

  it('adds a flakyFailure for the failed attempt of a test that passed on retry, and does not count it as a failure', () => {
    const out = path.join(tmp, 'junit-flaky');
    const run = runSuite(out, { exportJunit: true }, ['--grep', 'passes on retry']);

    const xml = fs.readFileSync(junitFile(out), 'utf8');
    expect(run.status).toBe(0);
    expect(xml).toContain('<testsuites name="Smart Reporter" tests="1" failures="0" errors="0" skipped="0" ');
    expect(xml.match(/<(failure|flakyFailure) [^>]*>/g)).toEqual(['<flakyFailure type="AssertionError" message="Error: expect(received).toBe(expected) // Object.is equality">']);
    expect(xml).toMatch(/<flakyFailure [^>]*><stackTrace>Error: expect\(received\)\.toBe\(expected\) \/\/ Object\.is equality\n\nExpected: 1\nReceived: 0\n {4}at [^<]*run-data\.fixtures\.ts:\d+:\d+<\/stackTrace><\/flakyFailure>\n/);
  }, TIMEOUT);
});
