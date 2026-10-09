import type { ComparisonChanges, RunComparison, RunSummary, TestResultData } from '../types';
import { MIN_DURATION_CHANGE_MS } from '../analyzers/performance-analyzer';

export function buildComparison(
  currentTests: TestResultData[],
  currentSummary: RunSummary,
  baselineSummary: RunSummary,
  baselineTests: Map<string, TestResultData>
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

    // Check for new failures (including timedOut)
    if ((test.status === 'failed' || test.status === 'timedOut') && baselineTest.status === 'passed') {
      changes.newFailures.push(test);
    }

    // Check for fixed tests (including previously timedOut)
    if (test.status === 'passed' && (baselineTest.status === 'failed' || baselineTest.status === 'timedOut')) {
      changes.fixedTests.push(test);
    }

    // Check for performance regressions/improvements
    if (test.status === 'passed' && baselineTest.status === 'passed') {
      const baselineDuration = baselineTest.duration;
      const currentDuration = test.duration;
      const pctChange = (currentDuration - baselineDuration) / baselineDuration;

      const msChange = currentDuration - baselineDuration;

      if (pctChange > 0.2 && msChange >= MIN_DURATION_CHANGE_MS) { // 20% slower
        changes.regressions.push({
          ...test,
          averageDuration: baselineDuration
        });
      } else if (pctChange < -0.2 && -msChange >= MIN_DURATION_CHANGE_MS) { // 20% faster
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
