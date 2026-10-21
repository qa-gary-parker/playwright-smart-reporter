import type { TestResultData, TestHistoryEntry, PerformanceMetrics, StepTrend } from '../types';
import { MIN_SAMPLE_RUNS, median } from '../utils/stats';
import { stepDurationsOf } from './causal-timeline';

// A change also has to be this many ms, so jitter in short tests is not a trend.
export const MIN_DURATION_CHANGE_MS = 250;
// Steps are shorter than tests; 100ms is also the flake forecast's floor for duration drift.
const MIN_STEP_CHANGE_MS = 100;

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

    // A failed run times the failure, not the test, so only passing runs form the baseline.
    const relevantHistory = history.filter(e => e.passed && !e.skipped);

    if (relevantHistory.length === 0) {
      test.performanceTrend = '→ Baseline';
      return;
    }

    // The median keeps one slow outlier from moving the baseline (rounded to whole ms).
    const baseline = Math.round(median(relevantHistory.map(e => e.duration)));
    // A 0ms baseline has no percentage change to report.
    if (baseline === 0) {
      test.performanceTrend = '→ Baseline';
      return;
    }
    test.averageDuration = baseline;

    // A failed run's duration is mostly time spent waiting on the failure, not a speed change.
    if (test.status !== 'passed') {
      test.performanceTrend = '→ Not compared';
      return;
    }

    // MIN_SAMPLE_RUNS counts this run, so history needs one passing run fewer.
    if (relevantHistory.length < MIN_SAMPLE_RUNS - 1) {
      test.performanceTrend = '→ Insufficient history';
      return;
    }

    // Calculate performance trend
    test.performanceTrend = this.getPerformanceTrend(test.duration, baseline);

    // Add detailed performance metrics
    test.performanceMetrics = this.calculateMetrics(test.duration, baseline);

    const stepTrends = this.slowerSteps(test, relevantHistory);
    if (stepTrends.length > 0) test.stepTrends = stepTrends;
  }

  /**
   * This run's test.step titles that took longer than the median of the same step in passing
   * runs, by more than the threshold and at least MIN_STEP_CHANGE_MS.
   */
  private slowerSteps(test: TestResultData, passing: TestHistoryEntry[]): StepTrend[] {
    const trends: StepTrend[] = [];
    for (const [title, current] of Object.entries(stepDurationsOf(test.steps) ?? {})) {
      const samples = passing.flatMap(e => e.stepDurations?.[title] ?? []);
      if (samples.length < MIN_SAMPLE_RUNS - 1) continue;
      const baseline = median(samples);
      if (baseline === 0 || (current - baseline) / baseline <= this.performanceThreshold || current - baseline < MIN_STEP_CHANGE_MS) continue;
      trends.push({ title, median: Math.round(baseline), current, ratio: Math.round((current / baseline) * 10) / 10 });
    }
    return trends;
  }

  /**
   * Get human-readable performance trend
   */
  private getPerformanceTrend(current: number, average: number): string {
    const diff = (current - average) / average;

    if (diff > this.performanceThreshold && current - average >= MIN_DURATION_CHANGE_MS) {
      return `↑ ${Math.round(diff * 100)}% slower`;
    }
    if (diff < -this.performanceThreshold && average - current >= MIN_DURATION_CHANGE_MS) {
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
    const isRegression = percentChange > this.performanceThreshold * 100 && absoluteChange >= MIN_DURATION_CHANGE_MS;
    const isImprovement = percentChange < -this.performanceThreshold * 100 && absoluteChange <= -MIN_DURATION_CHANGE_MS;

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
}
