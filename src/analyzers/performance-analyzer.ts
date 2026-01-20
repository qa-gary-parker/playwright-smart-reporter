import type { TestResultData, TestHistoryEntry, PerformanceMetrics } from '../types';

/**
 * Analyzes test performance trends and regressions
 */
export class PerformanceAnalyzer {
  private performanceThreshold: number;

  constructor(performanceThreshold: number = 0.2) {
    this.performanceThreshold = performanceThreshold;
  }

  /**
   * Analyze performance trend for a test
   */
  analyze(test: TestResultData, history: TestHistoryEntry[]): void {
    if (test.status === 'skipped') {
      test.performanceTrend = '→ Skipped';
      return;
    }

    if (history.length === 0) {
      test.performanceTrend = '→ Baseline';
      return;
    }

    // Filter out skipped runs for performance calculation
    const relevantHistory = history.filter(e => !e.skipped);

    if (relevantHistory.length === 0) {
      test.performanceTrend = '→ Baseline';
      return;
    }

    // Calculate average duration from history (rounded to whole ms)
    const avgDuration = Math.round(relevantHistory.reduce((sum, e) => sum + e.duration, 0) / relevantHistory.length);
    test.averageDuration = avgDuration;

    // Calculate performance trend
    test.performanceTrend = this.getPerformanceTrend(test.duration, avgDuration);

    // Add detailed performance metrics
    test.performanceMetrics = this.calculateMetrics(test.duration, avgDuration);
  }

  /**
   * Get human-readable performance trend
   */
  private getPerformanceTrend(current: number, average: number): string {
    const diff = (current - average) / average;

    if (diff > this.performanceThreshold) {
      return `↑ ${Math.round(diff * 100)}% slower`;
    }
    if (diff < -this.performanceThreshold) {
      return `↓ ${Math.round(Math.abs(diff) * 100)}% faster`;
    }
    return '→ Stable';
  }

  /**
   * Calculate detailed performance metrics
   */
  private calculateMetrics(current: number, average: number): PerformanceMetrics {
    const percentChange = Math.round(((current - average) / average) * 1000) / 10; // 1 decimal place
    const absoluteChange = Math.round(current - average); // whole ms
    const isRegression = percentChange > this.performanceThreshold * 100;
    const isImprovement = percentChange < -this.performanceThreshold * 100;

    // Determine severity based on magnitude of change
    let severity: 'low' | 'medium' | 'high' = 'low';
    const absPercentChange = Math.abs(percentChange);

    if (absPercentChange > 50) {
      severity = 'high';
    } else if (absPercentChange > 25) {
      severity = 'medium';
    }

    return {
      averageDuration: average,
      currentDuration: current,
      percentChange,
      absoluteChange,
      threshold: this.performanceThreshold,
      isRegression,
      isImprovement,
      severity,
    };
  }

  /**
   * Check if test is slow compared to history
   */
  isSlow(test: TestResultData): boolean {
    return test.performanceTrend?.startsWith('↑') || false;
  }

  /**
   * Check if test improved performance
   */
  isFaster(test: TestResultData): boolean {
    return test.performanceTrend?.startsWith('↓') || false;
  }

  /**
   * Get performance status for filtering
   */
  getStatus(trend?: string): 'slow' | 'fast' | 'stable' {
    if (!trend) return 'stable';
    if (trend.startsWith('↑')) return 'slow';
    if (trend.startsWith('↓')) return 'fast';
    return 'stable';
  }

  /**
   * Calculate smart thresholds based on test duration
   * Shorter tests should have tighter thresholds
   */
  calculateSmartThreshold(duration: number): number {
    // For very fast tests (<100ms), use tighter threshold
    if (duration < 100) return 0.5; // 50% variance allowed

    // For fast tests (<1s), use moderate threshold
    if (duration < 1000) return 0.3; // 30% variance allowed

    // For normal tests (<10s), use default threshold
    if (duration < 10000) return this.performanceThreshold;

    // For slow tests (>10s), use looser threshold
    return 0.15; // 15% variance allowed
  }
}
