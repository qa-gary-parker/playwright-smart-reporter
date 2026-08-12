import type { TestResultData, TestRecommendation, FailureCluster, SuiteStats, LicenseTier, RunSummary, A11ySuiteScore } from '../types';
import { groupA11yViolations } from './a11y-analyzer';

export interface AIAnalyzerConfig {
  licenseKey?: string;
  tier?: LicenseTier;
  proxyUrl?: string;
}

export class AIAnalyzer {
  private licenseKey?: string;
  private tier: LicenseTier;
  private proxyUrl: string;
  private quotaLogged = false;
  private rateLimited = false;

  constructor(config?: AIAnalyzerConfig) {
    this.licenseKey = config?.licenseKey;
    this.tier = config?.tier ?? 'community';
    this.proxyUrl = config?.proxyUrl ?? 'https://stagewright.dev/api/ai/analyze';
  }

  isAvailable(): boolean {
    return !!this.licenseKey && (this.tier === 'starter' || this.tier === 'pro' || this.tier === 'team');
  }

  async analyzeFailed(results: TestResultData[]): Promise<void> {
    const failedTests = results.filter(
      r => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    if (!this.isAvailable()) {
      return;
    }

    console.log(`\n   Analyzing ${failedTests.length} failure(s) with AI...`);

    const BATCH_SIZE = 3;
    for (let i = 0; i < failedTests.length; i += BATCH_SIZE) {
      if (this.rateLimited) break;

      const batch = failedTests.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(failedTests.length / BATCH_SIZE);
      console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} tests)...`);

      const promises = batch.map(async (test) => {
        if (this.rateLimited) return;
        try {
          const prompt = test.aiPrompt ?? this.buildFailurePrompt(test);
          const result = await this.callProxy(prompt, 'failure');
          test.aiSuggestion = result.suggestion;

          if (!this.quotaLogged) {
            this.quotaLogged = true;
            console.log(`   AI quota remaining: ${result.remaining} (resets ${new Date(result.resetAt).toISOString()})`);
          }
        } catch (err) {
          if (!this.rateLimited) {
            console.error(`Failed to get AI suggestion for "${test.title}":`, err);
          }
        }
      });

      await Promise.all(promises);
    }

    if (!this.rateLimited) {
      console.log(`   AI analysis complete`);
    }
  }

  async analyzeClusters(clusters: FailureCluster[]): Promise<void> {
    if (clusters.length === 0) return;
    if (!this.isAvailable() || this.rateLimited) return;

    console.log(`\n   Analyzing ${clusters.length} failure cluster(s) with AI...`);

    for (const cluster of clusters) {
      if (this.rateLimited) break;
      try {
        const prompt = this.buildClusterPrompt(cluster);
        const result = await this.callProxy(prompt, 'cluster');
        cluster.aiSuggestion = result.suggestion;

        if (!this.quotaLogged) {
          this.quotaLogged = true;
          console.log(`   AI quota remaining: ${result.remaining} (resets ${new Date(result.resetAt).toISOString()})`);
        }
      } catch (err) {
        if (!this.rateLimited) {
          console.error(`Failed to get AI suggestion for cluster "${cluster.errorType}":`, err);
        }
      }
    }
  }

  async analyzeSuiteHealth(
    results: TestResultData[],
    stats: SuiteStats,
    failureClusters: FailureCluster[],
    historySummaries: RunSummary[],
  ): Promise<string | undefined> {
    if (!this.isAvailable() || this.rateLimited) return undefined;

    console.log('\n   Generating AI suite health summary...');

    const flakyTests = results.filter(r => r.flakinessScore !== undefined && r.flakinessScore >= 0.3);
    const slowTests = results.filter(r => r.performanceTrend?.startsWith('↑'));
    const retryTests = results.filter(r => r.retryInfo?.needsAttention);

    // Build pass-rate trend from recent history
    const recentRuns = historySummaries.slice(-5);
    const trendLine = recentRuns.length > 0
      ? recentRuns.map(s => `${s.passRate}%`).join(' → ') + ` → ${stats.passRate}% (current)`
      : `${stats.passRate}% (no prior history)`;

    const prompt = this.buildSuiteHealthPrompt(stats, failureClusters, flakyTests, slowTests, retryTests, trendLine);

    try {
      const result = await this.callProxy(prompt, 'suite-health');
      if (!this.quotaLogged) {
        this.quotaLogged = true;
        console.log(`   AI quota remaining: ${result.remaining} (resets ${new Date(result.resetAt).toISOString()})`);
      }
      console.log('   Suite health summary generated');
      return result.suggestion;
    } catch (err) {
      if (!this.rateLimited) {
        console.error('Failed to generate suite health summary:', err);
      }
      return undefined;
    }
  }

  generateRecommendations(results: TestResultData[], stats: SuiteStats): TestRecommendation[] {
    const recommendations: TestRecommendation[] = [];

    // Flakiness recommendations
    const flakyTests = results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3);
    if (flakyTests.length > 0) {
      recommendations.push({
        type: 'flakiness',
        priority: 90,
        title: 'Fix Flaky Tests',
        description: `${flakyTests.length} test(s) are showing flaky behavior (pass/fail inconsistency)`,
        action: 'Review test isolation, add proper waits, investigate race conditions',
        affectedTests: flakyTests.map(t => t.testId),
        icon: '🔴',
      });
    }

    // Retry recommendations
    const retryTests = results.filter(r => r.retryInfo?.needsAttention);
    if (retryTests.length > 0) {
      recommendations.push({
        type: 'retry',
        priority: 80,
        title: 'Reduce Test Retries',
        description: `${retryTests.length} test(s) frequently require retries to pass`,
        action: 'Identify root cause of instability, improve test robustness',
        affectedTests: retryTests.map(t => t.testId),
        icon: '🔄',
      });
    }

    // Performance recommendations
    const slowTests = results.filter(r => r.performanceTrend?.startsWith('↑'));
    if (slowTests.length > 0) {
      recommendations.push({
        type: 'performance',
        priority: 60,
        title: 'Improve Test Performance',
        description: `${slowTests.length} test(s) have gotten significantly slower`,
        action: 'Profile slow steps, optimize waits, consider test parallelization',
        affectedTests: slowTests.map(t => t.testId),
        icon: '🐢',
      });
    }

    // Suite health recommendations
    if (stats.passRate < 90) {
      recommendations.push({
        type: 'suite',
        priority: 95,
        title: 'Improve Suite Pass Rate',
        description: `Overall pass rate is ${stats.passRate}% (target: 90%+)`,
        action: 'Focus on fixing failed tests before adding new tests',
        affectedTests: [],
        icon: '📊',
      });
    }

    if (stats.averageStability < 70) {
      recommendations.push({
        type: 'suite',
        priority: 85,
        title: 'Improve Suite Stability',
        description: `Average stability score is ${stats.averageStability}/100 (target: 70+)`,
        action: 'Address flakiness, retries, and performance issues systematically',
        affectedTests: [],
        icon: '⚠️',
      });
    }

    // Sort by priority (highest first)
    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  async analyzeAccessibility(
    suiteScore: A11ySuiteScore,
    results: TestResultData[],
  ): Promise<string | undefined> {
    if (!this.isAvailable() || this.rateLimited) return undefined;
    if (suiteScore.testsScanned === 0) return undefined;

    console.log('\n   Generating AI accessibility analysis...');

    const topViolations = groupA11yViolations(results)
      .slice(0, 10)
      .map(g => `- [${g.impact}] ${g.id}: ${g.description} (${g.count} tests, ${g.nodes.length} nodes, WCAG: ${g.wcagTags.join(', ') || 'n/a'})`)
      .join('\n');

    const prompt = `You are an accessibility expert reviewing a Playwright test suite's WCAG compliance results. Write a concise, actionable analysis (3-5 sentences) in flowing prose. Focus on the highest-impact issues and provide specific remediation priorities. Do not use bullet points or headers.

Accessibility Score: ${suiteScore.rating}
Tests Scanned: ${suiteScore.testsScanned}
Tests With Violations: ${suiteScore.testsWithViolations}
Total Violations: ${suiteScore.totalViolations}

Severity Breakdown:
- Critical: ${suiteScore.critical}
- Serious: ${suiteScore.serious}
- Moderate: ${suiteScore.moderate}
- Minor: ${suiteScore.minor}

Top Violations:
${topViolations || 'None'}

Write the analysis now.`;

    try {
      const result = await this.callProxy(prompt, 'accessibility');
      if (!this.quotaLogged) {
        this.quotaLogged = true;
        console.log(`   AI quota remaining: ${result.remaining} (resets ${new Date(result.resetAt).toISOString()})`);
      }
      console.log('   Accessibility analysis generated');
      return result.suggestion;
    } catch (err) {
      if (!this.rateLimited) {
        console.error('Failed to generate accessibility analysis:', err);
      }
      return undefined;
    }
  }

  private async callProxy(prompt: string, type: 'failure' | 'cluster' | 'suite-health' | 'accessibility'): Promise<{ suggestion: string; remaining: number; resetAt: number }> {
    const response = await fetch(this.proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.licenseKey}`,
      },
      body: JSON.stringify({ prompt, type }),
    });

    if (response.status === 429) {
      this.rateLimited = true;
      const data = await response.json() as { resetAt: number };
      console.warn(`AI analysis rate limit reached. Resets at ${new Date(data.resetAt).toISOString()}`);
      throw new Error('Rate limit exceeded');
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(`AI proxy auth error: ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`AI proxy error: ${response.status}`);
    }

    return response.json() as Promise<{ suggestion: string; remaining: number; resetAt: number }>;
  }

  private buildFailurePrompt(test: TestResultData): string {
    return `Analyze this Playwright test failure and suggest a fix. Be concise (2-3 sentences max).

Test: ${test.title}
File: ${test.file}
Error:
${test.error || 'Unknown error'}

Provide a brief, actionable suggestion to fix this failure.`;
  }

  private buildClusterPrompt(cluster: FailureCluster): string {
    const testTitles = cluster.tests.slice(0, 5).map(t => t.title).join('\n- ');
    const moreTests = cluster.count > 5 ? `\n... and ${cluster.count - 5} more` : '';

    return `Analyze this group of similar test failures and suggest a fix. Be concise (2-3 sentences max).

Error Type: ${cluster.errorType}
Number of Affected Tests: ${cluster.count}
Example Tests:
- ${testTitles}${moreTests}

Example Error:
${cluster.tests[0].error || 'Unknown error'}

Provide a brief, actionable suggestion to fix these failures.`;
  }

  private buildSuiteHealthPrompt(
    stats: SuiteStats,
    clusters: FailureCluster[],
    flakyTests: TestResultData[],
    slowTests: TestResultData[],
    retryTests: TestResultData[],
    trendLine: string,
  ): string {
    const clusterSummary = clusters.length > 0
      ? clusters.slice(0, 5).map(c => `- ${c.errorType} (${c.count} tests)`).join('\n')
      : 'None';

    const flakyList = flakyTests.length > 0
      ? flakyTests.slice(0, 5).map(t => `- ${t.title} (${Math.round((t.flakinessScore ?? 0) * 100)}% failure rate)`).join('\n')
      : 'None';

    const slowList = slowTests.length > 0
      ? slowTests.slice(0, 5).map(t => `- ${t.title} (${t.performanceTrend})`).join('\n')
      : 'None';

    return `You are a test suite health analyst. Write a concise executive summary (2-4 sentences) of this Playwright test suite's health. Use natural language, be specific about numbers, and highlight the most actionable insight. Do not use bullet points or headers — write flowing prose.

Suite Stats:
- Total: ${stats.total} tests
- Passed: ${stats.passed}, Failed: ${stats.failed}, Skipped: ${stats.skipped}
- Flaky: ${stats.flaky}, Slow: ${stats.slow}
- Pass Rate: ${stats.passRate}%
- Average Stability: ${stats.averageStability}/100

Pass Rate Trend: ${trendLine}

Failure Clusters:
${clusterSummary}

Flaky Tests:
${flakyList}

Performance Regressions:
${slowList}

Tests Needing Retries: ${retryTests.length}

Write the summary now.`;
  }
}
