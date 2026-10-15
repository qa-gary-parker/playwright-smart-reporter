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

/** Playwright's verdict for this run: a failure, which includes a test.fail() test that passed. */
export function isFailedTest(test: Pick<TestResultData, 'status' | 'outcome'>): boolean {
  return test.outcome ? test.outcome === 'unexpected' : test.status === 'failed' || test.status === 'timedOut';
}

/** Passed, passed on retry, or a test.fail() test that failed as expected. */
export function isPassedTest(test: Pick<TestResultData, 'status' | 'outcome'>): boolean {
  return test.outcome ? test.outcome === 'expected' || test.outcome === 'flaky' : test.status === 'passed';
}

/** Did not run: skipped, never started, or interrupted before it got a result. */
export function isSkippedTest(test: Pick<TestResultData, 'status' | 'outcome'>): boolean {
  return test.outcome ? test.outcome === 'skipped' : test.status === 'skipped' || test.status === 'interrupted';
}

/** True when the test should be treated as flaky (score or per-run outcome). */
export function isFlakyTest(test: Pick<TestResultData, 'flakinessScore' | 'outcome'>, threshold = 0.3): boolean {
  return test.outcome === 'flaky' || isFlakyScore(test.flakinessScore, threshold);
}
