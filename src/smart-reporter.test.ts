import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import SmartReporter, { mergeHistories } from './smart-reporter';
import type { JsonExportData } from './generators/json-exporter';
import type { HistoryRunFile, QualityGateConfig, RunSummary, SmartReporterOptions, TestHistory, TestHistoryEntry } from './types';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

describe('SmartReporter options', () => {
  it('throws at creation on an unknown quality gate key, so a typo cannot pass the gate', () => {
    const qualityGates = { rules: [{ bogus: 1 }] } as unknown as QualityGateConfig;
    expect(() => new SmartReporter({ qualityGates })).toThrow(new Error(
      'unknown key "bogus" in quality gate rules[0]. Known keys: id, scope, severity, maxFailures, minPassRate, maxFlakyRate, minStabilityGrade, noNewFailures, maxA11yViolations, maxA11yCritical, maxA11ySerious, minCoverage, maxDurationRegression, noNewFlaky, noNewClusters, noExpiredQuarantine.',
    ));
  });
});

describe('mergeHistories', () => {
  let dir: string;
  const file = (name: string) => path.join(dir, name);
  const write = (name: string, history: unknown) => {
    fs.writeFileSync(file(name), typeof history === 'string' ? history : JSON.stringify(history));
    return file(name);
  };
  const read = (name: string): TestHistory => JSON.parse(fs.readFileSync(file(name), 'utf8'));

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-merge-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('merges multiple history files', () => {
    const history1: TestHistory = {
      runs: [{ runId: 'run-1', timestamp: '2024-01-01T10:00:00Z' }],
      tests: {
        'test-1': [{ passed: true, duration: 1000, timestamp: '2024-01-01T10:00:00Z' }],
      },
      summaries: [{
        runId: 'run-1',
        timestamp: '2024-01-01T10:00:00Z',
        total: 1, passed: 1, failed: 0, skipped: 0,
        flaky: 0, slow: 0, duration: 1000, passRate: 100,
      }],
    };

    const history2: TestHistory = {
      runs: [{ runId: 'run-2', timestamp: '2024-01-02T10:00:00Z' }],
      tests: {
        'test-1': [{ passed: false, duration: 1200, timestamp: '2024-01-02T10:00:00Z' }],
        'test-2': [{ passed: true, duration: 800, timestamp: '2024-01-02T10:00:00Z' }],
      },
      summaries: [{
        runId: 'run-2',
        timestamp: '2024-01-02T10:00:00Z',
        total: 2, passed: 1, failed: 1, skipped: 0,
        flaky: 0, slow: 0, duration: 2000, passRate: 50,
      }],
    };

    mergeHistories([write('history1.json', history1), write('history2.json', history2)], file('output.json'));

    const result = read('output.json');

    // Check runs are merged and sorted by timestamp
    expect(result.runs.length).toBe(2);
    expect(result.runs[0].runId).toBe('run-1');
    expect(result.runs[1].runId).toBe('run-2');

    // Check tests are merged
    expect(Object.keys(result.tests).length).toBe(2);
    expect(result.tests['test-1'].length).toBe(2);
    expect(result.tests['test-2'].length).toBe(1);

    // Check summaries are merged
    expect(result.summaries!.length).toBe(2);
  });

  it('deduplicates runs by runId', () => {
    const history: TestHistory = {
      runs: [
        { runId: 'run-1', timestamp: '2024-01-01T10:00:00Z' },
        { runId: 'run-1', timestamp: '2024-01-01T10:00:00Z' }, // Duplicate
      ],
      tests: {},
      summaries: [],
    };

    mergeHistories([write('history.json', history)], file('output.json'));

    const result = read('output.json');

    expect(result.runs.length).toBe(1);
  });

  it('respects maxHistoryRuns limit', () => {
    const history: TestHistory = {
      runs: Array(15).fill(null).map((_, i) => ({
        runId: `run-${i}`,
        timestamp: new Date(2024, 0, i + 1).toISOString(),
      })),
      tests: {
        'test-1': Array(15).fill(null).map((_, i) => ({
          passed: true,
          duration: 1000,
          timestamp: new Date(2024, 0, i + 1).toISOString(),
        })),
      },
      summaries: Array(15).fill(null).map((_, i) => ({
        runId: `run-${i}`,
        timestamp: new Date(2024, 0, i + 1).toISOString(),
        total: 1, passed: 1, failed: 0, skipped: 0,
        flaky: 0, slow: 0, duration: 1000, passRate: 100,
      })),
    };

    mergeHistories([write('history.json', history)], file('output.json'), 10);

    const result = read('output.json');

    expect(result.runs.length).toBe(10);
    expect(result.tests['test-1'].length).toBe(10);
    expect(result.summaries!.length).toBe(10);
  });

  it('warns when history file not found', () => {
    mergeHistories([file('nonexistent.json')], file('output.json'));

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('handles parse errors gracefully', () => {
    const bad = write('bad.json', 'invalid json');

    // Should not throw
    expect(() => {
      mergeHistories([bad], file('output.json'));
    }).not.toThrow();

    expect(console.error).toHaveBeenCalledWith(`Failed to parse history file ${bad}:`, expect.any(Error));
  });

  it('uses default maxHistoryRuns of 10', () => {
    const history: TestHistory = {
      runs: Array(20).fill(null).map((_, i) => ({
        runId: `run-${i}`,
        timestamp: new Date(2024, 0, i + 1).toISOString(),
      })),
      tests: {},
      summaries: [],
    };

    mergeHistories([write('history.json', history)], file('output.json'));

    const result = read('output.json');

    expect(result.runs.length).toBe(10);
  });

  it('sorts entries by timestamp before slicing', () => {
    const history: TestHistory = {
      runs: [
        { runId: 'run-3', timestamp: '2024-01-03T10:00:00Z' },
        { runId: 'run-1', timestamp: '2024-01-01T10:00:00Z' },
        { runId: 'run-2', timestamp: '2024-01-02T10:00:00Z' },
      ],
      tests: {},
      summaries: [],
    };

    mergeHistories([write('history.json', history)], file('output.json'));

    const result = read('output.json');

    expect(result.runs[0].runId).toBe('run-1');
    expect(result.runs[1].runId).toBe('run-2');
    expect(result.runs[2].runId).toBe('run-3');
  });

  it('handles empty history files', () => {
    const history: TestHistory = {
      runs: [],
      tests: {},
      summaries: [],
    };

    mergeHistories([write('empty.json', history)], file('output.json'));

    const result = read('output.json');

    expect(result.runs).toEqual([]);
    expect(result.tests).toEqual({});
    expect(result.summaries).toEqual([]);
  });

  // #57: the same merge as the merge-history bin
  describe('shards restored from one history', () => {
    const at = (day: number) => `2024-01-0${day}T10:00:00.000Z`;
    const entry = (day: number): TestHistoryEntry => ({ passed: true, duration: 100, timestamp: at(day), runId: `run-${day}` });
    const summary = (day: number, total: number, duration = 100): RunSummary => ({
      runId: `run-${day}`, timestamp: at(day), total, passed: total, failed: 0, skipped: 0, flaky: 0, slow: 0, duration, passRate: 100,
    });
    // Runs 1 and 2 ran tests a and b. Each shard restored them, then ran one of the tests in run 3.
    const base: TestHistory = { runs: [], tests: { a: [entry(1), entry(2)], b: [entry(1), entry(2)] }, summaries: [summary(1, 2), summary(2, 2)] };
    const shard = (test: 'a' | 'b'): TestHistory => ({
      ...base,
      tests: { ...base.tests, [test]: [...base.tests[test], entry(3)] },
      summaries: [...base.summaries!, summary(3, 1, test === 'a' ? 100 : 120)],
    });
    const counts = (h: TestHistory) => ({
      entries: Object.fromEntries(Object.entries(h.tests).map(([id, e]) => [id, e.length])),
      summaries: h.summaries!.map((s) => [s.runId, s.total]),
    });

    it('keeps each run of a test once and adds the shard summaries of run 3', () => {
      mergeHistories([write('shard1.json', shard('a')), write('shard2.json', shard('b'))], file('output.json'));

      expect(counts(read('output.json'))).toEqual({
        entries: { a: 3, b: 3 },
        summaries: [['run-1', 2], ['run-2', 2], ['run-3', 2]],
      });
    });

    it('gives the same history for one file merged twice as for it merged once', () => {
      const once = write('shard1.json', shard('a'));
      mergeHistories([once], file('once.json'));
      mergeHistories([once, once], file('twice.json'));

      expect(counts(read('twice.json'))).toEqual({ entries: { a: 3, b: 2 }, summaries: [['run-1', 2], ['run-2', 2], ['run-3', 1]] });
      expect(read('twice.json')).toEqual(read('once.json'));
    });

    it('keeps the forecasts and drilldown snapshots of every run', () => {
      const one: TestHistory = { ...shard('a'), forecasts: { 'run-2': { a: 0.4 }, 'run-3': { a: 0.7 } } };
      const two: TestHistory = { ...shard('b'), forecasts: { 'run-2': { a: 0.4 }, 'run-3': { b: 0.2 } } };
      const drilldown = { runs: [{ runId: 'run-1', timestamp: at(1) }], runFiles: { 'run-1': './history-runs/run-1.json' } };

      mergeHistories([write('shard1.json', { ...one, ...drilldown }), write('shard2.json', two)], file('output.json'));

      const merged = read('output.json');
      expect(merged.forecasts).toEqual({ 'run-2': { a: 0.4 }, 'run-3': { a: 0.7, b: 0.2 } });
      expect(merged.runFiles).toEqual({ 'run-1': './history-runs/run-1.json' });
    });

    it('drops the forecasts and drilldown snapshots of runs that maxHistoryRuns leaves out', () => {
      const history: TestHistory = {
        ...shard('a'),
        runs: [1, 2, 3].map((day) => ({ runId: `run-${day}`, timestamp: at(day) })),
        runFiles: { 'run-1': './history-runs/run-1.json', 'run-3': './history-runs/run-3.json' },
        forecasts: { 'run-1': { a: 0.1 }, 'run-3': { a: 0.7 } },
      };

      mergeHistories([write('history.json', history)], file('output.json'), 2);

      const merged = read('output.json');
      expect(merged.summaries!.map((s) => s.runId)).toEqual(['run-2', 'run-3']);
      expect(merged.forecasts).toEqual({ 'run-3': { a: 0.7 } });
      expect(merged.runFiles).toEqual({ 'run-3': './history-runs/run-3.json' });
    });

    // #67: run files copied beside a history file merge with it
    it('reads the run files in the .runs folder beside each history file', () => {
      fs.mkdirSync(file('history.runs'));
      for (const [n, test] of [[1, 'a'], [2, 'b']] as const) {
        const run: HistoryRunFile = { version: 1, summary: summary(3, 1), tests: { [test]: entry(3) } };
        write(`history.runs/run-3.shard-${n}-of-2.json`, run);
      }

      mergeHistories([write('history.json', base)], file('output.json'));

      expect(counts(read('output.json'))).toEqual({ entries: { a: 3, b: 3 }, summaries: [['run-1', 2], ['run-2', 2], ['run-3', 2]] });
    });
  });
});

describe('commits of a new failure', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smart-commits-')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // One GitHub run of one test at the commit c repeated, read back from the JSON export
  async function run(c: string, status: 'passed' | 'failed', options: SmartReporterOptions = {}): Promise<JsonExportData> {
    const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '', GITHUB_SHA: c.repeat(40), GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop' };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const results: TestResult[] = [];
    const test = {
      id: 'checkout', title: 'checkout', retries: 0, expectedStatus: 'passed', results, repeatEachIndex: 0, tags: [], annotations: [],
      location: { file: path.join(dir, 'checkout.spec.ts'), line: 1, column: 1 },
      titlePath: () => ['', 'checkout.spec.ts', 'checkout'],
      outcome: () => (status === 'passed' ? 'expected' : 'unexpected'),
    } as unknown as TestCase;
    const reporter = new SmartReporter({ exportJson: true, runId: c, ...options });
    reporter.onBegin({ rootDir: dir } as FullConfig, { allTests: () => [test] } as unknown as Suite);
    const result = {
      retry: 0, status, duration: 5, startTime: new Date(), errors: status === 'failed' ? [{ message: 'Error: checkout broke' }] : [],
      attachments: [], steps: [], stdout: [], stderr: [],
    } as unknown as TestResult;
    results.push(result);
    await reporter.onTestEnd(test, result);
    await reporter.onEnd({ status, duration: 5 } as FullResult);
    return JSON.parse(fs.readFileSync(path.join(dir, 'smart-report-data.json'), 'utf8'));
  }

  const RANGE = {
    lastPassed: { commit: 'bbbbbbbb', sha: 'b'.repeat(40) },
    firstFailed: { commit: 'cccccccc', sha: 'c'.repeat(40) },
    url: `https://github.com/acme/shop/compare/${'b'.repeat(40)}...${'c'.repeat(40)}`,
  };

  it('gives a test that fails in run 3 the commits from run 2 to run 3, and its cluster the same, without calling git', async () => {
    vi.mocked(execFileSync).mockClear();
    await run('a', 'passed');
    await run('b', 'passed');
    const json = await run('c', 'failed');

    expect([json.tests[0].commits, json.failureClusters?.[0].tracking?.commits]).toEqual([RANGE, RANGE]);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it('with suspects, asks git once for the files changed in that range, and keeps the range when git cannot tell', async () => {
    await run('a', 'passed', { suspects: true });
    await run('b', 'passed', { suspects: true });
    vi.mocked(execFileSync).mockClear();
    const json = await run('c', 'failed', { suspects: true });

    expect([json.tests[0].commits, json.failureClusters?.[0].tracking?.commits]).toEqual([RANGE, RANGE]);
    expect(vi.mocked(execFileSync).mock.calls.filter((c) => c[1]?.includes('diff')).map((c) => c[1])).toEqual([
      ['-C', dir, 'diff', '--name-only', '-z', `${'b'.repeat(40)}..${'c'.repeat(40)}`],
    ]);
  });
});
