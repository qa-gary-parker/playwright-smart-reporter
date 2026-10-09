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
