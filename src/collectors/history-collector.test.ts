import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
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
        createTestResult({ status: 'passed', flakinessScore: 0.5 }),
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

    it('writes history to disk', () => {
      const collector = new HistoryCollector({}, outputDir);
      collector.loadHistory();

      collector.updateHistory([createTestResult()]);

      expect(mockFs.writeFileSync).toHaveBeenCalled();
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
