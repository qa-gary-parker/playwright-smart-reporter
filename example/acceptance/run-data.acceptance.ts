import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const id = (title: string) => `${FILE}::${title}`;

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
    const options = { qualityGates: { maxFailures: 0, minPassRate: 100 } };
    runSuite(out, options, ['--grep', 'expected failure that passes']);

    const data = reportData(out);
    const pw = playwright(out);
    expect(pw).toEqual({ total: 1, passed: 0, failed: 1, skipped: 0, flaky: 0 });
    expect(counts(data.summary)).toEqual(pw);
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
});

describe('interrupted and not-run tests', () => {
  it('counts an interrupted test as not run, not as a failure', () => {
    const out = path.join(tmp, 'interrupted');
    runSuite(out, {}, ['--grep', 'three seconds|fails after a second', '--retries=0', '--workers=2', '--fully-parallel', '--max-failures=1']);

    const data = reportData(out);
    expect(data.tests.map((t) => [t.testId, t.status]).sort()).toEqual([[id('fails after a second'), 'failed'], [id('runs for three seconds'), 'interrupted']]);
    expect(playwright(out)).toEqual({ total: 2, passed: 0, failed: 1, skipped: 1, flaky: 0 });
    expect(counts(data.summary)).toEqual(playwright(out));
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
