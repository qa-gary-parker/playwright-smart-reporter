import type { RunSummary, StabilityScore, TestResultData } from '../types';
import { isFailedTest, isPassedTest, isSkippedTest } from './flakiness';

/**
 * Run statistics: the one place that counts a run. Every output (report, history, JSON,
 * gates, PDF, notifications, live counters) reads its numbers from here.
 */

export interface RunStats {
  total: number;
  /** Passed, passed on retry, or a test.fail() test that failed as expected. */
  passed: number;
  /** Playwright's failures, including a test.fail() test that passed. */
  failed: number;
  /** Skipped, never started, or interrupted. */
  skipped: number;
  /** Passed on retry in this run. A flaky history score does not count here. */
  flaky: number;
  /** The tests the pass rate is out of. */
  rated: number;
  /** passed / rated; 0 when nothing is rated. */
  passRatio: number;
  /** passRatio as a whole percent, as summaries store and show it. */
  passRate: number;
}

type Counts = Pick<RunStats, 'total' | 'passed' | 'skipped'>;

function ratedOf(counts: Counts): number {
  return counts.total;
}

/** The pass rate formula, for callers that only have counts (such as merged shard summaries). */
export function passRateOf(counts: Counts): number {
  const rated = ratedOf(counts);
  return rated > 0 ? Math.round((counts.passed / rated) * 100) : 0;
}

export function computeRunStats(results: Array<Pick<TestResultData, 'status' | 'outcome'>>): RunStats {
  const counts = { total: results.length, passed: results.filter(isPassedTest).length, skipped: results.filter(isSkippedTest).length };
  const rated = ratedOf(counts);
  return {
    ...counts,
    failed: results.filter(isFailedTest).length,
    flaky: results.filter(r => r.outcome === 'flaky').length,
    rated,
    passRatio: rated > 0 ? counts.passed / rated : 0,
    passRate: passRateOf(counts),
  };
}

const GRADES = ['F', 'D', 'C', 'B', 'A'] as const;

/** The run's grade: its tests' grades averaged as F=1 to A=5, rounded. Undefined when no test has a grade. */
export function runStabilityGrade(results: Array<Pick<TestResultData, 'stabilityScore'>>): StabilityScore['grade'] | undefined {
  const scores = results.flatMap(r => {
    const i = GRADES.indexOf(r.stabilityScore?.grade as StabilityScore['grade']);
    return i < 0 ? [] : [i + 1];
  });
  if (scores.length === 0) return undefined;
  return GRADES[Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) - 1];
}

/** The run summary that history, the report trends and the comparison save for a run. */
export function buildRunSummary(results: TestResultData[], run: Pick<RunSummary, 'runId' | 'timestamp' | 'duration'>): RunSummary {
  const { total, passed, failed, skipped, flaky, passRate } = computeRunStats(results);
  return {
    runId: run.runId,
    timestamp: run.timestamp,
    total,
    passed,
    failed,
    skipped,
    flaky,
    slow: results.filter(r => r.performanceTrend?.startsWith('↑')).length,
    duration: run.duration,
    passRate,
    stabilityGrade: runStabilityGrade(results),
  };
}
