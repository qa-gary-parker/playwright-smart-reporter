import type { TestResultData, TestHistoryEntry, RetryInfo } from '../types';

/**
 * Analyzes test retry patterns to identify tests that frequently need retries
 */
export class RetryAnalyzer {
  private retryFailureThreshold: number;

  constructor(retryFailureThreshold: number = 3) {
    this.retryFailureThreshold = retryFailureThreshold;
  }

  /**
   * Analyze retry pattern for a test
   * @param test - The test result to analyze
   * @param history - Historical test results for this test
   */
  analyze(test: TestResultData, history: TestHistoryEntry[]): void {
    const retryInfo = this.calculateRetryInfo(test, history);
    test.retryInfo = retryInfo;
  }

  /**
   * Calculate detailed retry information
   * @param test - The test result
   * @param history - Historical test results
   * @returns Retry information object
   */
  private calculateRetryInfo(test: TestResultData, history: TestHistoryEntry[]): RetryInfo {
    const totalRetries = test.retry;
    // passedOnRetry: Index of the retry on which test passed (0-based), or -1 if never passed
    const passedOnRetry = test.status === 'passed' && totalRetries > 0 ? totalRetries : -1;
    const failedRetries = test.status === 'failed' || test.status === 'timedOut' ? totalRetries : 0;

    // Build retry pattern (simplified - we don't have individual retry results)
    const retryPattern: boolean[] = [];
    if (totalRetries > 0) {
      // Add failures for all retries before the final attempt
      for (let i = 0; i < totalRetries; i++) {
        retryPattern.push(false);
      }
      // Add final result
      retryPattern.push(test.status === 'passed');
    } else {
      retryPattern.push(test.status === 'passed');
    }

    // Check if this test frequently needs retries based on history
    const historyWithRetries = history.filter(h => h.retry && h.retry > 0);
    const needsAttention =
      totalRetries >= this.retryFailureThreshold ||
      (history.length > 0 && historyWithRetries.length / history.length > 0.5);

    return {
      totalRetries,
      passedOnRetry,
      failedRetries,
      retryPattern,
      needsAttention,
    };
  }

  /**
   * Check if test needs attention due to retry patterns
   */
  needsAttention(test: TestResultData): boolean {
    return test.retryInfo?.needsAttention || false;
  }

  /**
   * Get retry summary for a test
   */
  getRetrySummary(test: TestResultData): string {
    const retry = test.retryInfo;
    if (!retry || retry.totalRetries === 0) {
      return 'No retries';
    }

    if (retry.passedOnRetry >= 0) {
      return `Passed on attempt ${retry.passedOnRetry + 1} of ${retry.totalRetries + 1}`;
    }

    return `Failed after ${retry.totalRetries + 1} attempts`;
  }

  /**
   * Calculate retry rate from all results
   */
  calculateRetryRate(results: TestResultData[]): number {
    const testsWithRetries = results.filter(r => r.retry > 0).length;
    return results.length > 0 ? testsWithRetries / results.length : 0;
  }

  /**
   * Get tests that need attention due to retries
   */
  getProblematicTests(results: TestResultData[]): TestResultData[] {
    return results.filter(r => this.needsAttention(r));
  }
}
