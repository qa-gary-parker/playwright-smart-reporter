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
});
