import type { TestResultData } from '../types';

/**
 * Flakiness helpers shared across analyzers, generators, and the reporter.
 *
 * A test is flaky when its history shows MIXED results (some passes, some
 * failures). A score of 1 means every historical run failed — that test is
 * consistently failing, which is a different (and usually more urgent)
 * problem than flakiness.
 */

/** True when the score indicates genuine flakiness (mixed pass/fail history). */
export function isFlakyScore(score: number | undefined, threshold = 0.3): boolean {
  return score !== undefined && score >= threshold && score < 1;
}

/** True when every historical run of the test failed. */
export function isConsistentlyFailingScore(score: number | undefined): boolean {
  return score !== undefined && score >= 1;
}

/** True when the test should be treated as flaky (score or per-run outcome). */
export function isFlakyTest(test: Pick<TestResultData, 'flakinessScore' | 'outcome'>, threshold = 0.3): boolean {
  return test.outcome === 'flaky' || isFlakyScore(test.flakinessScore, threshold);
}
