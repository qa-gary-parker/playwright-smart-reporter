import { describe, it, expect } from 'vitest';
import { PerformanceAnalyzer } from './performance-analyzer';
import type { TestResultData, TestHistoryEntry } from '../types';

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

function createHistoryEntry(duration: number, skipped: boolean = false): TestHistoryEntry {
  return {
    passed: true,
    duration,
    timestamp: new Date().toISOString(),
    skipped,
  };
}

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
          createHistoryEntry(1000, true),
          createHistoryEntry(1500, true),
        ];

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('→ Baseline');
      });

      it('marks stable performance (within threshold)', () => {
        const test = createTestResult({ duration: 1100 }); // 10% slower
        const history = [
          createHistoryEntry(1000),
          createHistoryEntry(1000),
        ];

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('→ Stable');
        expect(test.averageDuration).toBe(1000);
      });

      it('marks slower tests (above threshold)', () => {
        const test = createTestResult({ duration: 1500 }); // 50% slower
        const history = [
          createHistoryEntry(1000),
          createHistoryEntry(1000),
        ];

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('↑ 50% slower');
        expect(test.performanceMetrics?.isRegression).toBe(true);
        expect(test.performanceMetrics?.severity).toBe('medium');
      });

      it('marks faster tests (below negative threshold)', () => {
        const test = createTestResult({ duration: 500 }); // 50% faster
        const history = [
          createHistoryEntry(1000),
          createHistoryEntry(1000),
        ];

        analyzer.analyze(test, history);

        expect(test.performanceTrend).toBe('↓ 50% faster');
        expect(test.performanceMetrics?.isImprovement).toBe(true);
      });

      it('excludes skipped runs from calculations', () => {
        const test = createTestResult({ duration: 1000 });
        const history = [
          createHistoryEntry(2000), // real
          createHistoryEntry(5000, true), // skipped - ignored
        ];

        analyzer.analyze(test, history);

        expect(test.averageDuration).toBe(2000);
        expect(test.performanceTrend).toBe('↓ 50% faster');
      });

      it('does not count a short test as slower or faster when the change is under 250ms', () => {
        const slower = createTestResult({ duration: 155 }); // 63% slower, but only 60ms
        analyzer.analyze(slower, [createHistoryEntry(95), createHistoryEntry(95)]);
        expect(slower.performanceTrend).toBe('→ Stable');
        expect(slower.performanceMetrics?.isRegression).toBe(false);

        const faster = createTestResult({ duration: 300 }); // 40% faster, but only 200ms
        analyzer.analyze(faster, [createHistoryEntry(500)]);
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
        analyzer.analyze(test, [createHistoryEntry(1000)]);
        expect(test.performanceTrend).toBe('↑ 25% slower');
        expect(test.performanceMetrics?.isRegression).toBe(true);
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
        const history = [
          createHistoryEntry(1000),
          createHistoryEntry(1000),
        ];

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
        const history = [createHistoryEntry(1000)];

        analyzer.analyze(test, history);

        expect(test.performanceMetrics?.severity).toBe('low');
      });

      it('classifies medium severity (25-50%)', () => {
        const test = createTestResult({ duration: 1350 }); // 35% slower
        const history = [createHistoryEntry(1000)];

        analyzer.analyze(test, history);

        expect(test.performanceMetrics?.severity).toBe('medium');
      });

      it('classifies high severity (over 50%)', () => {
        const test = createTestResult({ duration: 1600 }); // 60% slower
        const history = [createHistoryEntry(1000)];

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

    describe('calculateSmartThreshold', () => {
      it('returns looser threshold for very fast tests', () => {
        expect(analyzer.calculateSmartThreshold(50)).toBe(0.5);
        expect(analyzer.calculateSmartThreshold(99)).toBe(0.5);
      });

      it('returns moderate threshold for fast tests', () => {
        expect(analyzer.calculateSmartThreshold(100)).toBe(0.3);
        expect(analyzer.calculateSmartThreshold(500)).toBe(0.3);
        expect(analyzer.calculateSmartThreshold(999)).toBe(0.3);
      });

      it('returns default threshold for normal tests', () => {
        expect(analyzer.calculateSmartThreshold(1000)).toBe(0.2);
        expect(analyzer.calculateSmartThreshold(5000)).toBe(0.2);
        expect(analyzer.calculateSmartThreshold(9999)).toBe(0.2);
      });

      it('returns tighter threshold for slow tests', () => {
        expect(analyzer.calculateSmartThreshold(10000)).toBe(0.15);
        expect(analyzer.calculateSmartThreshold(30000)).toBe(0.15);
      });
    });
  });

  describe('with custom threshold', () => {
    it('uses custom threshold for analysis', () => {
      const analyzer = new PerformanceAnalyzer(0.5); // 50% threshold
      const test = createTestResult({ duration: 1400 }); // 40% slower
      const history = [createHistoryEntry(1000)];

      analyzer.analyze(test, history);

      expect(test.performanceTrend).toBe('→ Stable'); // Within 50% threshold
    });
  });
});
