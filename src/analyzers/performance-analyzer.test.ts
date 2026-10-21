import { describe, it, expect } from 'vitest';
import { PerformanceAnalyzer } from './performance-analyzer';
import type { StepData, TestResultData, TestHistoryEntry } from '../types';

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

function createHistoryEntry(
  duration: number,
  { skipped = false, passed = true }: { skipped?: boolean; passed?: boolean } = {}
): TestHistoryEntry {
  return {
    passed,
    duration,
    timestamp: new Date().toISOString(),
    skipped,
  };
}

// The fewest passing runs in history that a trend is reported from (5 with this run).
const passes = (duration: number) => Array.from({ length: 4 }, () => createHistoryEntry(duration));

describe('PerformanceAnalyzer', () => {
  describe('with default threshold (20%)', () => {
    const analyzer = new PerformanceAnalyzer();

    describe('analyze', () => {
      it('marks skipped tests appropriately', () => {
        const test = createTestResult({ status: 'skipped' });
        analyzer.analyze(test, []);

        expect(test.performanceTrend).toBe('→ Skipped');
      });

      it('marks tests with no history as baseline', () => {
        const test = createTestResult();
        analyzer.analyze(test, []);

        expect(test.performanceTrend).toBe('→ Baseline');
      });

      it('marks tests with only skipped history as baseline', () => {
        const test = createTestResult();
        const history = [
          createHistoryEntry(1000, { skipped: true }),
          createHistoryEntry(1500, { skipped: true }),
        ];

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('→ Baseline');
      });

      it('marks stable performance (within threshold)', () => {
        const test = createTestResult({ duration: 1100 }); // 10% slower
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('→ Stable');
        expect(test.averageDuration).toBe(1000);
      });

      it('marks slower tests (above threshold)', () => {
        const test = createTestResult({ duration: 1500 }); // 50% slower
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('↑ 50% slower');
        expect(test.performanceMetrics?.isRegression).toBe(true);
        expect(test.performanceMetrics?.severity).toBe('medium');
      });

      it('marks faster tests (below negative threshold)', () => {
        const test = createTestResult({ duration: 500 }); // 50% faster
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('↓ 50% faster');
        expect(test.performanceMetrics?.isImprovement).toBe(true);
      });

      it('excludes skipped runs from calculations', () => {
        const test = createTestResult({ duration: 1000 });
        const history = [
          ...passes(2000),
          createHistoryEntry(5000, { skipped: true }), // skipped - ignored
        ];

        analyzer.analyze(test, history);

        expect(test.averageDuration).toBe(2000);
        expect(test.performanceTrend).toBe('↓ 50% faster');
      });

      it('takes the baseline from passing runs only, so a slow failure does not hide a regression', () => {
        const test = createTestResult({ duration: 5000 });
        const history = [
          ...passes(2000),
          createHistoryEntry(30000, { passed: false }),
        ];

        analyzer.analyze(test, history);

        expect(test.averageDuration).toBe(2000);
        expect(test.performanceMetrics?.averageDuration).toBe(2000);
        expect(test.performanceTrend).toBe('↑ 150% slower');
      });

      it('takes the median of passing runs, so one slow pass does not hide a regression', () => {
        const test = createTestResult({ duration: 5000 });
        const history = [
          createHistoryEntry(2000),
          createHistoryEntry(2000),
          createHistoryEntry(2000),
          createHistoryEntry(30000),
        ];

        analyzer.analyze(test, history);

        expect(test.averageDuration).toBe(2000);
        expect(test.performanceTrend).toBe('↑ 150% slower');
      });

      it('rounds the median of an even number of passing runs to whole ms', () => {
        const test = createTestResult({ duration: 1000 });
        analyzer.analyze(test, [1000, 1001, 1002, 5000].map((d) => createHistoryEntry(d)));

        expect(test.averageDuration).toBe(1002);
      });

      it('marks tests whose history has no passing run as baseline', () => {
        const test = createTestResult({ duration: 5000 });
        analyzer.analyze(test, [createHistoryEntry(1000, { passed: false }), createHistoryEntry(1000, { passed: false })]);

        expect(test.performanceTrend).toBe('→ Baseline');
        expect(test.averageDuration).toBeUndefined();
        expect(test.performanceMetrics).toBeUndefined();
      });

      it('does not count a short test as slower or faster when the change is under 250ms', () => {
        const slower = createTestResult({ duration: 155 }); // 63% slower, but only 60ms
        analyzer.analyze(slower, passes(95));
        expect(slower.performanceTrend).toBe('→ Stable');
        expect(slower.performanceMetrics?.isRegression).toBe(false);

        const faster = createTestResult({ duration: 300 }); // 40% faster, but only 200ms
        analyzer.analyze(faster, passes(500));
        expect(faster.performanceTrend).toBe('→ Stable');
        expect(faster.performanceMetrics?.isImprovement).toBe(false);
      });

      it('does not report a percentage change from a 0ms average', () => {
        const test = createTestResult({ duration: 300 });
        analyzer.analyze(test, [createHistoryEntry(0), createHistoryEntry(0)]);
        expect(test.performanceTrend).toBe('→ Baseline');
        expect(test.performanceMetrics).toBeUndefined();
      });

      it('counts a test that is both 20% and 250ms slower', () => {
        const test = createTestResult({ duration: 1250 });
        analyzer.analyze(test, passes(1000));
        expect(test.performanceTrend).toBe('↑ 25% slower');
        expect(test.performanceMetrics?.isRegression).toBe(true);
      });

      it('reports insufficient history with fewer than 4 passing runs, and no change', () => {
        const test = createTestResult({ duration: 2500 });
        analyzer.analyze(test, [createHistoryEntry(1000), createHistoryEntry(1000), createHistoryEntry(1000), createHistoryEntry(9000, { passed: false })]);

        expect([test.performanceTrend, test.averageDuration, test.performanceMetrics]).toEqual(['→ Insufficient history', 1000, undefined]);
      });

      it('does not compare the duration of a test that did not pass', () => {
        for (const status of ['failed', 'timedOut', 'interrupted'] as const) {
          const test = createTestResult({ status, duration: 5000 });
          analyzer.analyze(test, [createHistoryEntry(1000), createHistoryEntry(1000)]);
          expect(test.performanceTrend).toBe('→ Not compared');
          expect(test.performanceMetrics).toBeUndefined();
          expect(test.averageDuration).toBe(1000);
        }
      });

      it('calculates performance metrics correctly', () => {
        const test = createTestResult({ duration: 1200 });
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceMetrics).toBeDefined();
        expect(test.performanceMetrics?.averageDuration).toBe(1000);
        expect(test.performanceMetrics?.currentDuration).toBe(1200);
        expect(test.performanceMetrics?.percentChange).toBe(20);
        expect(test.performanceMetrics?.absoluteChange).toBe(200);
      });
    });

    describe('severity calculation', () => {
      it('classifies low severity (under 25%)', () => {
        const test = createTestResult({ duration: 1200 }); // 20% slower
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceMetrics?.severity).toBe('low');
      });

      it('classifies medium severity (25-50%)', () => {
        const test = createTestResult({ duration: 1350 }); // 35% slower
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceMetrics?.severity).toBe('medium');
      });

      it('classifies high severity (over 50%)', () => {
        const test = createTestResult({ duration: 1600 }); // 60% slower
        const history = passes(1000);

        analyzer.analyze(test, history);

        expect(test.performanceMetrics?.severity).toBe('high');
      });
    });

    describe('isSlow', () => {
      it('returns true for slow tests', () => {
        const test = createTestResult();
        test.performanceTrend = '↑ 50% slower';
        expect(analyzer.isSlow(test)).toBe(true);
      });

      it('returns false for stable tests', () => {
        const test = createTestResult();
        test.performanceTrend = '→ Stable';
        expect(analyzer.isSlow(test)).toBe(false);
      });

      it('returns false for fast tests', () => {
        const test = createTestResult();
        test.performanceTrend = '↓ 50% faster';
        expect(analyzer.isSlow(test)).toBe(false);
      });
    });

    describe('isFaster', () => {
      it('returns true for faster tests', () => {
        const test = createTestResult();
        test.performanceTrend = '↓ 50% faster';
        expect(analyzer.isFaster(test)).toBe(true);
      });

      it('returns false for slow tests', () => {
        const test = createTestResult();
        test.performanceTrend = '↑ 50% slower';
        expect(analyzer.isFaster(test)).toBe(false);
      });
    });

    describe('getStatus', () => {
      it('returns correct status for different trends', () => {
        expect(analyzer.getStatus('↑ 50% slower')).toBe('slow');
        expect(analyzer.getStatus('↓ 50% faster')).toBe('fast');
        expect(analyzer.getStatus('→ Stable')).toBe('stable');
        expect(analyzer.getStatus(undefined)).toBe('stable');
      });
    });
  });

  describe('step trends', () => {
    const analyzer = new PerformanceAnalyzer();
    const step = (title: string, duration: number): StepData => ({ title, duration, category: 'test.step' });
    const run = (stepDurations: Record<string, number>, passed = true) => ({ ...createHistoryEntry(1000, { passed }), stepDurations });

    it('gives each step slower than the median of its passing runs as a ratio', () => {
      const test = createTestResult({ steps: [step('login', 310), step('checkout', 200)] });
      analyzer.analyze(test, Array.from({ length: 5 }, () => run({ login: 100, checkout: 190 })));

      expect(test.stepTrends).toEqual([{ title: 'login', median: 100, current: 310, ratio: 3.1 }]);
    });

    it('needs 4 passing runs with the step and a change of at least 100ms, and compares only a passing test', () => {
      const history = [
        ...Array.from({ length: 3 }, () => run({ login: 100, fill: 20, search: 200 })),
        ...Array.from({ length: 2 }, () => run({ login: 100, fill: 20, search: 200 }, false)),
        run({ fill: 20, search: 200 }),
      ];
      const steps = [step('login', 310), step('fill', 110), step('search', 500)];
      const passed = createTestResult({ steps });
      analyzer.analyze(passed, history);
      const failed = createTestResult({ steps, status: 'failed' });
      analyzer.analyze(failed, history);

      expect([passed.stepTrends, failed.stepTrends]).toEqual([[{ title: 'search', median: 200, current: 500, ratio: 2.5 }], undefined]);
    });
  });

  describe('with custom threshold', () => {
    it('uses custom threshold for analysis', () => {
      const analyzer = new PerformanceAnalyzer(0.5); // 50% threshold
      const test = createTestResult({ duration: 1400 }); // 40% slower
      const history = passes(1000);

      analyzer.analyze(test, history);

      expect(test.performanceTrend).toBe('→ Stable'); // Within 50% threshold
    });
  });
});
