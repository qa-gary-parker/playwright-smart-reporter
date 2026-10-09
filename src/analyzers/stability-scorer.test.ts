import { describe, it, expect } from 'vitest';
import { StabilityScorer } from './stability-scorer';
import type { TestResultData, RetryInfo, PerformanceMetrics, StabilityScore } from '../types';

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

function createRetryInfo(overrides: Partial<RetryInfo> = {}): RetryInfo {
  return {
    totalRetries: 0,
    passedOnRetry: -1,
    failedRetries: 0,
    retryPattern: [true],
    needsAttention: false,
    ...overrides,
  };
}

function createPerformanceMetrics(overrides: Partial<PerformanceMetrics> = {}): PerformanceMetrics {
  return {
    averageDuration: 1000,
    currentDuration: 1000,
    percentChange: 0,
    absoluteChange: 0,
    threshold: 0.2,
    isRegression: false,
    isImprovement: false,
    severity: 'low',
    ...overrides,
  };
}

describe('StabilityScorer', () => {
  describe('with default threshold (70)', () => {
    const scorer = new StabilityScorer();

    describe('scoreTest', () => {
      it('gives high score to stable passing test', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0,
          retryInfo: createRetryInfo(),
          performanceMetrics: createPerformanceMetrics(),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore).toBeDefined();
        expect(test.stabilityScore?.overall).toBeGreaterThanOrEqual(90);
        expect(test.stabilityScore?.grade).toBe('A');
        expect(test.stabilityScore?.needsAttention).toBe(false);
      });

      it('gives lower score to flaky test', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0.5, // 50% failure rate
          retryInfo: createRetryInfo(),
          performanceMetrics: createPerformanceMetrics(),
        });

        scorer.scoreTest(test);

        // With 50% flakiness, flakiness score is 50
        // Overall: 50*0.4 + 90*0.3 + 100*0.3 = 20 + 27 + 30 = 77
        expect(test.stabilityScore?.flakiness).toBe(50);
        expect(test.stabilityScore?.overall).toBeLessThan(80);
        // Score 77 is above threshold 70, so needsAttention is false
        expect(test.stabilityScore?.needsAttention).toBe(false);
      });

      it('gives lower score to test with performance regression', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0,
          retryInfo: createRetryInfo(),
          performanceMetrics: createPerformanceMetrics({
            isRegression: true,
            severity: 'high',
          }),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.performance).toBe(25);
        expect(test.stabilityScore?.overall).toBeLessThan(100);
      });

      it('gives lower score to test that needed retries', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0,
          retryInfo: createRetryInfo({
            totalRetries: 2,
            passedOnRetry: 2,
          }),
          performanceMetrics: createPerformanceMetrics(),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.reliability).toBe(70); // 100 - (2 * 15)
      });

      it('gives low score to failed test', () => {
        const test = createTestResult({
          status: 'failed',
          flakinessScore: 0,
          retryInfo: createRetryInfo({
            totalRetries: 2,
            failedRetries: 2,
          }),
          performanceMetrics: createPerformanceMetrics(),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.reliability).toBeLessThanOrEqual(40);
      });

      it('gives neutral score to skipped test', () => {
        const test = createTestResult({
          status: 'skipped',
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.reliability).toBe(75);
      });

      it('gives 100 flakiness score to new test', () => {
        const test = createTestResult({
          status: 'passed',
          // flakinessScore is undefined for new tests
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.flakiness).toBe(100);
      });
    });

    describe('grade calculation', () => {
      it('assigns grade A for score >= 90', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0,
          retryInfo: createRetryInfo(),
          performanceMetrics: createPerformanceMetrics({ isImprovement: true }),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.grade).toBe('A');
      });

      it('assigns grade B for score 80-89', () => {
        const test = createTestResult({
          status: 'passed',
          flakinessScore: 0.1, // 90% flakiness score
          retryInfo: createRetryInfo({ totalRetries: 1 }),
          performanceMetrics: createPerformanceMetrics(),
        });

        scorer.scoreTest(test);

        // 90 * 0.4 + 90 * 0.3 + 85 * 0.3 = 88.5
        expect([test.stabilityScore?.overall, test.stabilityScore?.grade]).toEqual([89, 'B']);
      });

      it('assigns each grade from its lower bound: A 90, B 80, C 70, D 60', () => {
        // Passing, no history: overall = flakiness * 0.4 + 60
        const scored = [0.25, 0.28, 0.5, 0.53, 0.75, 0.78, 1].map(flakinessScore => {
          const test = createTestResult({ status: 'passed', flakinessScore });
          scorer.scoreTest(test);
          return [test.stabilityScore?.overall, test.stabilityScore?.grade];
        });

        expect(scored).toEqual([[90, 'A'], [89, 'B'], [80, 'B'], [79, 'C'], [70, 'C'], [69, 'D'], [60, 'D']]);
      });

      it('assigns grade F for very low scores', () => {
        const test = createTestResult({
          status: 'failed',
          flakinessScore: 0.8, // 20% flakiness score
          retryInfo: createRetryInfo({ totalRetries: 3, failedRetries: 3 }),
          performanceMetrics: createPerformanceMetrics({ isRegression: true, severity: 'high' }),
        });

        scorer.scoreTest(test);

        expect(test.stabilityScore?.grade).toBe('F');
      });
    });

    describe('calculateSuiteStats', () => {
      it('calculates correct stats for test suite', () => {
        const results = [
          createTestResult({ status: 'passed', flakinessScore: 0 }),
          createTestResult({ status: 'passed', flakinessScore: 0.4 }),
          createTestResult({ status: 'failed' }),
          createTestResult({ status: 'skipped' }),
          createTestResult({ status: 'passed', performanceTrend: '↑ 50% slower' }),
        ];

        // Score the tests first
        results.forEach(r => scorer.scoreTest(r));

        const stats = scorer.calculateSuiteStats(results);

        expect(stats.total).toBe(5);
        expect(stats.passed).toBe(3);
        expect(stats.failed).toBe(1);
        expect(stats.skipped).toBe(1);
        expect(stats.flaky).toBe(1); // One test with flakinessScore >= 0.3
        expect(stats.slow).toBe(1);
        expect(stats.passRate).toBe(75); // 3/(3+1) = 75%
      });

      it('handles empty results', () => {
        const stats = scorer.calculateSuiteStats([]);

        expect(stats.total).toBe(0);
        expect(stats.passed).toBe(0);
        expect(stats.passRate).toBe(0);
        expect(stats.averageStability).toBe(0);
      });

      it('calculates average stability correctly', () => {
        const results = [
          createTestResult({ status: 'passed', flakinessScore: 0 }),
          createTestResult({ status: 'passed', flakinessScore: 0.5 }),
          createTestResult({ status: 'passed' }),
        ];

        // 100 and 80; the unscored test is left out of the average
        results.slice(0, 2).forEach(r => scorer.scoreTest(r));

        const stats = scorer.calculateSuiteStats(results);

        expect(stats.averageStability).toBe(90);
      });
    });

    describe('getProblematicTests', () => {
      it('returns tests that need attention', () => {
        const results = [
          createTestResult({ testId: 'test-1', flakinessScore: 0 }),
          createTestResult({ testId: 'test-2', flakinessScore: 0.8 }), // Will need attention
          createTestResult({ testId: 'test-3', flakinessScore: 0 }),
        ];

        results.forEach(r => scorer.scoreTest(r));

        const problematic = scorer.getProblematicTests(results);

        expect(problematic.length).toBe(1);
        expect(problematic[0].testId).toBe('test-2');
      });
    });

    describe('getSummary', () => {
      it('returns correct summary for stable test', () => {
        const score: StabilityScore = {
          overall: 95,
          flakiness: 100,
          performance: 90,
          reliability: 100,
          grade: 'A',
          needsAttention: false,
        };

        expect(scorer.getSummary(score)).toBe('Grade A (95/100) - ✅ Stable');
      });

      it('returns correct summary for test needing attention', () => {
        const score: StabilityScore = {
          overall: 45,
          flakiness: 50,
          performance: 25,
          reliability: 60,
          grade: 'F',
          needsAttention: true,
        };

        expect(scorer.getSummary(score)).toBe('Grade F (45/100) - ⚠️ Needs Attention');
      });
    });
  });

  describe('with custom threshold', () => {
    it('uses custom threshold for needsAttention', () => {
      const scorer = new StabilityScorer(95); // Very strict threshold
      const test = createTestResult({
        status: 'passed',
        flakinessScore: 0.1, // 90% flakiness score
        retryInfo: createRetryInfo(),
        performanceMetrics: createPerformanceMetrics(),
      });

      scorer.scoreTest(test);

      // Overall: 90*0.4 + 90*0.3 + 100*0.3 = 36 + 27 + 30 = 93
      // With threshold 95, score 93 is below threshold
      expect(test.stabilityScore?.overall).toBe(93);
      expect(test.stabilityScore?.needsAttention).toBe(true);
    });
  });
});
