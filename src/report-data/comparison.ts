import type { ComparisonChanges, RunComparison, RunSummary, TestResultData } from '../types';
import { MIN_DURATION_CHANGE_MS } from '../analyzers/performance-analyzer';
import { isFailedTest, isPassedTest } from '../utils/flakiness';

export function buildComparison(
  currentTests: TestResultData[],
  currentSummary: RunSummary,
  baselineSummary: RunSummary,
  baselineTests: Map<string, TestResultData>,
  threshold = 0.2,
): RunComparison {
  const changes: ComparisonChanges = {
    newFailures: [],
    fixedTests: [],
    newTests: [],
    regressions: [],
    improvements: []
  };

  for (const test of currentTests) {
    const baselineTest = baselineTests.get(test.testId);

    if (!baselineTest) {
      // New test
      changes.newTests.push(test);
      continue;
    }

    // Outcome, not status: a test.fail() test that failed as expected passed, and one that passed failed
    if (isFailedTest(test) && isPassedTest(baselineTest)) {
      changes.newFailures.push(test);
    }

    if (isPassedTest(test) && isFailedTest(baselineTest)) {
      changes.fixedTests.push(test);
    }

    // Check for performance regressions/improvements
    if (test.status === 'passed' && baselineTest.status === 'passed') {
      const baselineDuration = baselineTest.duration;
      const currentDuration = test.duration;
      const pctChange = (currentDuration - baselineDuration) / baselineDuration;

      const msChange = currentDuration - baselineDuration;

      if (pctChange > threshold && msChange >= MIN_DURATION_CHANGE_MS) {
        changes.regressions.push({
          ...test,
          averageDuration: baselineDuration
        });
      } else if (pctChange < -threshold && -msChange >= MIN_DURATION_CHANGE_MS) {
        changes.improvements.push({
          ...test,
          averageDuration: baselineDuration
        });
      }
    }
  }

  return {
    baselineRun: baselineSummary,
    currentRun: currentSummary,
    changes
  };
}
