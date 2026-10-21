import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { once } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryCollector } from './history-collector';
import type { HistoryRunFile, RunSummary, TestHistory, TestResultData, SmartReporterOptions } from '../types';

// Real files in a temp folder. writeFileSync is wrapped so one test can make a write fail part-way.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test 1',
    file: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

const summary = (runId: string, timestamp: string): RunSummary => ({
  runId, timestamp, total: 1, passed: 1, failed: 0, skipped: 0, flaky: 0, slow: 0, duration: 1, passRate: 100,
});

describe('HistoryCollector', () => {
  let outputDir: string;
  let historyPath: string;
  const runsDir = () => path.join(outputDir, 'test-history.runs');
  const saveHistory = (history: unknown) => fs.writeFileSync(historyPath, typeof history === 'string' ? history : JSON.stringify(history));
  const savedHistory = (dir = outputDir): TestHistory => JSON.parse(fs.readFileSync(path.join(dir, 'test-history.json'), 'utf8'));
  // One run: a reporter loads the history when the run begins and saves it when the run ends
  const runIn = (dir: string, options: SmartReporterOptions, results: TestResultData[], shard: { current: number; total: number } | null = null) => {
    const collector = new HistoryCollector(options, dir, shard);
    collector.loadHistory();
    collector.updateHistory(results);
    return collector;
  };

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-history-'));
    historyPath = path.join(outputDir, 'test-history.json');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('sets default options', () => {
      const collector = new HistoryCollector({}, outputDir);

      expect(collector.getOptions().outputFile).toBe('smart-report.html');
      expect(collector.getOptions().historyFile).toBe('test-history.json');
      expect(collector.getOptions().maxHistoryRuns).toBe(10);
      expect(collector.getOptions().performanceThreshold).toBe(0.2);
    });

    it('uses provided options', () => {
      const options: SmartReporterOptions = {
        outputFile: 'custom-report.html',
        historyFile: 'custom-history.json',
        maxHistoryRuns: 20,
        performanceThreshold: 0.5,
      };

      const collector = new HistoryCollector(options, outputDir);

      expect(collector.getOptions().outputFile).toBe('custom-report.html');
      expect(collector.getOptions().historyFile).toBe('custom-history.json');
      expect(collector.getOptions().maxHistoryRuns).toBe(20);
      expect(collector.getOptions().performanceThreshold).toBe(0.5);
    });

    it('generates unique run ID', () => {
      const collector1 = new HistoryCollector({}, outputDir);
      // Small delay to ensure different timestamp
      const collector2 = new HistoryCollector({}, outputDir);

      expect(collector1.getCurrentRun().runId).toMatch(/^run-\d+$/);
      expect(collector2.getCurrentRun().runId).toMatch(/^run-\d+$/);
    });

    it('uses a pre-provided run ID if supplied', () => {
      const collector1 = new HistoryCollector({ runId: '123' }, outputDir);
      const collector2 = new HistoryCollector({ runId: '123' }, outputDir);
      expect(collector1.getCurrentRun().runId).toEqual('run-123');
      expect(collector1.getCurrentRun().runId).toEqual(collector2.getCurrentRun().runId);
    });
  });

  describe('loadHistory', () => {
    it('loads history from disk when file exists', () => {
      const existingHistory: TestHistory = {
        runs: [{ runId: 'run-1', timestamp: '2024-01-01T10:00:00Z' }],
        tests: { 'test-1': [{ passed: true, duration: 1000, timestamp: '2024-01-01T10:00:00Z' }] },
        summaries: [],
      };

      saveHistory(existingHistory);

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getHistory();
      expect(history.runs.length).toBe(1);
      expect(history.tests['test-1'].length).toBe(1);
    });

    it('initializes empty history when file does not exist', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getHistory();
      expect(history.runs).toEqual([]);
      expect(history.tests).toEqual({});
      expect(history.summaries).toEqual([]);
    });

    it('converts old format (tests only) to new format', () => {
      const oldFormat = {
        'test-1': [{ passed: true, duration: 1000, timestamp: '2024-01-01T10:00:00Z' }],
      };

      saveHistory(oldFormat);

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getHistory();
      expect(history.runs).toEqual([]);
      expect(history.tests['test-1']).toBeDefined();
      expect(history.summaries).toEqual([]);
    });

    it('handles parse errors gracefully', () => {
      saveHistory('invalid json');

      const collector = new HistoryCollector({}, outputDir);

      // Should not throw
      expect(() => collector.loadHistory()).not.toThrow();

      expect(console.warn).toHaveBeenCalled();
      expect(collector.getHistory().tests).toEqual({});
    });
  });

  describe('adoptLegacyIds', () => {
    const old = { passed: false, duration: 5, timestamp: '2024-01-01T10:00:00Z' };
    const kept = { passed: true, duration: 7, timestamp: '2024-01-02T10:00:00Z' };

    function load(tests: TestHistory['tests']): HistoryCollector {
      saveHistory({ runs: [], tests, summaries: [] });
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();
      return collector;
    }

    it('copies an old id shared by two tests to both, removes it, and keeps history already under a new id', () => {
      const collector = load({ 'a.spec.ts::t': [old], 'a.spec.ts::B › t': [kept], 'b.spec.ts::u': [old] });

      collector.adoptLegacyIds(new Map([['a.spec.ts::A › t', 'a.spec.ts::t'], ['a.spec.ts::B › t', 'a.spec.ts::t']]));

      expect(collector.getHistory().tests).toEqual({ 'a.spec.ts::A › t': [old], 'a.spec.ts::B › t': [kept], 'b.spec.ts::u': [old] });
    });

    it('leaves an old id that is still a current id with its test', () => {
      const collector = load({ 'a.spec.ts::t': [old] });

      collector.adoptLegacyIds(new Map([['a.spec.ts::t', 'a.spec.ts::t'], ['a.spec.ts::A › t', 'a.spec.ts::t']]));

      expect(collector.getHistory().tests).toEqual({ 'a.spec.ts::t': [old] });
    });
  });

  describe('getTestHistory', () => {
    it('returns empty array for unknown test', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      expect(collector.getTestHistory('unknown-test')).toEqual([]);
    });

    it('returns history for known test', () => {
      const existingHistory: TestHistory = {
        runs: [],
        tests: {
          'test-1': [
            { passed: true, duration: 1000, timestamp: '2024-01-01T10:00:00Z' },
            { passed: false, duration: 1200, timestamp: '2024-01-02T10:00:00Z' },
          ],
        },
        summaries: [],
      };

      saveHistory(existingHistory);

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getTestHistory('test-1');
      expect(history.length).toBe(2);
      expect(history[0].passed).toBe(true);
      expect(history[1].passed).toBe(false);
    });
  });

  describe('updateHistory', () => {
    it('adds test results to history', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const results = [
        createTestResult({ testId: 'test-1', status: 'passed', duration: 1000 }),
        createTestResult({ testId: 'test-2', status: 'failed', duration: 1500 }),
      ];

      collector.updateHistory(results);

      const history = collector.getHistory();
      expect(history.tests['test-1'].length).toBe(1);
      expect(history.tests['test-2'].length).toBe(1);
      expect(history.tests['test-1'][0].passed).toBe(true);
      expect(history.tests['test-2'][0].passed).toBe(false);
    });

    it('tracks retry count in history', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const results = [
        createTestResult({ testId: 'test-1', status: 'passed', retry: 2 }),
      ];

      collector.updateHistory(results);

      const history = collector.getHistory();
      expect(history.tests['test-1'][0].retry).toBe(2);
    });

    it('records the time spent in the attempts Playwright retried as retry waste', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const attempt = (retry: number, duration: number, status: TestResultData['status'] = 'failed') => ({ retry, status, duration, steps: [] });
      collector.updateHistory([
        createTestResult({ testId: 'test-1', retry: 2, duration: 50, attempts: [attempt(0, 1200), attempt(1, 300), attempt(2, 50, 'passed')] }),
        createTestResult({ testId: 'test-2', attempts: [attempt(0, 1000, 'passed')] }),
      ]);

      const { tests } = collector.getHistory();
      expect(tests['test-1'][0].retryWaste).toBe(1500);
      expect('retryWaste' in tests['test-2'][0]).toBe(false);
    });

    it('records test.step durations as the slow-step baseline', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      collector.updateHistory([
        createTestResult({
          testId: 'test-1',
          steps: [
            { title: 'load orders', duration: 42, category: 'test.step', startTime: 160 },
            { title: 'Click', duration: 39, category: 'pw:api', startTime: 161 },
          ],
        }),
        createTestResult({ testId: 'test-2', steps: [{ title: 'Click', duration: 39, category: 'pw:api' }] }),
      ]);

      const history = collector.getHistory();
      expect(history.tests['test-1'][0].stepDurations).toEqual({ 'load orders': 42 });
      expect('stepDurations' in history.tests['test-2'][0]).toBe(false);
    });

    it('does not record step durations when the causal timeline is disabled', () => {
      const collector = new HistoryCollector({ enableCausalTimeline: false }, outputDir);
      collector.loadHistory();

      collector.updateHistory([
        createTestResult({ testId: 'test-1', steps: [{ title: 'load orders', duration: 42, category: 'test.step' }] }),
      ]);

      expect('stepDurations' in collector.getHistory().tests['test-1'][0]).toBe(false);
    });

    it('saves the cluster id of a failed test that is in a cluster', () => {
      const collector = runIn(outputDir, {}, [
        createTestResult({ testId: 'test-1', status: 'failed', failureCluster: { id: '0123456789abcdef', errorType: 'x', count: 1, tests: [] } }),
        createTestResult({ testId: 'test-2', status: 'passed' }),
      ]);

      const tests = collector.getHistory().tests;
      expect(tests['test-1'][0].clusterId).toBe('0123456789abcdef');
      expect('clusterId' in tests['test-2'][0]).toBe(false);
    });

    it('marks skipped tests in history', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const results = [
        createTestResult({ testId: 'test-1', status: 'skipped' }),
      ];

      collector.updateHistory(results);

      const history = collector.getHistory();
      expect(history.tests['test-1'][0].skipped).toBe(true);
    });

    it('respects maxHistoryRuns limit', () => {
      // 5 runs of the same test
      for (let i = 0; i < 5; i++) {
        runIn(outputDir, { maxHistoryRuns: 3, runId: `${i}` }, [createTestResult({ testId: 'test-1', status: 'passed', duration: 1000 + i })]);
      }

      const history = savedHistory();
      expect(history.tests['test-1'].map((e) => e.duration)).toEqual([1002, 1003, 1004]);
    });

    it('creates run summary', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ status: 'passed', outcome: 'flaky', flakinessScore: 0.5 }),
        createTestResult({ status: 'failed' }),
        createTestResult({ status: 'skipped' }),
        createTestResult({ status: 'passed', performanceTrend: '↑ 50% slower' }),
      ];

      collector.updateHistory(results);

      const history = collector.getHistory();
      expect(history.summaries!.length).toBe(1);

      const summary = history.summaries![0];
      expect(summary.total).toBe(5);
      expect(summary.passed).toBe(3);
      expect(summary.failed).toBe(1);
      expect(summary.skipped).toBe(1);
      expect(summary.flaky).toBe(1);
      expect(summary.slow).toBe(1);
    });

    it('records the run stability grade (the rounded average of test grades) in the summary', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();
      const graded = (grade: 'A' | 'B' | 'C' | 'D' | 'F') =>
        createTestResult({ stabilityScore: { overall: 0, flakiness: 0, performance: 0, reliability: 0, grade, needsAttention: false } });

      collector.updateHistory([graded('A'), graded('A'), graded('C'), graded('D'), createTestResult()]);

      expect(collector.getHistory().summaries![0].stabilityGrade).toBe('B');
    });

    it('writes history to disk', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult()]);

      expect(Object.keys(savedHistory().tests)).toEqual(['test-1']);
      expect(savedHistory()).toEqual(collector.getHistory());
    });

    // merge-reports builds the collector at merge time; the reporter then passes the run's own start.
    describe('run clock', () => {
      const T0 = Date.parse('2026-10-16T12:00:00.000Z');
      beforeEach(() => vi.useFakeTimers({ now: T0 }));
      afterEach(() => vi.useRealTimers());

      it('saves the duration, start and id of the run, not of the merge', () => {
        const collector = new HistoryCollector({}, outputDir);
        collector.loadHistory();
        vi.advanceTimersByTime(50);
        const runStart = Date.now() - 600_000;

        collector.setRunStart(runStart);
        collector.updateHistory([createTestResult()]);

        const { runId, timestamp, duration } = collector.getHistory().summaries![0];
        expect({ runId, timestamp, duration }).toEqual({ runId: `run-${runStart}`, timestamp: '2026-10-16T11:50:00.050Z', duration: 600_000 });
        expect(collector.getCurrentRun()).toEqual({ runId: `run-${runStart}`, timestamp: '2026-10-16T11:50:00.050Z' });
        expect(collector.getHistory().tests['test-1'][0].runId).toBe(`run-${runStart}`);
      });

      it('keeps the runId option as the run id', () => {
        const collector = new HistoryCollector({ runId: 'ci-7' }, outputDir);
        collector.loadHistory();
        vi.advanceTimersByTime(50);

        collector.setRunStart(Date.now() - 600_000);
        collector.updateHistory([createTestResult()]);

        const { runId, timestamp, duration } = collector.getHistory().summaries![0];
        expect({ runId, timestamp, duration }).toEqual({ runId: 'run-ci-7', timestamp: '2026-10-16T11:50:00.050Z', duration: 600_000 });
      });
    });

    it('records forecast risks under the current run id', () => {
      const collector = new HistoryCollector({ runId: '42' }, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult({ testId: 'a' })], { a: 0.7 });

      expect(savedHistory().forecasts).toEqual({ 'run-42': { a: 0.7 } });
    });

    it('leaves the history file without forecasts when none are passed', () => {
      const collector = new HistoryCollector({ runId: '42' }, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult({ testId: 'a' })]);

      expect(Object.keys(savedHistory()).sort()).toEqual(['runs', 'summaries', 'tests']);
    });

    it('prunes recorded forecasts to maxHistoryRuns, oldest first', () => {
      saveHistory({
        runs: [], tests: {},
        summaries: [summary('run-a', '2024-01-01T10:00:00Z'), summary('run-b', '2024-01-02T10:00:00Z'), summary('run-c', '2024-01-03T10:00:00Z')],
        forecasts: { 'run-a': { x: 0.1 }, 'run-b': { x: 0.2 }, 'run-c': { x: 0.3 } },
      });
      const collector = new HistoryCollector({ runId: '42', maxHistoryRuns: 3 }, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult({ testId: 'x' })], { x: 0.9 });

      expect(collector.getHistory().forecasts).toEqual({ 'run-b': { x: 0.2 }, 'run-c': { x: 0.3 }, 'run-42': { x: 0.9 } });
      expect(Object.keys(collector.getHistory().forecasts!)).toEqual(['run-b', 'run-c', 'run-42']);
    });
  });

  describe('saving', () => {
    it('leaves the saved history whole when the index write fails part-way, and keeps the run file', async () => {
      const realFs = await vi.importActual<typeof fs>('fs');
      const saved: TestHistory = { runs: [], tests: { a: [{ passed: true, duration: 1, timestamp: '2026-01-01T00:00:00.000Z' }] }, summaries: [] };
      saveHistory(saved);
      // A crash or a full disk part-way through writing the index
      vi.mocked(fs.writeFileSync).mockImplementation((file, data) => {
        if (!String(file).startsWith(`${historyPath}.`)) return realFs.writeFileSync(file, data);
        realFs.writeFileSync(file, String(data).slice(0, 10));
        throw new Error('ENOSPC: no space left on device');
      });

      const collector = new HistoryCollector({ runId: 'b' }, outputDir);
      collector.loadHistory();
      expect(() => collector.updateHistory([createTestResult({ testId: 'b' })])).toThrow('ENOSPC');

      expect(savedHistory()).toEqual(saved);
      expect(fs.readdirSync(outputDir).sort()).toEqual(['test-history.json', 'test-history.runs']);
      expect(fs.readdirSync(runsDir())).toEqual(['run-b.json']);
    });
  });

  // #58, #67: each run writes its own file, and the index is rebuilt from the run files under a lock
  describe('run files', () => {
    it('keeps both runs when two runs load the history before either saves it', () => {
      const a = new HistoryCollector({ runId: 'A' }, outputDir);
      const b = new HistoryCollector({ runId: 'B' }, outputDir);
      a.loadHistory();
      b.loadHistory();

      a.updateHistory([createTestResult({ testId: 't' })]);
      b.updateHistory([createTestResult({ testId: 't', status: 'failed' })]);

      expect(savedHistory().summaries!.map((s) => s.runId)).toEqual(['run-A', 'run-B']);
      expect(savedHistory().tests.t.map((e) => [e.runId, e.passed])).toEqual([['run-A', true], ['run-B', false]]);
    });

    it('replaces a run that runs again with the same runId', () => {
      runIn(outputDir, { runId: 'ci-7', enableHistoryDrilldown: true }, [createTestResult({ testId: 't', status: 'failed' })]);
      runIn(outputDir, { runId: 'ci-7', enableHistoryDrilldown: true }, [createTestResult({ testId: 't', status: 'passed' })]);

      const history = savedHistory();
      expect(history.summaries!.map((s) => [s.runId, s.passed, s.failed])).toEqual([['run-ci-7', 1, 0]]);
      expect(history.tests.t.map((e) => e.passed)).toEqual([true]);
      expect(history.runs.map((r) => r.runId)).toEqual(['run-ci-7']);
      expect(fs.readdirSync(runsDir())).toEqual(['run-ci-7.json']);
    });

    it('combines the shard run files of one run into one summary', () => {
      runIn(outputDir, { runId: 'ci-3' }, [createTestResult({ testId: 'a' }), createTestResult({ testId: 'b', status: 'failed' })], { current: 1, total: 2 });
      runIn(outputDir, { runId: 'ci-3' }, [createTestResult({ testId: 'c' })], { current: 2, total: 2 });

      const history = savedHistory();
      expect(history.summaries!.map((s) => [s.runId, s.total, s.passed, s.failed])).toEqual([['run-ci-3', 3, 2, 1]]);
      expect(Object.keys(history.tests).sort()).toEqual(['a', 'b', 'c']);
      expect(fs.readdirSync(runsDir()).sort()).toEqual(['run-ci-3.shard-1-of-2.json', 'run-ci-3.shard-2-of-2.json']);
    });

    it('rebuilds a deleted index from the run files, the same as the index it replaces', () => {
      const copy = `${outputDir}-copy`;
      const T0 = Date.parse('2026-10-16T12:00:00.000Z');
      const results = [createTestResult({ testId: 'a' }), createTestResult({ testId: 'b', status: 'failed' })];
      const run = (dir: string, n: number) => {
        vi.setSystemTime(T0 + n * 60_000);
        const collector = new HistoryCollector({ runId: `${n}` }, dir);
        collector.loadHistory();
        collector.updateHistory(results, { b: n / 10 });
      };
      vi.useFakeTimers();
      try {
        for (const n of [1, 2, 3]) run(outputDir, n);
        fs.cpSync(outputDir, copy, { recursive: true });
        fs.rmSync(path.join(copy, 'test-history.json'));

        run(outputDir, 4);
        run(copy, 4);

        expect(savedHistory(copy).summaries!.map((s) => s.runId)).toEqual(['run-1', 'run-2', 'run-3', 'run-4']);
        expect(savedHistory(copy)).toEqual(savedHistory());
      } finally {
        vi.useRealTimers();
        fs.rmSync(copy, { recursive: true, force: true });
      }
    });

    it('reads run files that the index does not list yet, so run files copied into the folder merge', () => {
      saveHistory({
        runs: [],
        tests: { t: [{ passed: true, duration: 4, timestamp: '2026-10-16T12:00:01.000Z', runId: 'run-a' }] },
        summaries: [summary('run-a', '2026-10-16T12:00:00.000Z')],
      });
      const copied: HistoryRunFile = {
        version: 1,
        summary: summary('run-b', '2026-10-16T13:00:00.000Z'),
        tests: { t: { passed: false, duration: 5, timestamp: '2026-10-16T13:00:01.000Z', runId: 'run-b' } },
      };
      fs.mkdirSync(runsDir());
      fs.writeFileSync(path.join(runsDir(), 'run-b.json'), JSON.stringify(copied));

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      expect(collector.getHistory().summaries!.map((s) => s.runId)).toEqual(['run-a', 'run-b']);
      expect(collector.getTestHistory('t').map((e) => e.passed)).toEqual([true, false]);
    });

    it('deletes the run files and drilldown snapshots of runs that maxHistoryRuns leaves out', () => {
      for (const n of [1, 2, 3, 4]) runIn(outputDir, { runId: `${n}`, maxHistoryRuns: 2, enableHistoryDrilldown: true }, [createTestResult()]);

      expect(savedHistory().summaries!.map((s) => s.runId)).toEqual(['run-3', 'run-4']);
      expect(fs.readdirSync(runsDir()).sort()).toEqual(['run-3.json', 'run-4.json']);
      expect(fs.readdirSync(path.join(outputDir, 'history-runs')).sort()).toEqual(['run-3.json', 'run-4.json']);
    });

    it('with drilldown, deletes the snapshots of its runs that the index does not list, and leaves other files', () => {
      const snapshots = path.join(outputDir, 'history-runs');
      fs.mkdirSync(snapshots);
      // A lost update left run-1's snapshot without its index entry. run-other.json belongs to another history file.
      for (const name of ['run-1.json', 'run-other.json']) fs.writeFileSync(path.join(snapshots, name), '{}');
      saveHistory({ runs: [{ runId: 'run-1', timestamp: '2026-10-16T12:00:00.000Z' }], tests: {}, summaries: [summary('run-1', '2026-10-16T12:00:00.000Z')] });

      runIn(outputDir, { runId: '2', enableHistoryDrilldown: true }, [createTestResult()]);

      expect(fs.readdirSync(snapshots).sort()).toEqual(['run-2.json', 'run-other.json']);
      expect(savedHistory().runFiles).toEqual({ 'run-2': './history-runs/run-2.json' });
    });

    describe('lock', () => {
      const lockPath = () => `${historyPath}.lock`;

      it('takes over a lock older than 30 s, which a crashed run left behind', () => {
        fs.writeFileSync(lockPath(), '');
        const old = (Date.now() - 31_000) / 1000;
        fs.utimesSync(lockPath(), old, old);

        runIn(outputDir, { runId: 'x' }, [createTestResult()]);

        expect(savedHistory().summaries!.map((s) => s.runId)).toEqual(['run-x']);
        expect(fs.existsSync(lockPath())).toBe(false);
      });

      it('waits for a fresh lock until the run that holds it lets go', async () => {
        fs.writeFileSync(lockPath(), '');
        const holder = spawn(process.execPath, ['-e', `setTimeout(() => require('fs').unlinkSync(${JSON.stringify(lockPath())}), 500)`]);
        const start = Date.now();

        runIn(outputDir, { runId: 'x' }, [createTestResult()]);

        expect(Date.now() - start).toBeGreaterThanOrEqual(500);
        // The holder could still delete its own lock, so the run did not take it over
        const [code] = await once(holder, 'exit');
        expect(code).toBe(0);
        expect(savedHistory().summaries!.map((s) => s.runId)).toEqual(['run-x']);
      });

      it('stops waiting for a fresh lock after 10 s, and keeps the run file for the next run', () => {
        fs.writeFileSync(lockPath(), '');
        const collector = new HistoryCollector({ runId: 'x' }, outputDir);
        collector.loadHistory();
        const start = Date.now();

        expect(() => collector.updateHistory([createTestResult()])).toThrow(`Timed out after 10 s waiting for ${lockPath()}`);

        expect(Date.now() - start).toBeGreaterThanOrEqual(10_000);
        expect(fs.existsSync(historyPath)).toBe(false);
        expect(fs.readdirSync(runsDir())).toEqual(['run-x.json']);
      }, 15_000);
    });
  });

  describe('getBaselineRun', () => {
    it('returns null when comparison is disabled', () => {
      const collector = new HistoryCollector({ enableComparison: false }, outputDir);
      collector.loadHistory();

      expect(collector.getBaselineRun()).toBeNull();
    });

    it('returns null when no summaries exist', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      expect(collector.getBaselineRun()).toBeNull();
    });

    it('returns the last summary as baseline', () => {
      const existingHistory: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          {
            runId: 'run-1',
            timestamp: '2024-01-01T10:00:00Z',
            total: 10, passed: 8, failed: 2, skipped: 0,
            flaky: 1, slow: 1, duration: 5000, passRate: 80,
          },
          {
            runId: 'run-2',
            timestamp: '2024-01-02T10:00:00Z',
            total: 10, passed: 9, failed: 1, skipped: 0,
            flaky: 0, slow: 0, duration: 4500, passRate: 90,
          },
        ],
      };

      saveHistory(existingHistory);

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const baseline = collector.getBaselineRun();
      expect(baseline?.runId).toBe('run-2');
    });

    it('returns specific baseline when baselineRunId is set', () => {
      const existingHistory: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          {
            runId: 'run-1',
            timestamp: '2024-01-01T10:00:00Z',
            total: 10, passed: 8, failed: 2, skipped: 0,
            flaky: 1, slow: 1, duration: 5000, passRate: 80,
          },
          {
            runId: 'run-2',
            timestamp: '2024-01-02T10:00:00Z',
            total: 10, passed: 9, failed: 1, skipped: 0,
            flaky: 0, slow: 0, duration: 4500, passRate: 90,
          },
        ],
      };

      saveHistory(existingHistory);

      const collector = new HistoryCollector({ baselineRunId: 'run-1' }, outputDir);
      collector.loadHistory();

      const baseline = collector.getBaselineRun();
      expect(baseline?.runId).toBe('run-1');
    });

    it('returns null when specified baselineRunId not found', () => {
      const existingHistory: TestHistory = {
        runs: [],
        tests: {},
        summaries: [{
          runId: 'run-1',
          timestamp: '2024-01-01T10:00:00Z',
          total: 10, passed: 8, failed: 2, skipped: 0,
          flaky: 1, slow: 1, duration: 5000, passRate: 80,
        }],
      };

      saveHistory(existingHistory);

      const collector = new HistoryCollector({ baselineRunId: 'nonexistent' }, outputDir);
      collector.loadHistory();

      expect(collector.getBaselineRun()).toBeNull();
    });

    describe('baseline.branch', () => {
      const runs = [['run-main-1', 'main'], ['run-pr-1', 'feature/cart'], ['run-main-2', 'main'], ['run-pr-2', 'feature/cart']];
      const load = (options: SmartReporterOptions) => {
        const collector = new HistoryCollector(options, outputDir);
        collector.loadHistory();
        return collector;
      };
      // A GitHub Actions run, a pull request into main when targetBranch is set
      const github = (targetBranch: string) => {
        vi.stubEnv('GITHUB_ACTIONS', 'true');
        vi.stubEnv('GITHUB_EVENT_PATH', '');
        vi.stubEnv('GITHUB_BASE_REF', targetBranch);
      };

      beforeEach(() => saveHistory({
        runs: [],
        summaries: runs.map(([runId, branch], i) => ({ ...summary(runId, `2024-01-0${i + 1}T10:00:00Z`), ciInfo: { provider: 'github', branch } })),
        tests: {
          'test-1': [
            ...runs.map(([runId], i) => ({ passed: true, duration: 1000, timestamp: `2024-01-0${i + 1}T10:00:00Z`, runId })),
            { passed: false, duration: 1000, timestamp: '2024-01-05T10:00:00Z' },
          ],
        },
      }));

      afterEach(() => vi.unstubAllEnvs());

      it('returns the latest run on the named branch', () => {
        expect(load({ baseline: { branch: 'main' } }).getBaselineRun()?.runId).toBe('run-main-2');
      });

      it("returns the latest run on the pull request's target branch for 'target'", () => {
        github('main');
        expect(load({ baseline: { branch: 'target' } }).getBaselineRun()?.runId).toBe('run-main-2');
      });

      it("returns the previous run, and says so, for 'target' on a run with no target branch", () => {
        github('');
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(load({ baseline: { branch: 'target' } }).getBaselineRun()?.runId).toBe('run-pr-2');
        expect(log.mock.calls).toEqual([["Smart Reporter: baseline.branch is 'target', but this run has no target branch, so it is compared with the previous run."]]);
      });

      it('returns null, and says so, when no run in history is on the branch', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(load({ baseline: { branch: 'release' } }).getBaselineRun()).toBeNull();
        expect(log.mock.calls).toEqual([["Smart Reporter: history has no run on the baseline branch 'release', so this run has no comparison."]]);
      });

      it('matches a Jenkins freestyle branch, which GIT_BRANCH records with its remote as origin/main', () => {
        saveHistory({
          runs: [],
          tests: {},
          summaries: [
            { ...summary('run-jenkins-main', '2024-01-01T10:00:00Z'), ciInfo: { provider: 'jenkins', branch: 'origin/main' } },
            { ...summary('run-jenkins-pr', '2024-01-02T10:00:00Z'), ciInfo: { provider: 'jenkins', branch: 'PR-5' } },
          ],
        });
        const baseline = (branch: string) => load({ baseline: { branch } }).getBaselineRun()?.runId;
        expect([baseline('main'), baseline('origin/main')]).toEqual(['run-jenkins-main', 'run-jenkins-main']);
      });

      it('with filterHistory, gives flakiness and performance only the entries of runs on the branch', () => {
        const runIds = (options: SmartReporterOptions) => load(options).getBaselineHistory('test-1').map((e) => e.runId);
        expect(runIds({ baseline: { branch: 'main', filterHistory: true } })).toEqual(['run-main-1', 'run-main-2']);
        expect(runIds({ baseline: { branch: 'main' } })).toEqual(['run-main-1', 'run-pr-1', 'run-main-2', 'run-pr-2', undefined]);
      });
    });
  });
});
