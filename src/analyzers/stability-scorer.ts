import type { TestResultData, StabilityScore, SuiteStats, ThresholdConfig } from '../types';

/**
 * Calculates comprehensive stability scores for tests and test suites
 */
export class StabilityScorer {
  private stabilityThreshold: number;
  private weightFlakiness: number;
  private weightPerformance: number;
  private weightReliability: number;
  private gradeA: number;
  private gradeB: number;
  private gradeC: number;
  private gradeD: number;

  constructor(stabilityThreshold: number = 70, thresholds?: ThresholdConfig) {
    this.stabilityThreshold = stabilityThreshold;
    this.weightFlakiness = thresholds?.stabilityWeightFlakiness ?? 0.4;
    this.weightPerformance = thresholds?.stabilityWeightPerformance ?? 0.3;
    this.weightReliability = thresholds?.stabilityWeightReliability ?? 0.3;
    this.gradeA = thresholds?.gradeA ?? 90;
    this.gradeB = thresholds?.gradeB ?? 80;
    this.gradeC = thresholds?.gradeC ?? 70;
    this.gradeD = thresholds?.gradeD ?? 60;
  }

  /**
   * Calculate stability score for a single test
   */
  scoreTest(test: TestResultData): void {
    // Calculate component scores
    const flakiness = this.calculateFlakinessScore(test);
    const performance = this.calculatePerformanceScore(test);
    const reliability = this.calculateReliabilityScore(test);

    // Overall score is weighted average
    const overall = Math.round(
      flakiness * this.weightFlakiness +
      performance * this.weightPerformance +
      reliability * this.weightReliability
    );

    const grade = this.getGrade(overall);
    const needsAttention = overall < this.stabilityThreshold;

    test.stabilityScore = {
      overall,
      flakiness,
      performance,
      reliability,
      grade,
      needsAttention,
    };
  }

  /**
   * Calculate flakiness component (0-100, higher is better)
   */
  private calculateFlakinessScore(test: TestResultData): number {
    if (test.flakinessScore === undefined) return 100; // New test, assume stable

    // Convert flakiness score (0-1, higher is worse) to stability score (0-100, higher is better)
    return Math.round((1 - test.flakinessScore) * 100);
  }

  /**
   * Calculate performance component (0-100, higher is better)
   */
  private calculatePerformanceScore(test: TestResultData): number {
    const metrics = test.performanceMetrics;
    if (!metrics) return 100; // No history, assume good

    // If test improved, give bonus
    if (metrics.isImprovement) return 100;

    // If test is stable, give good score
    if (!metrics.isRegression) return 90;

    // Score based on severity of regression
    switch (metrics.severity) {
      case 'low': return 75;
      case 'medium': return 50;
      case 'high': return 25;
      default: return 100;
    }
  }

  /**
   * Calculate reliability component (0-100, higher is better)
   */
  private calculateReliabilityScore(test: TestResultData): number {
    const retry = test.retryInfo;

    // Passed without retries = excellent
    if (test.status === 'passed' && (!retry || retry.totalRetries === 0)) {
      return 100;
    }

    // Passed with retries = good but concerning
    if (test.status === 'passed' && retry && retry.totalRetries > 0) {
      return Math.max(50, 100 - (retry.totalRetries * 15));
    }

    // Failed = bad
    if (test.status === 'failed' || test.status === 'timedOut') {
      return retry ? Math.max(0, 40 - (retry.totalRetries * 10)) : 40;
    }

    // Skipped = neutral
    if (test.status === 'skipped') {
      return 75;
    }

    return 50;
  }

  /**
   * Convert numeric score to letter grade
   */
  private getGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
    if (score >= this.gradeA) return 'A';
    if (score >= this.gradeB) return 'B';
    if (score >= this.gradeC) return 'C';
    if (score >= this.gradeD) return 'D';
    return 'F';
  }

  /**
   * Calculate suite-wide statistics
   */
  calculateSuiteStats(results: TestResultData[]): SuiteStats {
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const flaky = results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
    const slow = results.filter(r => r.performanceTrend?.startsWith('↑')).length;
    const needsRetry = results.filter(r => r.retryInfo?.needsAttention).length;

    const passRate = (passed + failed) > 0
      ? Math.round((passed / (passed + failed)) * 100)
      : 0;

    // Calculate average stability from tests that have scores
    const testsWithScores = results.filter(r => r.stabilityScore);
    const averageStability = testsWithScores.length > 0
      ? Math.round(
          testsWithScores.reduce((sum, r) => sum + r.stabilityScore!.overall, 0) /
          testsWithScores.length
        )
      : 0;

    return {
      total,
      passed,
      failed,
      skipped,
      flaky,
      slow,
      needsRetry,
      passRate,
      averageStability,
    };
  }

  /**
   * Get tests that need attention based on stability score
   */
  getProblematicTests(results: TestResultData[]): TestResultData[] {
    return results.filter(r => r.stabilityScore?.needsAttention);
  }

  /**
   * Get stability summary string
   */
  getSummary(score: StabilityScore): string {
    return `Grade ${score.grade} (${score.overall}/100) - ${score.needsAttention ? '⚠️ Needs Attention' : '✅ Stable'}`;
  }
}
