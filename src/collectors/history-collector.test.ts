import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryCollector } from './history-collector';
import type { TestHistory, TestResultData, SmartReporterOptions } from '../types';

vi.mock('fs');

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

describe('HistoryCollector', () => {
  const mockFs = vi.mocked(fs);
  const outputDir = '/test/output';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingHistory));

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getHistory();
      expect(history.runs.length).toBe(1);
      expect(history.tests['test-1'].length).toBe(1);
    });

    it('initializes empty history when file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(oldFormat));

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getHistory();
      expect(history.runs).toEqual([]);
      expect(history.tests['test-1']).toBeDefined();
      expect(history.summaries).toEqual([]);
    });

    it('handles parse errors gracefully', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

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
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ runs: [], tests, summaries: [] }));
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
      mockFs.existsSync.mockReturnValue(false);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingHistory));

      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      const history = collector.getTestHistory('test-1');
      expect(history.length).toBe(2);
      expect(history[0].passed).toBe(true);
      expect(history[1].passed).toBe(false);
    });
  });

  describe('updateHistory', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.writeFileSync.mockImplementation(() => {});
    });

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
      const collector = new HistoryCollector({ maxHistoryRuns: 3 }, outputDir);
      collector.loadHistory();

      // Add 5 runs for the same test
      for (let i = 0; i < 5; i++) {
        const results = [
          createTestResult({ testId: 'test-1', status: 'passed', duration: 1000 + i }),
        ];
        collector.updateHistory(results);
      }

      const history = collector.getHistory();
      expect(history.tests['test-1'].length).toBe(3);
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

      expect(mockFs.writeFileSync).toHaveBeenCalled();
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

      const written: TestHistory = JSON.parse(String(mockFs.writeFileSync.mock.calls.at(-1)![1]));
      expect(written.forecasts).toEqual({ 'run-42': { a: 0.7 } });
    });

    it('leaves the history file without forecasts when none are passed', () => {
      const collector = new HistoryCollector({ runId: '42' }, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult({ testId: 'a' })]);

      const written = JSON.parse(String(mockFs.writeFileSync.mock.calls.at(-1)![1]));
      expect(Object.keys(written).sort()).toEqual(['runs', 'summaries', 'tests']);
    });

    it('prunes recorded forecasts to maxHistoryRuns, oldest first', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        runs: [], tests: {}, summaries: [],
        forecasts: { 'run-a': { x: 0.1 }, 'run-b': { x: 0.2 }, 'run-c': { x: 0.3 } },
      }));
      const collector = new HistoryCollector({ runId: '42', maxHistoryRuns: 3 }, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult({ testId: 'x' })], { x: 0.9 });

      expect(collector.getHistory().forecasts).toEqual({ 'run-b': { x: 0.2 }, 'run-c': { x: 0.3 }, 'run-42': { x: 0.9 } });
      expect(Object.keys(collector.getHistory().forecasts!)).toEqual(['run-b', 'run-c', 'run-42']);
    });
  });

  describe('saving', () => {
    it('leaves the saved history whole when a write fails part-way', async () => {
      const realFs = await vi.importActual<typeof fs>('fs');
      const dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'smart-history-'));
      const historyPath = path.join(dir, 'test-history.json');
      const saved: TestHistory = { runs: [], tests: { a: [{ passed: true, duration: 1, timestamp: '2026-01-01T00:00:00.000Z' }] }, summaries: [] };
      realFs.writeFileSync(historyPath, JSON.stringify(saved));
      mockFs.existsSync.mockImplementation(realFs.existsSync);
      mockFs.readFileSync.mockImplementation(realFs.readFileSync);
      mockFs.mkdirSync.mockImplementation(realFs.mkdirSync);
      mockFs.renameSync.mockImplementation(realFs.renameSync);
      mockFs.rmSync.mockImplementation(realFs.rmSync);
      // A crash or a full disk part-way through writing
      mockFs.writeFileSync.mockImplementation((file, data) => {
        realFs.writeFileSync(file, String(data).slice(0, 10));
        throw new Error('ENOSPC: no space left on device');
      });

      try {
        const collector = new HistoryCollector({}, dir);
        collector.loadHistory();
        expect(() => collector.updateHistory([createTestResult({ testId: 'b' })])).toThrow('ENOSPC');

        expect(JSON.parse(realFs.readFileSync(historyPath, 'utf8'))).toEqual(saved);
        expect(realFs.readdirSync(dir)).toEqual(['test-history.json']);
      } finally {
        realFs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('getBaselineRun', () => {
    it('returns null when comparison is disabled', () => {
      const collector = new HistoryCollector({ enableComparison: false }, outputDir);
      mockFs.existsSync.mockReturnValue(false);
      collector.loadHistory();

      expect(collector.getBaselineRun()).toBeNull();
    });

    it('returns null when no summaries exist', () => {
      mockFs.existsSync.mockReturnValue(false);

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingHistory));

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingHistory));

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

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(existingHistory));

      const collector = new HistoryCollector({ baselineRunId: 'nonexistent' }, outputDir);
      collector.loadHistory();

      expect(collector.getBaselineRun()).toBeNull();
    });
  });
});
