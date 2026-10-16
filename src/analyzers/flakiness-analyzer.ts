import type { FlakinessStatus, TestResultData, TestHistoryEntry, ThresholdConfig } from '../types';
import { isPassedTest } from '../utils/flakiness';

export interface Flakiness {
  score: number;
  status: FlakinessStatus;
  runs: number;
}

const INDICATOR: Record<FlakinessStatus, string> = {
  stable: '🟢 Stable',
  unstable: '🟡 Unstable',
  flaky: '🔴 Flaky',
  failing: '🔴 Failing',
};

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

    const flakiness = this.classify([...relevantHistory, { passed: isPassedTest(test), retry: test.retry }]);
    test.flakinessScore = flakiness.score;
    test.flakinessStatus = flakiness.status;
    test.flakinessRuns = flakiness.runs;
    test.flakinessIndicator = INDICATOR[flakiness.status];
  }

  /**
   * Score and classify runs, oldest first, with the latest run last. Skipped runs are ignored;
   * at least one run must remain.
   *
   * The score is the share of runs that failed or passed only on a retry. The status measures
   * instability instead: a test that was broken and then fixed changed result once, which is a
   * fix, not flakiness. Each later change means the result changed back.
   */
  classify(series: Array<Pick<TestHistoryEntry, 'passed' | 'retry' | 'skipped'>>): Flakiness {
    const runs = series.filter(e => !e.skipped);
    const n = runs.length;
    const failures = runs.filter(e => !e.passed).length;
    const retried = runs.filter(e => e.passed && (e.retry ?? 0) > 0).length;
    // Round to 2 decimals, but reserve a score of exactly 1 for tests where
    // EVERY run failed — score-based consumers treat 1 as "consistently
    // failing", so a 199/200 failure rate must not round up to 1.
    const rounded = Math.round(((failures + retried) / n) * 100) / 100;
    const score = failures === n ? 1 : Math.min(rounded, 0.99);
    return { score, status: this.status(runs, failures, retried), runs: n };
  }

  private status(runs: Array<Pick<TestHistoryEntry, 'passed' | 'retry'>>, failures: number, retried: number): FlakinessStatus {
    const n = runs.length;
    const latest = runs[n - 1];
    if (failures === n) return 'failing';
    // Playwright calls a test that passed on a retry flaky, whatever its history
    if (latest.passed && (latest.retry ?? 0) > 0) return 'flaky';
    let flips = 0;
    for (let k = 1; k < n; k++) if (runs[k].passed !== runs[k - 1].passed) flips++;
    const instability = (Math.max(flips - 1, 0) + retried) / n;
    if (instability >= this.unstableThreshold) return 'flaky';
    if (instability >= this.stableThreshold) return 'unstable';
    return latest.passed ? 'stable' : 'failing';
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
