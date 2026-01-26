import type { TestResultData, TestRecommendation, FailureCluster, SuiteStats } from '../types';

/**
 * AI-powered analysis for test failures and recommendations
 */
export class AIAnalyzer {
  private anthropicKey?: string;
  private openaiKey?: string;
  private geminiKey?: string;

  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.openaiKey = process.env.OPENAI_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
  }

  /**
   * Add AI suggestions to failed tests
   */
  async analyzeFailed(results: TestResultData[]): Promise<void> {
    const failedTests = results.filter(
      r => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    if (!this.anthropicKey && !this.openaiKey && !this.geminiKey) {
      console.log('💡 Tip: Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI failure analysis');
      return;
    }

    console.log(`\n🤖 Analyzing ${failedTests.length} failure(s) with AI...`);

    for (const test of failedTests) {
      try {
        const prompt = test.aiPrompt ?? this.buildFailurePrompt(test);
        test.aiSuggestion = await this.callAI(prompt);
      } catch (err) {
        console.error(`Failed to get AI suggestion for "${test.title}":`, err);
      }
    }
  }

  /**
   * Add AI suggestions to failure clusters
   */
  async analyzeClusters(clusters: FailureCluster[]): Promise<void> {
    if (clusters.length === 0) return;
    if (!this.anthropicKey && !this.openaiKey && !this.geminiKey) return;

    console.log(`\n🤖 Analyzing ${clusters.length} failure cluster(s) with AI...`);

    for (const cluster of clusters) {
      try {
        const prompt = this.buildClusterPrompt(cluster);
        cluster.aiSuggestion = await this.callAI(prompt);
      } catch (err) {
        console.error(`Failed to get AI suggestion for cluster "${cluster.errorType}":`, err);
      }
    }
  }

  /**
   * Generate comprehensive test recommendations
   */
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

  /**
   * Build prompt for individual test failure
   */
  private buildFailurePrompt(test: TestResultData): string {
    return `Analyze this Playwright test failure and suggest a fix. Be concise (2-3 sentences max).

Test: ${test.title}
File: ${test.file}
Error:
${test.error || 'Unknown error'}

Provide a brief, actionable suggestion to fix this failure.`;
  }

  /**
   * Build prompt for failure cluster
   */
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

  /**
   * Call AI API (Anthropic, OpenAI, or Gemini)
   */
  private async callAI(prompt: string): Promise<string> {
    if (this.anthropicKey) {
      return this.callAnthropic(prompt);
    } else if (this.openaiKey) {
      return this.callOpenAI(prompt);
    } else if (this.geminiKey) {
      return this.callGemini(prompt);
    }
    return 'AI analysis not available';
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(prompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content[0]?.text || 'No suggestion available';
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content || 'No suggestion available';
  }

  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string): Promise<string> {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.geminiKey!,
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          maxOutputTokens: 512,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> }; role: string }>;
    };
    return data.candidates[0]?.content?.parts[0]?.text || 'No suggestion available';
  }

  /**
   * Check if AI analysis is available
   */
  isAvailable(): boolean {
    return !!(this.anthropicKey || this.openaiKey || this.geminiKey);
  }
}
