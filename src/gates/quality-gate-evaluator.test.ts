import { describe, it, expect } from 'vitest';
import { QualityGateEvaluator } from './quality-gate-evaluator';
import type {
  TestResultData,
  QualityGateConfig,
  RunComparison,
  RunSummary,
  StabilityScore,
  A11yImpact,
} from '../types';

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

function createStabilityScore(overrides: Partial<StabilityScore> = {}): StabilityScore {
  return {
    overall: 90,
    flakiness: 95,
    performance: 85,
    reliability: 90,
    grade: 'A',
    needsAttention: false,
    ...overrides,
  };
}

function createRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    total: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    flaky: 1,
    slow: 1,
    duration: 5000,
    passRate: 80,
    ...overrides,
  };
}

function createComparison(overrides: Partial<RunComparison> = {}): RunComparison {
  return {
    baselineRun: createRunSummary({ runId: 'baseline' }),
    currentRun: createRunSummary({ runId: 'current' }),
    changes: {
      newFailures: [],
      fixedTests: [],
      newTests: [],
      regressions: [],
      improvements: [],
    },
    ...overrides,
  };
}

describe('QualityGateEvaluator', () => {
  const evaluator = new QualityGateEvaluator();

  // ── No rules configured ──────────────────────────────────────────────

  describe('no rules configured', () => {
    it('passes with empty rules array when no config properties set', () => {
      const result = evaluator.evaluate({}, [createTestResult()]);
      expect(result.passed).toBe(true);
      expect(result.rules).toEqual([]);
    });

    it('passes with empty results and no config', () => {
      const result = evaluator.evaluate({}, []);
      expect(result.passed).toBe(true);
      expect(result.rules).toEqual([]);
    });
  });

  // ── maxFailures ──────────────────────────────────────────────────────

  describe('maxFailures', () => {
    it('passes when failure count is below threshold', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 5 }, results);
      expect(result.passed).toBe(true);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('1');
    });

    it('passes when failure count equals threshold', () => {
      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 'test-2', status: 'timedOut', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 2 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(true);
    });

    it('fails when failure count exceeds threshold', () => {
      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 'test-3', status: 'timedOut', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 2 }, results);
      expect(result.passed).toBe(false);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('3');
      expect(rule?.threshold).toBe('≤ 2');
    });

    it('passes with 0 threshold when no failures exist', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 0 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('0');
    });

    it('fails with 0 threshold when any failure exists', () => {
      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 0 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(false);
    });

    it('only counts unexpected outcomes with failed or timedOut status', () => {
      const results = [
        createTestResult({ status: 'failed', outcome: 'expected' }), // test.fail() — expected
        createTestResult({ testId: 'test-2', status: 'skipped', outcome: 'skipped' }),
        createTestResult({ testId: 'test-3', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-4', status: 'failed', outcome: 'unexpected' }), // real failure
      ];
      const result = evaluator.evaluate({ maxFailures: 1 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('1');
    });

    it('counts timedOut with unexpected outcome as failure', () => {
      const results = [
        createTestResult({ status: 'timedOut', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ maxFailures: 0 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFailures');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('1');
    });
  });

  // ── minPassRate ──────────────────────────────────────────────────────

  describe('minPassRate', () => {
    it('passes when pass rate meets threshold', () => {
      const results = Array.from({ length: 10 }, (_, i) =>
        createTestResult({
          testId: `test-${i}`,
          status: i < 9 ? 'passed' : 'failed',
          outcome: i < 9 ? 'expected' : 'unexpected',
        })
      );
      const result = evaluator.evaluate({ minPassRate: 90 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('90%');
    });

    it('fails when pass rate is below threshold', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 90 }, results);
      expect(result.passed).toBe(false);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('50%');
    });

    it('passes with 100% threshold when all pass', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'passed', outcome: 'expected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 100 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('100%');
    });

    it('passes with 0% threshold regardless of results', () => {
      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 0 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(true);
    });

    it('counts flaky tests as passed', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'flaky' }),
        createTestResult({ testId: 'test-2', status: 'passed', outcome: 'expected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 100 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('100%');
    });

    it('handles boundary value exactly at threshold', () => {
      // 75% pass rate (3 of 4 pass)
      const results = [
        createTestResult({ testId: 't1', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 't2', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 't3', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 't4', status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 75 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(true);
    });

    it('skips the rule when no test ran, instead of reporting 0% as a pass', () => {
      const result = evaluator.evaluate({ minPassRate: 90 }, []);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule).toEqual({ rule: 'minPassRate', passed: true, actual: 'N/A', threshold: '≥ 90%', skipped: true });
    });
  });

  // ── maxFlakyRate ─────────────────────────────────────────────────────

  describe('maxFlakyRate', () => {
    it('passes when no flaky tests exist', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'passed', outcome: 'expected' }),
      ];
      const result = evaluator.evaluate({ maxFlakyRate: 5 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFlakyRate');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('0%');
    });

    it('fails when flaky rate exceeds threshold', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'flaky' }),
        createTestResult({ testId: 'test-2', status: 'passed', outcome: 'expected' }),
      ];
      const result = evaluator.evaluate({ maxFlakyRate: 10 }, results);
      expect(result.passed).toBe(false);
      const rule = result.rules.find(r => r.rule === 'maxFlakyRate');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('50%');
    });

    it('passes when flaky rate equals threshold', () => {
      // 2 of 10 = 20%
      const results = Array.from({ length: 10 }, (_, i) =>
        createTestResult({
          testId: `test-${i}`,
          status: 'passed',
          outcome: i < 2 ? 'flaky' : 'expected',
        })
      );
      const result = evaluator.evaluate({ maxFlakyRate: 20 }, results);
      const rule = result.rules.find(r => r.rule === 'maxFlakyRate');
      expect(rule?.passed).toBe(true);
    });

    it('skips the rule when no test ran, like minPassRate', () => {
      const result = evaluator.evaluate({ maxFlakyRate: 5 }, []);
      expect(result.rules).toEqual([{ rule: 'maxFlakyRate', passed: true, actual: 'N/A', threshold: '≤ 5%', skipped: true }]);
    });

    it('leaves skipped tests out: 1 flaky and 1 passed among 8 skipped is 50%', () => {
      const results = [
        createTestResult({ testId: 'k', status: 'passed', outcome: 'flaky' }),
        createTestResult({ testId: 'p', status: 'passed', outcome: 'expected' }),
        ...Array.from({ length: 8 }, (_, i) => createTestResult({ testId: `s${i}`, status: 'skipped', outcome: 'skipped' })),
      ];
      expect(evaluator.evaluate({ maxFlakyRate: 40 }, results).rules).toEqual([
        { rule: 'maxFlakyRate', passed: false, actual: '50%', threshold: '≤ 40%' },
      ]);
    });

    it('skips the rule when every test was skipped', () => {
      const results = Array.from({ length: 3 }, (_, i) => createTestResult({ testId: `s${i}`, status: 'skipped', outcome: 'skipped' }));
      expect(evaluator.evaluate({ maxFlakyRate: 5 }, results).rules).toEqual([
        { rule: 'maxFlakyRate', passed: true, actual: 'N/A', threshold: '≤ 5%', skipped: true },
      ]);
    });
  });

  // ── minStabilityGrade ────────────────────────────────────────────────

  describe('minStabilityGrade', () => {
    it('passes when average grade meets A threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'A' }) }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'A' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('A');
    });

    it('fails when average grade is below A threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'C' }) }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'A' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(false);
    });

    it('passes when average grade meets B threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'B' }) }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'B' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(true);
    });

    it('passes when average grade meets C threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'C' }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'D' }) }),
      ];
      // avg of C(3) + D(2) = 2.5, rounds to 3 = C
      const result = evaluator.evaluate({ minStabilityGrade: 'C' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(true);
    });

    it('passes when average grade meets D threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'D' }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'D' }) }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'D' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('D');
    });

    it('fails when average grade is F against D threshold', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'F' as any }) }),
        createTestResult({ testId: 'test-2', stabilityScore: createStabilityScore({ grade: 'F' as any }) }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'D' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('F');
    });

    it('skips when no tests have stability grades', () => {
      const results = [
        createTestResult(),
        createTestResult({ testId: 'test-2' }),
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'B' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.skipped).toBe(true);
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('N/A');
    });

    it('ignores tests without stability scores in average calculation', () => {
      const results = [
        createTestResult({ stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: 'test-2' }), // no score — ignored
      ];
      const result = evaluator.evaluate({ minStabilityGrade: 'A' }, results);
      const rule = result.rules.find(r => r.rule === 'minStabilityGrade');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('A');
    });
  });

  // ── noNewFailures ────────────────────────────────────────────────────

  describe('noNewFailures', () => {
    it('passes when comparison has no new failures', () => {
      const comparison = createComparison();
      const result = evaluator.evaluate(
        { noNewFailures: true },
        [createTestResult()],
        comparison,
      );
      const rule = result.rules.find(r => r.rule === 'noNewFailures');
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('0');
    });

    it('fails when comparison has new failures', () => {
      const comparison = createComparison({
        changes: {
          newFailures: [createTestResult({ status: 'failed' })],
          fixedTests: [],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      });
      const result = evaluator.evaluate(
        { noNewFailures: true },
        [createTestResult()],
        comparison,
      );
      expect(result.passed).toBe(false);
      const rule = result.rules.find(r => r.rule === 'noNewFailures');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('1');
      // Read as a value like the other rules: "1 ≤ 0" in the terminal, a 0 limit in the summary table.
      expect(rule?.threshold).toBe('≤ 0');
    });

    it('is skipped when no comparison data is provided', () => {
      const result = evaluator.evaluate(
        { noNewFailures: true },
        [createTestResult()],
      );
      const rule = result.rules.find(r => r.rule === 'noNewFailures');
      expect(rule?.skipped).toBe(true);
      expect(rule?.passed).toBe(true);
      expect(rule?.actual).toBe('N/A');
    });

    it('is not evaluated when noNewFailures is false', () => {
      const result = evaluator.evaluate(
        { noNewFailures: false },
        [createTestResult()],
      );
      const rule = result.rules.find(r => r.rule === 'noNewFailures');
      expect(rule).toBeUndefined();
    });
  });

  describe('minCoverage', () => {
    const coverage = (pct: number) => ({
      lines: { total: 18, covered: 12, pct },
      functions: { total: 5, covered: 3, pct: 60 },
      branches: { total: 4, covered: 4, pct: 100 },
    });

    it('passes when line coverage equals the threshold', () => {
      const result = evaluator.evaluate({ minCoverage: 66.66 }, [createTestResult()], undefined, coverage(66.66));
      expect(result.rules).toEqual([{ rule: 'minCoverage', passed: true, actual: '66.66%', threshold: '≥ 66.66%' }]);
      expect(result.passed).toBe(true);
    });

    it('fails when line coverage is below the threshold', () => {
      const result = evaluator.evaluate({ minCoverage: 70 }, [createTestResult()], undefined, coverage(66.66));
      expect(result.rules).toEqual([{ rule: 'minCoverage', passed: false, actual: '66.66%', threshold: '≥ 70%' }]);
      expect(result.passed).toBe(false);
    });

    it('fails when no coverage was collected', () => {
      const result = evaluator.evaluate({ minCoverage: 0 }, [createTestResult()]);
      expect(result.rules).toEqual([{ rule: 'minCoverage', passed: false, actual: 'no data', threshold: '≥ 0%' }]);
      expect(result.passed).toBe(false);
    });
  });

  // ── Combined rules ──────────────────────────────────────────────────

  describe('combined rules', () => {
    it('passes when all rules pass', () => {
      const results = Array.from({ length: 10 }, (_, i) =>
        createTestResult({
          testId: `test-${i}`,
          status: 'passed',
          outcome: 'expected',
          stabilityScore: createStabilityScore({ grade: 'A' }),
        })
      );
      const comparison = createComparison();
      const config: QualityGateConfig = {
        maxFailures: 0,
        minPassRate: 100,
        maxFlakyRate: 0,
        minStabilityGrade: 'A',
        noNewFailures: true,
      };
      const result = evaluator.evaluate(config, results, comparison);
      expect(result.passed).toBe(true);
      expect(result.rules.length).toBe(5);
      expect(result.rules.every(r => r.passed)).toBe(true);
    });

    it('fails when some rules fail', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 'test-3', status: 'passed', outcome: 'flaky' }),
      ];
      const config: QualityGateConfig = {
        maxFailures: 0,    // will fail (1 failure)
        minPassRate: 90,    // will fail (66%)
        maxFlakyRate: 50,   // will pass (33%)
      };
      const result = evaluator.evaluate(config, results);
      expect(result.passed).toBe(false);
      const failedRules = result.rules.filter(r => !r.passed);
      expect(failedRules.length).toBe(2);
    });

    it('passes when some rules are skipped but none fail', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
      ];
      const config: QualityGateConfig = {
        maxFailures: 5,
        noNewFailures: true,   // will be skipped (no comparison)
        minStabilityGrade: 'C', // will be skipped (no grades)
      };
      const result = evaluator.evaluate(config, results);
      expect(result.passed).toBe(true);
      const skippedRules = result.rules.filter(r => r.skipped);
      expect(skippedRules.length).toBe(2);
    });

    it('reports mixed pass/fail/skip correctly', () => {
      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
      ];
      const config: QualityGateConfig = {
        maxFailures: 0,          // fail
        minPassRate: 50,         // pass
        noNewFailures: true,     // skip (no comparison)
      };
      const result = evaluator.evaluate(config, results);
      expect(result.passed).toBe(false);

      const maxFailRule = result.rules.find(r => r.rule === 'maxFailures');
      const passRateRule = result.rules.find(r => r.rule === 'minPassRate');
      const newFailRule = result.rules.find(r => r.rule === 'noNewFailures');

      expect(maxFailRule?.passed).toBe(false);
      expect(passRateRule?.passed).toBe(true);
      expect(newFailRule?.skipped).toBe(true);
      expect(newFailRule?.passed).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty results array with all rules configured', () => {
      const config: QualityGateConfig = {
        maxFailures: 0,
        minPassRate: 90,
        maxFlakyRate: 5,
        minStabilityGrade: 'B',
        noNewFailures: true,
      };
      const result = evaluator.evaluate(config, []);
      expect(result.passed).toBe(true);
      // maxFailures: 0 failures -> pass
      // minPassRate: 0% but 0 total -> pass (no tests to fail)
      // maxFlakyRate: 0% -> pass
      // minStabilityGrade: no graded tests -> skip
      // noNewFailures: no comparison -> skip
    });

    it('handles all skipped tests', () => {
      const results = [
        createTestResult({ status: 'skipped', outcome: 'skipped' }),
        createTestResult({ testId: 'test-2', status: 'skipped', outcome: 'skipped' }),
      ];
      const config: QualityGateConfig = {
        maxFailures: 0,
        minPassRate: 90,
      };
      const result = evaluator.evaluate(config, results);
      // maxFailures: 0 unexpected failures -> pass
      const maxFailRule = result.rules.find(r => r.rule === 'maxFailures');
      expect(maxFailRule?.passed).toBe(true);
    });

    it('handles results without outcome field', () => {
      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ testId: 'test-2', status: 'failed' }),
      ];
      const config: QualityGateConfig = {
        maxFailures: 5,
        minPassRate: 50,
      };
      const result = evaluator.evaluate(config, results);
      // Without outcome, the status decides, as it does for the summary and history
      const maxFailRule = result.rules.find(r => r.rule === 'maxFailures');
      expect(maxFailRule?.passed).toBe(true);
      expect(maxFailRule?.actual).toBe('1');
      // minPassRate: 'passed' status counts
      const passRateRule = result.rules.find(r => r.rule === 'minPassRate');
      expect(passRateRule?.passed).toBe(true);
      expect(passRateRule?.actual).toBe('50%');
    });

    it('computes correct percentages with rounding', () => {
      // 1 of 3 = 33.33...%
      const results = [
        createTestResult({ testId: 't1', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 't2', status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 't3', status: 'failed', outcome: 'unexpected' }),
      ];
      const result = evaluator.evaluate({ minPassRate: 34 }, results);
      const rule = result.rules.find(r => r.rule === 'minPassRate');
      expect(rule?.passed).toBe(false);
      expect(rule?.actual).toBe('33.3%');
    });
  });

  // ── Threshold boundaries (#47) ──────────────────────────────────────

  describe('threshold boundaries', () => {
    const failedTest = createTestResult({ status: 'failed', outcome: 'unexpected' });
    const flakyTest = createTestResult({ status: 'passed', outcome: 'flaky' });
    const passedTest = createTestResult({ status: 'passed', outcome: 'expected' });
    const pool = (test: TestResultData) => new Array<TestResultData>(1000).fill(test);
    const [failedPool, flakyPool, passedPool] = [pool(failedTest), pool(flakyTest), pool(passedTest)];
    const run = (total: number, failed: number, flaky = 0): TestResultData[] =>
      failedPool.slice(0, failed).concat(flakyPool.slice(0, flaky), passedPool.slice(0, total - failed - flaky));
    const rule = (config: QualityGateConfig, results: TestResultData[]) => evaluator.evaluate(config, results).rules[0];

    it('fails minPassRate 100 when 1 of 300 tests fails, and shows the rate rounded down', () => {
      expect(rule({ minPassRate: 100 }, run(300, 1))).toEqual({
        rule: 'minPassRate', passed: false, actual: '99.6%', threshold: '≥ 100%',
      });
    });

    it('fails maxFlakyRate 0 when 1 of 300 tests is flaky, and shows the rate rounded up', () => {
      expect(rule({ maxFlakyRate: 0 }, run(300, 0, 1))).toEqual({
        rule: 'maxFlakyRate', passed: false, actual: '0.4%', threshold: '≤ 0%',
      });
    });

    it('passes a fractional minPassRate that the run meets exactly', () => {
      expect(rule({ minPassRate: 99.4 }, run(500, 3))).toEqual({
        rule: 'minPassRate', passed: true, actual: '99.4%', threshold: '≥ 99.4%',
      });
    });

    it('leaves skipped tests out of minPassRate: 5 passed and 5 skipped is 100%', () => {
      const results = [...run(5, 0), ...Array.from({ length: 5 }, () => createTestResult({ status: 'skipped', outcome: 'skipped' }))];
      expect(rule({ minPassRate: 100 }, results)).toEqual({
        rule: 'minPassRate', passed: true, actual: '100%', threshold: '≥ 100%',
      });
    });

    it('skips minPassRate when every test was skipped, instead of passing it', () => {
      const results = Array.from({ length: 3 }, () => createTestResult({ status: 'skipped', outcome: 'skipped' }));
      expect(rule({ minPassRate: 90 }, results)).toEqual({
        rule: 'minPassRate', passed: true, actual: 'N/A', threshold: '≥ 90%', skipped: true,
      });
    });

    it('passes minPassRate 29 at exactly 29 of 100', () => {
      expect(rule({ minPassRate: 29 }, run(100, 71))).toEqual({
        rule: 'minPassRate', passed: true, actual: '29%', threshold: '≥ 29%',
      });
    });

    it('puts every minPassRate and maxFlakyRate boundary at the exact count for up to 1000 tests', () => {
      const wrong: string[] = [];
      for (let total = 1; total <= 1000; total++) {
        for (let threshold = 0; threshold <= 100; threshold++) {
          // Smallest passing count with passed/total >= threshold%, and largest flaky count with flaky/total <= threshold%
          const minPassed = Math.ceil((threshold * total) / 100);
          const maxFlaky = Math.floor((threshold * total) / 100);
          const checks: Array<[QualityGateConfig, TestResultData[], boolean]> = [
            [{ minPassRate: threshold }, run(total, total - minPassed), true],
            [{ maxFlakyRate: threshold }, run(total, 0, maxFlaky), true],
          ];
          if (minPassed > 0) checks.push([{ minPassRate: threshold }, run(total, total - minPassed + 1), false]);
          if (maxFlaky < total) checks.push([{ maxFlakyRate: threshold }, run(total, 0, maxFlaky + 1), false]);
          for (const [config, results, expected] of checks) {
            if (rule(config, results).passed !== expected) wrong.push(`${JSON.stringify(config)} total=${total}`);
          }
        }
      }
      expect({ wrong: wrong.length, first: wrong.slice(0, 3) }).toEqual({ wrong: 0, first: [] });
    });
  });

  // Phase 10: Accessibility
  describe('accessibility gates', () => {
    const a11y = (...impacts: A11yImpact[]): TestResultData['a11y'] => ({
      violations: impacts.map((impact, i) => ({
        id: `rule-${i}`, impact, description: '', helpUrl: '', wcagTags: [], nodes: [],
      })),
      passes: 10,
      incomplete: 0,
      inapplicable: 0,
      timestamp: '',
      standard: 'WCAG2AA',
    });
    // 4 violations over two scanned tests: 1 critical, 2 serious, 1 minor
    const scanned = [
      createTestResult({ testId: 't1', a11y: a11y('critical', 'serious') }),
      createTestResult({ testId: 't2', a11y: a11y('serious', 'minor') }),
      createTestResult({ testId: 't3' }),
    ];

    it('passes maxA11yViolations at the threshold', () => {
      const result = evaluator.evaluate({ maxA11yViolations: 4 }, scanned);
      expect(result.passed).toBe(true);
      expect(result.rules).toEqual([{ rule: 'maxA11yViolations', passed: true, actual: '4', threshold: '≤ 4' }]);
    });

    it('fails maxA11yViolations above the threshold', () => {
      const result = evaluator.evaluate({ maxA11yViolations: 3 }, scanned);
      expect(result.passed).toBe(false);
      expect(result.rules).toEqual([{ rule: 'maxA11yViolations', passed: false, actual: '4', threshold: '≤ 3' }]);
    });

    it('counts only the matching impact for maxA11yCritical and maxA11ySerious', () => {
      const result = evaluator.evaluate({ maxA11yCritical: 0, maxA11ySerious: 2 }, scanned);
      expect(result.passed).toBe(false);
      expect(result.rules).toEqual([
        { rule: 'maxA11yCritical', passed: false, actual: '1', threshold: '≤ 0' },
        { rule: 'maxA11ySerious', passed: true, actual: '2', threshold: '≤ 2' },
      ]);
    });

    it('skips a11y gates when no test was scanned', () => {
      const result = evaluator.evaluate(
        { maxA11yViolations: 0, maxA11yCritical: 0, maxA11ySerious: 0 },
        [createTestResult(), createTestResult({ testId: 'test-2' })],
      );
      expect(result.passed).toBe(true);
      expect(result.rules.map(r => [r.rule, r.passed, r.actual, r.skipped])).toEqual([
        ['maxA11yViolations', true, 'N/A', true],
        ['maxA11yCritical', true, 'N/A', true],
        ['maxA11ySerious', true, 'N/A', true],
      ]);
    });
  });
});
