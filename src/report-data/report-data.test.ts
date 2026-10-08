import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestResultData } from '../types';
import { buildReportData, type ReportInput } from './builder';
import type { ReportData } from './schema';
import { customThemeCss, serializeData, themeAttributes, writeReport } from './writer';

function result(over: Partial<TestResultData> & { testId: string }): TestResultData {
  return { title: over.testId, file: 'a.spec.ts', status: 'passed', duration: 100, retry: 0, steps: [], history: [], outcome: 'expected', ...over };
}

function input(results: TestResultData[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    results,
    history: { runs: [], tests: {}, summaries: [] },
    startTime: 1_000,
    options: {},
    outputBasename: 'smart-report',
    ...over,
  };
}

const FAILED = result({ testId: 'f1', status: 'failed', outcome: 'unexpected', error: 'Error: boom </script><script>alert(1)</script>' });
const FLAKY = result({ testId: 'k1', status: 'passed', outcome: 'flaky', retry: 1 });
const EXPECTED_FAIL = result({ testId: 'x1', status: 'failed', outcome: 'expected', expectedStatus: 'failed' });
const SKIPPED = result({ testId: 's1', status: 'skipped', outcome: 'skipped' });

describe('buildReportData', () => {
  it('counts outcomes the way the 2.x report did', () => {
    const data = buildReportData(input([FAILED, FLAKY, EXPECTED_FAIL, SKIPPED, result({ testId: 'p1' })]), 6_000);
    expect(data.summary).toMatchObject({ total: 5, passed: 3, failed: 1, skipped: 1, flaky: 1, passRate: 60, duration: 5_000 });
    expect(data.meta.duration).toBe(5_000);
    expect(data.schemaVersion).toBe(3);
  });

  it('derives signals, cluster ids, and comparison ids', () => {
    const regressed = result({ testId: 'r1', performanceTrend: '↑ 40% slower', performanceMetrics: { averageDuration: 100, currentDuration: 140, percentChange: 40, absoluteChange: 40, threshold: 0.2, isRegression: true, isImprovement: false, severity: 'medium' } });
    const data = buildReportData(
      input([FAILED, FLAKY, regressed], {
        failureClusters: [{ id: 'c1', errorType: 'Timeout', count: 1, tests: [FAILED] }],
        quarantinedTestIds: new Set(['k1']),
        comparison: {
          baselineRun: { runId: 'b', timestamp: '', total: 3, passed: 3, failed: 0, skipped: 0, flaky: 0, slow: 0, duration: 1, passRate: 100 },
          currentRun: { runId: 'c', timestamp: '', total: 3, passed: 2, failed: 1, skipped: 0, flaky: 1, slow: 1, duration: 1, passRate: 66 },
          changes: { newFailures: [FAILED], fixedTests: [], newTests: [], regressions: [regressed], improvements: [] },
        },
      }),
      2_000,
    );
    const byId = Object.fromEntries(data.tests.map((t) => [t.testId, t]));
    expect(byId.f1.signals).toEqual(['new-failure']);
    expect(byId.f1.clusterId).toBe('c1');
    expect(byId.k1.signals).toEqual(['flaky', 'quarantined']);
    expect(byId.r1.signals).toEqual(['regression', 'slow']);
    expect(data.clusters).toEqual([{ id: 'c1', errorType: 'Timeout', testIds: ['f1'], aiSuggestion: undefined }]);
    expect(data.comparison?.changes).toEqual({ newFailures: ['f1'], fixedTests: [], newTests: [], regressions: ['r1'], improvements: [] });
    expect(data.config.features.comparison).toBe(true);
  });

  it('drops the circular cluster back-reference and embedded trace data', () => {
    const withCluster = { ...FAILED, traceData: 'data:application/zip;base64,AAAA' } as TestResultData;
    withCluster.failureCluster = { id: 'c1', errorType: 'x', count: 1, tests: [withCluster] };
    const data = buildReportData(input([withCluster]));
    expect(Object.keys(data.tests[0])).not.toContain('failureCluster');
    expect(Object.keys(data.tests[0])).not.toContain('traceData');
    expect(() => JSON.stringify(data)).not.toThrow();
  });

  it('records which provider and model produced the AI output', () => {
    const data = buildReportData(input([{ ...FAILED, aiSuggestion: 'Wait for the selector' }], { options: { ai: { provider: 'ollama', model: 'qwen2.5:7b' } } }));
    expect(data.ai).toStrictEqual({ suiteHealthSummary: undefined, provider: 'ollama', model: 'qwen2.5:7b' });
  });

  it('leaves provider and model out when the report has no AI output', () => {
    const data = buildReportData(input([FAILED], { options: { ai: { provider: 'ollama', model: 'qwen2.5:7b' } } }));
    expect(data.ai).toStrictEqual({ suiteHealthSummary: undefined });
  });

  it('carries per-test owners and a per-owner health summary', () => {
    const data = buildReportData(
      input([
        { ...FAILED, owners: ['@org/payments'], ownerSource: 'codeowners' },
        result({ testId: 'p1', owners: ['@org/payments'], ownerSource: 'codeowners' }),
        result({ testId: 'p2' }),
      ]),
    );
    expect(data.tests.map((t) => [t.testId, t.owners, t.ownerSource])).toEqual([
      ['f1', ['@org/payments'], 'codeowners'],
      ['p1', ['@org/payments'], 'codeowners'],
      ['p2', undefined, undefined],
    ]);
    expect(data.ownership).toEqual({ owners: [{ owner: '@org/payments', total: 2, failed: 1, flaky: 0, passRate: 50 }] });
    expect(buildReportData(input([result({ testId: 'p2' })])).ownership).toBeUndefined();
  });

  it('carries merged coverage into the report data', () => {
    const totals = { total: 3, covered: 2, pct: 66.66 };
    const coverage = { summary: { lines: totals, functions: totals, branches: totals }, files: [] };
    expect(buildReportData(input([], { coverage })).coverage).toBe(coverage);
    expect(buildReportData(input([])).coverage).toBeUndefined();
  });

  it('adds the current run to the trend once', () => {
    const past = { runId: 'run-1', timestamp: '2026-01-01T00:00:00.000Z', total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, slow: 0, duration: 5, passRate: 100 };
    const data = buildReportData(input([FAILED, result({ testId: 'p1' })], { history: { runs: [], tests: {}, summaries: [past] } }), 3_000);
    expect(data.trends).toEqual([
      past,
      { runId: 'run-1000', timestamp: new Date(1_000).toISOString(), total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0, slow: 0, duration: 2_000, passRate: 50 },
    ]);
    const already = buildReportData(input([], { history: { runs: [], tests: {}, summaries: [{ ...past, runId: 'run-1000' }] } }));
    expect(already.trends).toHaveLength(1);
  });

  it('applies 2.x feature-flag defaults', () => {
    expect(buildReportData(input([])).config.features).toEqual({
      gallery: true,
      comparison: false,
      trends: true,
      traceViewer: true,
      historyDrilldown: false,
      live: true,
      networkLogs: true,
    });
  });

  // prior runs pass, pass, pass, pass, fail; this run passes
  const FLIPPED = [true, true, true, true, false].map((passed) => ({ passed, duration: 100, timestamp: '', retry: 0 }));

  it('attaches flake forecasts to first-try passes and summarises the at-risk tests', () => {
    const data = buildReportData(input([result({ testId: 'p1', history: FLIPPED }), { ...FAILED, history: FLIPPED }]));
    const byId = Object.fromEntries(data.tests.map((t) => [t.testId, t]));
    expect(byId.p1.forecast).toEqual({
      state: 'scored',
      risk: 0.9,
      reasons: [{ signal: 'outcome-instability', detail: 'Pass/fail flipped 2 times in the last 6 runs, most recently this run', weight: 0.9 }],
    });
    expect('forecast' in byId.f1).toBe(false);
    expect(data.forecastSummary).toEqual({ atRisk: ['p1'], threshold: 0.5, minRuns: 5 });
  });

  it('omits forecasts when forecasting is disabled', () => {
    const data = buildReportData(input([result({ testId: 'p1', history: FLIPPED })], { options: { forecast: { enabled: false } } }));
    expect('forecast' in data.tests[0]).toBe(false);
    expect('forecastSummary' in data).toBe(false);
  });
});

describe('theme mapping', () => {
  it('maps presets to mode or accent attributes', () => {
    expect(themeAttributes(undefined)).toBe('');
    expect(themeAttributes({ preset: 'default' })).toBe('');
    expect(themeAttributes({ preset: 'dark' })).toBe(' data-mode="dark"');
    expect(themeAttributes({ preset: 'high-contrast' })).toBe(' data-mode="hc"');
    expect(themeAttributes({ preset: 'cyberpunk' })).toBe(' data-accent="cyberpunk"');
  });

  it('maps custom colours to tokens and ignores values that could break out of the rule', () => {
    expect(customThemeCss({ background: '#101010', primary: 'rgb(1, 2, 3)', error: 'red;}body{display:none' })).toBe(
      ':root:root:root{--bg:#101010;--accent-l:rgb(1, 2, 3);--accent-d:rgb(1, 2, 3);}',
    );
    expect(customThemeCss({ preset: 'dark' })).toBe('');
    expect(customThemeCss({ background: 'rgb(</style><script>alert(1)</script>)' })).toBe('');
  });

  it('ignores preset values outside the known list', () => {
    expect(themeAttributes({ preset: 'x" onload="alert(1)' as never })).toBe('');
  });
});

describe('writeReport', () => {
  const assets = { css: '.x{color:var(--text)}', fonts: '@font-face{font-family:"Geist"}', js: 'window.__APP__=1;' };
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-report-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function evalData(source: string): ReportData {
    const sandbox = { window: {} as { __SMART_DATA__?: ReportData } };
    vm.runInNewContext(source, sandbox);
    return sandbox.window.__SMART_DATA__!;
  }

  const data = () => buildReportData(input([FAILED, FLAKY, SKIPPED]), 2_000);

  it('inlines data that round-trips exactly and cannot close the script tag', async () => {
    const out = path.join(dir, 'report.html');
    const res = await writeReport(data(), { outputPath: out, assets, assetMode: 'inline' });
    const html = fs.readFileSync(out, 'utf8');
    expect(res).toMatchObject({ mode: 'inline', files: [out] });
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    const script = html.slice(html.indexOf('window.__SMART_DATA__='), html.indexOf(';</script>') + 1);
    expect(evalData(script)).toEqual(JSON.parse(JSON.stringify(data())));
    expect(html).toContain('<style>@font-face');
    expect(html).toContain('<script>window.__APP__=1;</script>');
  });

  it('writes data to a companion script in external mode', async () => {
    const out = path.join(dir, 'report.html');
    const res = await writeReport(data(), { outputPath: out, assets, assetMode: 'external' });
    const html = fs.readFileSync(out, 'utf8');
    expect(res.mode).toBe('external');
    expect(html).toContain('<script src="./report-data.js"></script>');
    expect(html).not.toContain('__SMART_DATA__');
    expect(evalData(fs.readFileSync(path.join(dir, 'report-data.js'), 'utf8')).tests).toHaveLength(3);
  });

  it('rejects instead of crashing when the output path cannot be written', async () => {
    fs.mkdirSync(path.join(dir, 'taken.html'));
    await expect(writeReport(data(), { outputPath: path.join(dir, 'taken.html'), assets, assetMode: 'inline' })).rejects.toThrow(/EISDIR/);
  });

  it('encodes report names in asset URLs', async () => {
    const out = path.join(dir, 'run #1.html');
    await writeReport(data(), { outputPath: out, assets, assetMode: 'external' });
    expect(fs.readFileSync(out, 'utf8')).toContain('<script src="./run%20%231-data.js"></script>');
  });

  it('switches to external in auto mode only above the threshold', async () => {
    const out = path.join(dir, 'report.html');
    const bytes = serializeData(data()).join('').length;
    expect((await writeReport(data(), { outputPath: out, assets, autoThresholdBytes: bytes })).mode).toBe('inline');
    expect((await writeReport(data(), { outputPath: out, assets, autoThresholdBytes: bytes - 1 })).mode).toBe('external');
  });

  it('emits no inline script, style, or fonts when cspSafe', async () => {
    const out = path.join(dir, 'report.html');
    const report = { ...data(), config: { ...data().config, theme: { preset: 'ocean' as const, background: '#000000' } } };
    const res = await writeReport(report, { outputPath: out, assets, cspSafe: true, assetMode: 'inline' });
    const html = fs.readFileSync(out, 'utf8');
    expect(res.mode).toBe('external');
    expect(html).not.toMatch(/<script>|<style>/);
    expect(html).toContain('<html lang="en" data-accent="ocean">');
    expect(res.files.map((f) => path.basename(f)).sort()).toEqual(['report-data.js', 'report.css', 'report.html', 'report.js']);
    expect(fs.readFileSync(path.join(dir, 'report.css'), 'utf8')).toBe(`${assets.css}\n:root:root:root{--bg:#000000;}`);
    expect(fs.readFileSync(path.join(dir, 'report.css'), 'utf8')).not.toContain('font-face');
  });
});
