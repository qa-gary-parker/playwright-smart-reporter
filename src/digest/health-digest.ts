import type { TestHistory, RunSummary, TestHistoryEntry, DigestOptions } from '../types';
import { FlakinessAnalyzer } from '../analyzers/flakiness-analyzer';
import { median } from '../utils/stats';

export interface DigestData {
  period: string;
  startDate: string;
  endDate: string;
  runsAnalyzed: number;
  passRateTrend: { direction: 'up' | 'down' | 'stable'; from: number; to: number } | null;
  newFlakyTests: Array<{ testId: string; flakinessScore: number; runs: number }>;
  recoveredTests: Array<{ testId: string; stableForRuns: number }>;
  performanceTrends: Array<{ testId: string; percentChange: number }>;
  summary: string;
}

const PERIOD_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const FLAKY_THRESHOLD = 0.3;
const PERFORMANCE_THRESHOLD = 20;
const MIN_STABLE_RUNS = 3;

export class HealthDigest {
  private flakiness = new FlakinessAnalyzer();

  analyze(history: TestHistory, options: DigestOptions): DigestData {
    const now = Date.now();
    const periodMs = PERIOD_MS[options.period] ?? PERIOD_MS.weekly;
    const periodStart = now - periodMs;
    const startDate = new Date(periodStart).toISOString().split('T')[0];
    const endDate = new Date(now).toISOString().split('T')[0];

    const summaries = history.summaries ?? [];
    const inPeriod = summaries
      .filter(s => new Date(s.timestamp).getTime() >= periodStart)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (inPeriod.length === 0) {
      return {
        period: options.period,
        startDate,
        endDate,
        runsAnalyzed: 0,
        passRateTrend: null,
        newFlakyTests: [],
        recoveredTests: [],
        performanceTrends: [],
        summary: '0 runs analyzed. No data available for this period.',
      };
    }

    // Runs where every test was skipped have no pass rate to trend.
    const rated = inPeriod.filter((s): s is RunSummary & { passRate: number } => s.passRate !== null);
    const passRateTrend = rated.length > 0 ? this.calculatePassRateTrend(rated) : null;
    const newFlakyTests = this.findNewFlakyTests(history.tests, periodStart);
    const recoveredTests = this.findRecoveredTests(history.tests, periodStart);
    const performanceTrends = this.findPerformanceTrends(history.tests, periodStart);

    const trendText = passRateTrend
      ? `Pass rate trending ${passRateTrend.direction} (${passRateTrend.from}% -> ${passRateTrend.to}%).`
      : 'No pass rate data.';
    const summary = `${inPeriod.length} runs analyzed. ${trendText}`;

    return {
      period: options.period,
      startDate,
      endDate,
      runsAnalyzed: inPeriod.length,
      passRateTrend,
      newFlakyTests,
      recoveredTests,
      performanceTrends,
      summary,
    };
  }

  generateMarkdown(data: DigestData): string {
    const lines: string[] = [];

    lines.push(`# Test Health Digest (${data.period}: ${data.startDate} - ${data.endDate})`);
    lines.push('');
    lines.push('## Summary');
    lines.push(data.summary);
    lines.push('');

    lines.push(`## New Flaky Tests (${data.newFlakyTests.length})`);
    if (data.newFlakyTests.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.newFlakyTests) {
        lines.push(`- \`${t.testId}\` (flakiness: ${t.flakinessScore.toFixed(2)}, ${t.runs} runs)`);
      }
    }
    lines.push('');

    lines.push(`## Recovered Tests (${data.recoveredTests.length})`);
    if (data.recoveredTests.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.recoveredTests) {
        lines.push(`- \`${t.testId}\` (stable for ${t.stableForRuns} runs)`);
      }
    }
    lines.push('');

    lines.push('## Performance Trends');
    if (data.performanceTrends.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.performanceTrends) {
        lines.push(`- \`${t.testId}\` slowed ${Math.round(t.percentChange)}% over period`);
      }
    }
    lines.push('');

    lines.push('## Recommendations');
    const recommendations = this.buildRecommendations(data);
    if (recommendations.length === 0) {
      lines.push('No action items.');
    } else {
      for (const r of recommendations) {
        lines.push(`- ${r}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }

  generateText(data: DigestData): string {
    const lines: string[] = [];

    lines.push(`Test Health Digest (${data.period}: ${data.startDate} - ${data.endDate})`);
    lines.push('='.repeat(70));
    lines.push('');
    lines.push('Summary');
    lines.push('-'.repeat(40));
    lines.push(data.summary);
    lines.push('');

    lines.push(`New Flaky Tests (${data.newFlakyTests.length})`);
    lines.push('-'.repeat(40));
    if (data.newFlakyTests.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.newFlakyTests) {
        lines.push(`- ${t.testId} (flakiness: ${t.flakinessScore.toFixed(2)}, ${t.runs} runs)`);
      }
    }
    lines.push('');

    lines.push(`Recovered Tests (${data.recoveredTests.length})`);
    lines.push('-'.repeat(40));
    if (data.recoveredTests.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.recoveredTests) {
        lines.push(`- ${t.testId} (stable for ${t.stableForRuns} runs)`);
      }
    }
    lines.push('');

    lines.push('Performance Trends');
    lines.push('-'.repeat(40));
    if (data.performanceTrends.length === 0) {
      lines.push('None');
    } else {
      for (const t of data.performanceTrends) {
        lines.push(`- ${t.testId} slowed ${Math.round(t.percentChange)}% over period`);
      }
    }
    lines.push('');

    lines.push('Recommendations');
    lines.push('-'.repeat(40));
    const recommendations = this.buildRecommendations(data);
    if (recommendations.length === 0) {
      lines.push('No action items.');
    } else {
      for (const r of recommendations) {
        lines.push(`- ${r}`);
      }
    }
    lines.push('');

    return lines.join('\n');
  }

  private calculatePassRateTrend(
    summaries: Array<RunSummary & { passRate: number }>,
  ): { direction: 'up' | 'down' | 'stable'; from: number; to: number } {
    const first = summaries[0];
    const last = summaries[summaries.length - 1];
    const diff = last.passRate - first.passRate;

    let direction: 'up' | 'down' | 'stable';
    if (diff > 1) {
      direction = 'up';
    } else if (diff < -1) {
      direction = 'down';
    } else {
      direction = 'stable';
    }

    return { direction, from: first.passRate, to: last.passRate };
  }

  private findNewFlakyTests(
    tests: Record<string, TestHistoryEntry[]>,
    periodStart: number,
  ): Array<{ testId: string; flakinessScore: number; runs: number }> {
    const result: Array<{ testId: string; flakinessScore: number; runs: number }> = [];

    for (const [testId, entries] of Object.entries(tests)) {
      const inPeriod = entries.filter(
        e => !e.skipped && new Date(e.timestamp).getTime() >= periodStart,
      );
      const beforePeriod = entries.filter(
        e => !e.skipped && new Date(e.timestamp).getTime() < periodStart,
      );

      if (inPeriod.length === 0) continue;

      // The report's classification: a test that fails every run, broke, or was fixed is not flaky.
      const current = this.flakiness.classify(inPeriod);
      if (current.status !== 'flaky') continue;
      if (beforePeriod.length > 0 && this.flakiness.classify(beforePeriod).status === 'flaky') continue; // Already flaky, not new

      result.push({ testId, flakinessScore: current.score, runs: current.runs });
    }

    return result;
  }

  private findRecoveredTests(
    tests: Record<string, TestHistoryEntry[]>,
    periodStart: number,
  ): Array<{ testId: string; stableForRuns: number }> {
    const result: Array<{ testId: string; stableForRuns: number }> = [];

    for (const [testId, entries] of Object.entries(tests)) {
      const beforePeriod = entries.filter(
        e => !e.skipped && new Date(e.timestamp).getTime() < periodStart,
      );

      if (beforePeriod.length === 0) continue;

      const previousScore = beforePeriod.filter(e => !e.passed).length / beforePeriod.length;
      if (previousScore < FLAKY_THRESHOLD) continue; // Was not flaky before

      // Count consecutive passing runs at the end of the period entries
      const inPeriod = entries
        .filter(e => !e.skipped && new Date(e.timestamp).getTime() >= periodStart)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      if (inPeriod.length === 0) continue;

      // Check all passed in period
      const allPassed = inPeriod.every(e => e.passed);
      if (!allPassed) continue;

      if (inPeriod.length >= MIN_STABLE_RUNS) {
        result.push({ testId, stableForRuns: inPeriod.length });
      }
    }

    return result;
  }

  private findPerformanceTrends(
    tests: Record<string, TestHistoryEntry[]>,
    periodStart: number,
  ): Array<{ testId: string; percentChange: number }> {
    const result: Array<{ testId: string; percentChange: number }> = [];

    for (const [testId, entries] of Object.entries(tests)) {
      // As in PerformanceAnalyzer: a failed run times the failure, and the median ignores one slow pass.
      const passed = entries.filter(e => e.passed && !e.skipped);
      const inPeriod = passed.filter(e => new Date(e.timestamp).getTime() >= periodStart).map(e => e.duration);
      const beforePeriod = passed.filter(e => new Date(e.timestamp).getTime() < periodStart).map(e => e.duration);

      if (inPeriod.length === 0 || beforePeriod.length === 0) continue;

      const medianBefore = median(beforePeriod);
      const medianInPeriod = median(inPeriod);

      if (medianBefore === 0) continue;

      const percentChange = ((medianInPeriod - medianBefore) / medianBefore) * 100;

      if (percentChange > PERFORMANCE_THRESHOLD) {
        result.push({
          testId,
          percentChange: Math.round(percentChange * 10) / 10,
        });
      }
    }

    return result;
  }

  private buildRecommendations(data: DigestData): string[] {
    const recs: string[] = [];

    for (const t of data.newFlakyTests) {
      recs.push(`Investigate ${t.testId} — possible flakiness issue`);
      if (t.flakinessScore > 0.5) {
        recs.push(`Consider quarantining ${t.testId} with flakiness > 0.5`);
      }
    }

    for (const t of data.performanceTrends) {
      recs.push(`Review ${t.testId} — ${Math.round(t.percentChange)}% performance regression`);
    }

    return recs;
  }
}
