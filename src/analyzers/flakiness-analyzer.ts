import type { TestResultData, TestHistoryEntry, ThresholdConfig } from '../types';

/**
 * Analyzes test flakiness based on historical pass/fail patterns
 */
export class FlakinessAnalyzer {
  private stableThreshold: number;
  private unstableThreshold: number;

  constructor(thresholds?: ThresholdConfig) {
    this.stableThreshold = thresholds?.flakinessStable ?? 0.1;
    this.unstableThreshold = thresholds?.flakinessUnstable ?? 0.3;
  }

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
      // All history entries were skipped — not actually new
      test.flakinessIndicator = '⚪ Skipped';
      return;
    }

    const failures = relevantHistory.filter(e => !e.passed).length;
    // Round to 2 decimals, but reserve a score of exactly 1 for tests where
    // EVERY run failed — score-based consumers treat 1 as "consistently
    // failing", so a 199/200 failure rate must not round up to 1.
    const rounded = Math.round((failures / relevantHistory.length) * 100) / 100;
    const flakinessScore = failures === relevantHistory.length ? 1 : Math.min(rounded, 0.99);

    test.flakinessScore = flakinessScore;
    test.flakinessIndicator = this.getFlakinessIndicator(flakinessScore, failures, relevantHistory.length);
  }

  /**
   * Get human-readable flakiness indicator.
   * A test that fails on every run is consistently failing, not flaky —
   * flakiness requires mixed pass/fail results.
   */
  private getFlakinessIndicator(score: number, failures: number, total: number): string {
    if (failures === total && total > 0) return '🔴 Failing';
    if (score < this.stableThreshold) return '🟢 Stable';
    if (score < this.unstableThreshold) return '🟡 Unstable';
    return '🔴 Flaky';
  }

  /**
   * Get flakiness status for filtering.
   * A score of 1 means every historical run failed — consistently failing, not flaky.
   */
  getStatus(score?: number): 'stable' | 'unstable' | 'flaky' | 'failing' | 'new' {
    if (score === undefined) return 'new';
    if (score >= 1) return 'failing';
    if (score < this.stableThreshold) return 'stable';
    if (score < this.unstableThreshold) return 'unstable';
    return 'flaky';
  }
}
