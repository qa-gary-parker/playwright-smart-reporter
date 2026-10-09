import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReportData } from '../../src/report-data/schema';

// Runs example/acceptance through the built reporter (dist/) with the options under test.
// Needs `npm run build`; run with `npm run test:acceptance`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');

let tmp: string;

function runSuite(out: string, options: object, args: string[] = []) {
  const run = spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options) },
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function reportData(html: string): ReportData {
  const start = html.indexOf('window.__SMART_DATA__=') + 'window.__SMART_DATA__='.length;
  return JSON.parse(html.slice(start, html.indexOf(';</script>', start)));
}

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist/smart-reporter.js'))) throw new Error('dist/ is missing: run `npm run build` first');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-acceptance-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('live results', () => {
  it('writes the live file into a folder that does not exist yet, and the report finds it relative to itself', () => {
    const out = path.join(tmp, 'live');
    const liveFile = path.join(tmp, 'live-results', 'nested', 'run.jsonl');
    const run = runSuite(out, { live: { enabled: true, outputFile: liveFile } }, ['--grep', 'passes$']);

    expect(run.output).not.toContain('Error in reporter');
    expect(run.status).toBe(0);
    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    expect(data.tests.map((t) => t.title)).toEqual(['passes']);
    expect(data.config.live?.jsonlFile).toBe('../live-results/nested/run.jsonl');
    const events = fs.readFileSync(path.resolve(out, data.config.live!.jsonlFile), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(['start', 'test', 'complete']);
  });
});
