import { describe, it, expect } from 'vitest';
import { RetryAnalyzer } from './retry-analyzer';
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

function createHistoryEntry(retry: number = 0): TestHistoryEntry {
  return {
    passed: true,
    duration: 1000,
    timestamp: new Date().toISOString(),
    retry,
  };
}

describe('RetryAnalyzer', () => {
  describe('with default threshold (3)', () => {
    const analyzer = new RetryAnalyzer();

    describe('analyze', () => {
      it('calculates retry info for test that passed first try', () => {
        const test = createTestResult({ status: 'passed', retry: 0 });
        analyzer.analyze(test, []);

        expect(test.retryInfo).toBeDefined();
        expect(test.retryInfo?.totalRetries).toBe(0);
        expect(test.retryInfo?.passedOnRetry).toBe(-1);
        expect(test.retryInfo?.failedRetries).toBe(0);
        expect(test.retryInfo?.retryPattern).toEqual([true]);
        expect(test.retryInfo?.needsAttention).toBe(false);
      });

      it('calculates retry info for test that passed on retry', () => {
        const test = createTestResult({ status: 'passed', retry: 2 });
        analyzer.analyze(test, []);

        expect(test.retryInfo?.totalRetries).toBe(2);
        expect(test.retryInfo?.passedOnRetry).toBe(2);
        expect(test.retryInfo?.failedRetries).toBe(0);
        expect(test.retryInfo?.retryPattern).toEqual([false, false, true]);
        expect(test.retryInfo?.needsAttention).toBe(false);
      });

      it('calculates retry info for failed test', () => {
        const test = createTestResult({ status: 'failed', retry: 2 });
        analyzer.analyze(test, []);

        expect(test.retryInfo?.totalRetries).toBe(2);
        expect(test.retryInfo?.passedOnRetry).toBe(-1);
        expect(test.retryInfo?.failedRetries).toBe(2);
        expect(test.retryInfo?.retryPattern).toEqual([false, false, false]);
      });

      it('marks test as needing attention when exceeding threshold', () => {
        const test = createTestResult({ status: 'passed', retry: 3 });
        analyzer.analyze(test, []);

        expect(test.retryInfo?.needsAttention).toBe(true);
      });

      it('marks test as needing attention based on history', () => {
        const test = createTestResult({ status: 'passed', retry: 0 });
        const history = [
          createHistoryEntry(1),
          createHistoryEntry(2),
          createHistoryEntry(1),
          createHistoryEntry(0),
        ];

        analyzer.analyze(test, history);

        // 3 out of 4 runs needed retries (75%), should need attention
        expect(test.retryInfo?.needsAttention).toBe(true);
      });

      it('handles timedOut status like failed', () => {
        const test = createTestResult({ status: 'timedOut', retry: 1 });
        analyzer.analyze(test, []);

        expect(test.retryInfo?.failedRetries).toBe(1);
        expect(test.retryInfo?.passedOnRetry).toBe(-1);
      });
    });

    describe('needsAttention', () => {
      it('returns true when retryInfo indicates attention needed', () => {
        const test = createTestResult();
        test.retryInfo = {
          totalRetries: 3,
          passedOnRetry: 3,
          failedRetries: 0,
          retryPattern: [false, false, false, true],
          needsAttention: true,
        };

        expect(analyzer.needsAttention(test)).toBe(true);
      });

      it('returns false when no retryInfo', () => {
        const test = createTestResult();
        expect(analyzer.needsAttention(test)).toBe(false);
      });
    });

    describe('getRetrySummary', () => {
      it('returns "No retries" for tests without retries', () => {
        const test = createTestResult();
        test.retryInfo = {
          totalRetries: 0,
          passedOnRetry: -1,
          failedRetries: 0,
          retryPattern: [true],
          needsAttention: false,
        };

        expect(analyzer.getRetrySummary(test)).toBe('No retries');
      });

      it('returns summary for test that passed on retry', () => {
        const test = createTestResult();
        test.retryInfo = {
          totalRetries: 2,
          passedOnRetry: 2,
          failedRetries: 0,
          retryPattern: [false, false, true],
          needsAttention: false,
        };

        expect(analyzer.getRetrySummary(test)).toBe('Passed on attempt 3 of 3');
      });

      it('labels a pass on the first retry as the second of two attempts', () => {
        const test = createTestResult({ status: 'passed', retry: 1 });
        analyzer.analyze(test, []);

        expect(analyzer.getRetrySummary(test)).toBe('Passed on attempt 2 of 2');
      });

      it('returns summary for failed test', () => {
        const test = createTestResult();
        test.retryInfo = {
          totalRetries: 2,
          passedOnRetry: -1,
          failedRetries: 2,
          retryPattern: [false, false, false],
          needsAttention: true,
        };

        expect(analyzer.getRetrySummary(test)).toBe('Failed after 3 attempts');
      });

      it('handles missing retryInfo', () => {
        const test = createTestResult();
        expect(analyzer.getRetrySummary(test)).toBe('No retries');
      });
    });

    describe('calculateRetryRate', () => {
      it('returns 0 for empty results', () => {
        expect(analyzer.calculateRetryRate([])).toBe(0);
      });

      it('calculates retry rate correctly', () => {
        const results = [
          createTestResult({ retry: 0 }),
          createTestResult({ retry: 1 }),
          createTestResult({ retry: 0 }),
          createTestResult({ retry: 2 }),
        ];

        expect(analyzer.calculateRetryRate(results)).toBe(0.5);
      });

      it('returns 0 when no tests have retries', () => {
        const results = [
          createTestResult({ retry: 0 }),
          createTestResult({ retry: 0 }),
        ];

        expect(analyzer.calculateRetryRate(results)).toBe(0);
      });

      it('returns 1 when all tests have retries', () => {
        const results = [
          createTestResult({ retry: 1 }),
          createTestResult({ retry: 2 }),
        ];

        expect(analyzer.calculateRetryRate(results)).toBe(1);
      });
    });

    describe('getProblematicTests', () => {
      it('returns tests that need attention', () => {
        const test1 = createTestResult({ testId: 'test-1', retry: 5 });
        const test2 = createTestResult({ testId: 'test-2', retry: 0 });
        const test3 = createTestResult({ testId: 'test-3', retry: 4 });

        analyzer.analyze(test1, []);
        analyzer.analyze(test2, []);
        analyzer.analyze(test3, []);

        const problematic = analyzer.getProblematicTests([test1, test2, test3]);

        expect(problematic.length).toBe(2);
        expect(problematic.map(t => t.testId)).toContain('test-1');
        expect(problematic.map(t => t.testId)).toContain('test-3');
      });
    });
  });

  describe('with custom threshold', () => {
    it('uses custom threshold for attention check', () => {
      const analyzer = new RetryAnalyzer(1); // Very strict threshold
      const test = createTestResult({ status: 'passed', retry: 1 });

      analyzer.analyze(test, []);

      expect(test.retryInfo?.needsAttention).toBe(true);
    });
  });
});
