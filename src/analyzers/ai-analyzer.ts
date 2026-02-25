import type { TestResultData, TestRecommendation, FailureCluster, SuiteStats, LicenseTier } from '../types';

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
    this.proxyUrl = config?.proxyUrl ?? 'https://stagewright.dev/api/v1/ai/analyze';
  }

  isAvailable(): boolean {
    return !!this.licenseKey && (this.tier === 'pro' || this.tier === 'team');
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

  private async callProxy(prompt: string, type: 'failure' | 'cluster'): Promise<{ suggestion: string; remaining: number; resetAt: number }> {
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
}
