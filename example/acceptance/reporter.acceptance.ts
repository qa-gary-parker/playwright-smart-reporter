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

function runSuite(out: string, options: object, args: string[] = [], command: 'test' | 'merge-reports' = 'test', env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [CLI, command, `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options), ...env },
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

describe('history', () => {
  it('saves history into a folder that does not exist yet, and a breached gate still fails the run', () => {
    const out = path.join(tmp, 'history');
    const historyFile = path.join(tmp, 'history-store', 'nested', 'history.json');
    const run = runSuite(out, { historyFile, qualityGates: { minPassRate: 101 } }, ['--grep', 'passes$']);

    expect(run.output).not.toContain('Error in reporter');
    expect(run.status).toBe(1);
    expect(Object.keys(JSON.parse(fs.readFileSync(historyFile, 'utf8')).tests)).toEqual(['suite.fixtures.ts::passes']);
  });
});

describe('quarantine', () => {
  it('writes the quarantine file into a folder that does not exist yet', () => {
    const out = path.join(tmp, 'quarantine');
    const outputFile = path.join(tmp, 'quarantine-store', 'nested', 'quarantine.json');
    const options = { quarantine: { enabled: true, threshold: 0.01, outputFile } };
    // A failed run and a passed run before this one make the test flaky by history (score 0.5).
    runSuite(out, options, ['--grep', 'fails when asked'], 'test', { ACCEPTANCE_FAIL: '1' });
    runSuite(out, options, ['--grep', 'fails when asked']);
    runSuite(out, options, ['--grep', 'fails when asked']);

    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries.map((e: { testId: string }) => e.testId)).toEqual(['suite.fixtures.ts::fails when asked']);
  });
});

describe('network log options', () => {
  const urls = (options: object) => {
    const out = path.join(tmp, `network-${JSON.stringify(options).replace(/\W/g, '')}`);
    runSuite(out, options, [], 'test', { ACCEPTANCE_MATCH: 'network.fixtures.ts' });
    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    return data.tests[0].networkLogs?.entries.map((e) => new URL(e.url).pathname);
  };

  it('leaves out static assets by default', () => {
    expect(urls({})).toEqual(['/', '/api/a', '/api/b', '/api/c']);
  });

  it('applies networkLogExcludeAssets, networkLogMaxEntries and networkLogFilter', () => {
    expect(urls({ networkLogExcludeAssets: false })).toEqual(['/', '/logo.png', '/api/a', '/api/b', '/api/c']);
    expect(urls({ networkLogMaxEntries: 2 })).toEqual(['/', '/api/a']);
    expect(urls({ networkLogFilter: '/api/b' })).toEqual(['/api/b']);
  });
});

describe('analysis switches', () => {
  it('skips retry analysis, failure clustering and stability scores when they are turned off', () => {
    const analysed = (out: string, options: object) => {
      runSuite(out, options, ['--grep', 'fails$|passes on retry']);
      const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
      return {
        clusters: data.clusters.length,
        clustered: data.tests.filter((t) => t.clusterId).length,
        scored: data.tests.filter((t) => t.stabilityScore).length,
        retryInfo: data.tests.filter((t) => t.retryInfo).length,
      };
    };
    expect(analysed(path.join(tmp, 'analysis-on'), {})).toEqual({ clusters: 1, clustered: 1, scored: 2, retryInfo: 2 });
    expect(analysed(path.join(tmp, 'analysis-off'), { enableRetryAnalysis: false, enableFailureClustering: false, enableStabilityScore: false }))
      .toEqual({ clusters: 0, clustered: 0, scored: 0, retryInfo: 0 });
  });
});

describe('merge-reports', () => {
  it('reports the duration of the tests, not of the merge', () => {
    const blobs = path.join(tmp, 'blobs');
    const out = path.join(tmp, 'merged');
    runSuite(path.join(tmp, 'shard'), {}, ['--reporter=blob', '--grep', 'takes a second'], 'test', { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobs });
    const merge = runSuite(out, { exportJson: true }, [blobs], 'merge-reports');

    expect(merge.status).toBe(0);
    const { summary } = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    expect(summary.total).toBe(1);
    expect(summary.duration).toBeGreaterThanOrEqual(1000);
  });
});
