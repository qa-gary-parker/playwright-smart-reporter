import type { TestResultData, TestHistoryEntry } from '../types';

/**
 * Analyzes test flakiness based on historical pass/fail patterns
 */
export class FlakinessAnalyzer {
  /**
   * Calculate flakiness score and indicator for a test
   * @param test - The test result to analyze
   * @param history - Historical test results for this test
   */
  analyze(test: TestResultData, history: TestHistoryEntry[]): void {
    // For skipped tests, set a special indicator
    if (test.status === 'skipped') {
      test.flakinessIndicator = '⚪ Skipped';
      return;
    }

    if (history.length === 0) {
      test.flakinessIndicator = '⚪ New';
      return;
    }

    // Filter out skipped runs for flakiness calculation
    const relevantHistory = history.filter(e => !e.skipped);

    if (relevantHistory.length === 0) {
      // All history entries were skipped
      test.flakinessIndicator = '⚪ New';
      return;
    }

    const failures = relevantHistory.filter(e => !e.passed).length;
    const flakinessScore = Math.round((failures / relevantHistory.length) * 100) / 100; // 2 decimal places

    test.flakinessScore = flakinessScore;
    test.flakinessIndicator = this.getFlakinessIndicator(flakinessScore);
  }

  /**
   * Get human-readable flakiness indicator
   */
  private getFlakinessIndicator(score: number): string {
    if (score < 0.1) return '🟢 Stable';
    if (score < 0.3) return '🟡 Unstable';
    return '🔴 Flaky';
  }

  /**
   * Get flakiness status for filtering
   */
  getStatus(score?: number): 'stable' | 'unstable' | 'flaky' | 'new' {
    if (score === undefined) return 'new';
    if (score < 0.1) return 'stable';
    if (score < 0.3) return 'unstable';
    return 'flaky';
  }
}
