import { spawn } from 'child_process';
import type { TestResultData, TestRecommendation, FailureCluster, SuiteStats, RunSummary } from '../types';
import { isFlakyScore, isConsistentlyFailingScore } from '../utils';

const CLAUDE_CLI_TIMEOUT_MS = 60_000;
const NO_SUGGESTION = 'No suggestion available';

/**
 * AI-powered analysis for test failures and recommendations.
 * Bring your own API key: set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.
 * Claude subscription users without an API key can set CLAUDE_CODE_OAUTH_TOKEN
 * to route analysis through the locally installed Claude Code CLI instead.
 */
export class AIAnalyzer {
  private anthropicKey?: string;
  private openaiKey?: string;
  private geminiKey?: string;
  private useClaudeCli: boolean;
  private oauthToken?: string;
  private cliUnavailable = false;

  constructor() {
    this.anthropicKey = process.env.ANTHROPIC_API_KEY;
    this.openaiKey = process.env.OPENAI_API_KEY;
    this.geminiKey = process.env.GEMINI_API_KEY;
    this.oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Issue #40: subscription OAuth tokens (sk-ant-oat...) are not API keys.
    // If one landed in ANTHROPIC_API_KEY, don't send it to the API (guaranteed 401) —
    // reroute it to the Claude Code CLI instead.
    if (this.anthropicKey?.startsWith('sk-ant-oat')) {
      console.warn('⚠️  ANTHROPIC_API_KEY contains a Claude subscription OAuth token, not an API key. Routing AI analysis through the Claude Code CLI instead. Set CLAUDE_CODE_OAUTH_TOKEN (and unset ANTHROPIC_API_KEY) to silence this warning.');
      this.oauthToken = this.oauthToken ?? this.anthropicKey;
      this.anthropicKey = undefined;
    }

    this.useClaudeCli = !!this.oauthToken;
  }

  isAvailable(): boolean {
    return !!(this.anthropicKey || this.openaiKey || this.geminiKey || this.useClaudeCli);
  }

  async analyzeFailed(results: TestResultData[]): Promise<void> {
    const failedTests = results.filter(
      r => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    if (!this.isAvailable()) {
      console.log('💡 Tip: Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI failure analysis (or CLAUDE_CODE_OAUTH_TOKEN to use the Claude Code CLI)');
      return;
    }

    console.log(`\n   Analyzing ${failedTests.length} failure(s) with AI...`);

    const BATCH_SIZE = 3;
    for (let i = 0; i < failedTests.length; i += BATCH_SIZE) {
      const batch = failedTests.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(failedTests.length / BATCH_SIZE);
      console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} tests)...`);

      const promises = batch.map(async (test) => {
        try {
          const prompt = test.aiPrompt ?? this.buildFailurePrompt(test);
          test.aiSuggestion = await this.callAI(prompt);
        } catch (err) {
          console.error(`Failed to get AI suggestion for "${test.title}":`, err);
        }
      });

      await Promise.all(promises);
    }

    console.log(`   AI analysis complete`);
  }

  async analyzeClusters(clusters: FailureCluster[]): Promise<void> {
    if (clusters.length === 0) return;
    if (!this.isAvailable()) return;

    console.log(`\n   Analyzing ${clusters.length} failure cluster(s) with AI...`);

    for (const cluster of clusters) {
      try {
        const prompt = this.buildClusterPrompt(cluster);
        cluster.aiSuggestion = await this.callAI(prompt);
      } catch (err) {
        console.error(`Failed to get AI suggestion for cluster "${cluster.errorType}":`, err);
      }
    }
  }

  async analyzeSuiteHealth(
    results: TestResultData[],
    stats: SuiteStats,
    failureClusters: FailureCluster[],
    historySummaries: RunSummary[],
  ): Promise<string | undefined> {
    if (!this.isAvailable()) return undefined;

    console.log('\n   Generating AI suite health summary...');

    const flakyTests = results.filter(r => isFlakyScore(r.flakinessScore));
    const slowTests = results.filter(r => r.performanceTrend?.startsWith('↑'));
    const retryTests = results.filter(r => r.retryInfo?.needsAttention);

    // Build pass-rate trend from recent history
    const recentRuns = historySummaries.slice(-5);
    const trendLine = recentRuns.length > 0
      ? recentRuns.map(s => `${s.passRate}%`).join(' → ') + ` → ${stats.passRate}% (current)`
      : `${stats.passRate}% (no prior history)`;

    const prompt = this.buildSuiteHealthPrompt(stats, failureClusters, flakyTests, slowTests, retryTests, trendLine);

    try {
      const summary = await this.callAI(prompt);
      console.log('   Suite health summary generated');
      return summary;
    } catch (err) {
      console.error('Failed to generate suite health summary:', err);
      return undefined;
    }
  }

  generateRecommendations(results: TestResultData[], stats: SuiteStats): TestRecommendation[] {
    const recommendations: TestRecommendation[] = [];

    // Flakiness recommendations
    const flakyTests = results.filter(r => isFlakyScore(r.flakinessScore));
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

    // Consistently failing tests (fail on every historical run) are a
    // different, more urgent problem than flakiness.
    const failingTests = results.filter(r => isConsistentlyFailingScore(r.flakinessScore) && r.outcome !== 'flaky');
    if (failingTests.length > 0) {
      recommendations.push({
        type: 'flakiness',
        priority: 92,
        title: 'Fix Consistently Failing Tests',
        description: `${failingTests.length} test(s) fail on every run — likely broken tests or real regressions`,
        action: 'Fix the underlying bug or update the test; do not quarantine these',
        affectedTests: failingTests.map(t => t.testId),
        icon: '❌',
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

  private async callAI(prompt: string): Promise<string> {
    if (this.anthropicKey) {
      return this.callAnthropic(prompt);
    } else if (this.openaiKey) {
      return this.callOpenAI(prompt);
    } else if (this.geminiKey) {
      return this.callGemini(prompt);
    } else if (this.useClaudeCli) {
      return this.callClaudeCli(prompt);
    }
    return 'AI analysis not available';
  }

  /**
   * Issue #40: route analysis through the Claude Code CLI for subscription
   * users (team/pro plans) that have CLAUDE_CODE_OAUTH_TOKEN but no API key.
   * The prompt is piped via stdin to avoid argv length limits.
   */
  private callClaudeCli(prompt: string): Promise<string> {
    if (this.cliUnavailable) {
      return Promise.reject(new Error('Claude CLI unavailable (previous call failed to find the binary)'));
    }
    return new Promise((resolve, reject) => {
      // --restricted --tools "" makes the CLI text-in/text-out like the HTTP providers:
      // failure text can contain untrusted page content, so no tools may run.
      const child = spawn('claude', ['-p', '--output-format', 'text', '--model', 'claude-haiku-4-5', '--restricted', '--tools', ''], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // npm installs the CLI as a .cmd shim on Windows, which spawn only resolves via a shell
        shell: process.platform === 'win32',
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: this.oauthToken },
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        settle(() => {
          child.kill();
          // escalate in case the CLI ignores SIGTERM; unref so a dead child doesn't hold the process open
          setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
          reject(new Error(`Claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS / 1000}s`));
        });
      }, CLAUDE_CLI_TIMEOUT_MS);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      // EPIPE if the child exits before the prompt is fully written; 'close'/'error' report the real failure
      child.stdin.on('error', () => {});

      child.on('error', (err: NodeJS.ErrnoException) => {
        settle(() => {
          if (err.code === 'ENOENT') {
            // don't spawn again — every later call this run is doomed the same way
            this.cliUnavailable = true;
            reject(new Error('CLAUDE_CODE_OAUTH_TOKEN is set but the "claude" CLI was not found on PATH. Install Claude Code (https://claude.com/claude-code) or use an API key instead.'));
          } else {
            reject(err);
          }
        });
      });

      child.on('close', (code) => {
        settle(() => {
          if (code === 0) {
            resolve(stdout.trim() || NO_SUGGESTION);
          } else {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim().slice(0, 300)}`));
          }
        });
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  private async callAnthropic(prompt: string): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Anthropic API error: 401 (invalid API key). Note: Claude subscription OAuth tokens are not API keys — unset ANTHROPIC_API_KEY and set CLAUDE_CODE_OAUTH_TOKEN to use the Claude Code CLI instead.');
      }
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content[0]?.text || 'No suggestion available';
  }

  private async callOpenAI(prompt: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 512,
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
