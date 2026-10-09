import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReportData } from '../../src/report-data/schema';

// Runs a11y.fixtures.ts in Chromium through the built reporter and fixture (dist/).
// Needs `npm run build`; run with `npm run test:acceptance`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');

let tmp: string;

function runSuite(out: string, args: string[]) {
  const run = spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: '{}', ACCEPTANCE_MATCH: 'a11y.fixtures.ts' },
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

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist/accessibility/index.js'))) throw new Error('dist/ is missing: run `npm run build` first');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-a11y-acceptance-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('accessibility fixture', () => {
  it('does not fail a passing test that closes its page', () => {
    const out = path.join(tmp, 'closed');
    const run = runSuite(out, ['--grep', 'closes its page']);

    expect(run.status).toBe(0);
    expect(reportData(out).tests.map((t) => [t.title, t.status, t.a11y])).toEqual([['closes its page', 'passed', undefined]]);
  });

  it('does not fail a passing test when the scan itself throws', () => {
    const out = path.join(tmp, 'throws');
    const run = runSuite(out, ['--grep', 'cannot be scanned']);

    expect(run.status).toBe(0);
    expect(reportData(out).tests.map((t) => [t.title, t.status, t.a11y])).toEqual([['cannot be scanned', 'passed', undefined]]);
  });
});
