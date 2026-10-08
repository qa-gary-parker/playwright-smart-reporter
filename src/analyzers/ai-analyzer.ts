import { spawn } from 'child_process';
import type { AIConfig, AIProviderName, TestResultData, TestRecommendation, FailureCluster, SuiteStats, RunSummary } from '../types';
import { isFlakyScore, isConsistentlyFailingScore } from '../utils';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOTAL_MS = 300_000;
const NO_SUGGESTION = 'No suggestion available';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
// 127.0.0.1, not localhost: Ollama binds IPv4 only and Node 18 may resolve localhost to ::1
const OLLAMA_DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_MODELS = {
  anthropic: 'claude-haiku-4-5',
  'claude-cli': 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3.2',
};
const NO_KEY_TIP = '💡 Tip: Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI failure analysis (or CLAUDE_CODE_OAUTH_TOKEN to use the Claude Code CLI, or OLLAMA_HOST / OLLAMA_MODEL to use a local Ollama model with no key)';

export interface ResolvedAIProvider {
  provider: AIProviderName | 'claude-cli';
  model: string;
  baseUrl?: string; // OpenAI-compatible providers: requests go to `${baseUrl}/chat/completions`
  apiKey?: string;
}

export interface AIProviderResolution {
  resolved?: ResolvedAIProvider;
  problem?: string;        // why an explicit ai.provider cannot run
  oauthInApiKey: boolean;  // issue #40
  localShadowed: boolean;  // OLLAMA_* is set but a cloud key took precedence
}

// Accepts the OLLAMA_HOST forms Ollama itself accepts ("0.0.0.0", "host:port", "http://host")
function ollamaBaseUrl(host: string): string {
  let url = host.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${/:\d+$/.test(url) ? url : `${url}:11434`}`;
  return `${url}/v1`;
}

/**
 * Picks the AI provider. Without `ai.provider`, the first match wins:
 * ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, CLAUDE_CODE_OAUTH_TOKEN (Claude Code CLI;
 * also an OAuth token found in ANTHROPIC_API_KEY, issue #40), then OLLAMA_HOST / OLLAMA_MODEL.
 * An explicit `ai.provider` wins and never falls back to another provider.
 */
export function resolveAIProvider(config: AIConfig | undefined, env: NodeJS.ProcessEnv = process.env): AIProviderResolution {
  const c = config ?? {};
  let anthropicKey = env.ANTHROPIC_API_KEY || undefined;
  let oauthToken = env.CLAUDE_CODE_OAUTH_TOKEN || undefined;
  const oauthInApiKey = !!anthropicKey?.startsWith('sk-ant-oat');
  if (oauthInApiKey) {
    oauthToken = oauthToken ?? anthropicKey;
    anthropicKey = undefined;
  }
  const openaiKey = env.OPENAI_API_KEY || undefined;
  const geminiKey = env.GEMINI_API_KEY || undefined;
  const trim = (url: string) => url.trim().replace(/\/+$/, '');

  const anthropic: ResolvedAIProvider | undefined = anthropicKey ? { provider: 'anthropic', model: c.model || DEFAULT_MODELS.anthropic, apiKey: anthropicKey } : undefined;
  const claudeCli: ResolvedAIProvider | undefined = oauthToken ? { provider: 'claude-cli', model: c.model || DEFAULT_MODELS['claude-cli'], apiKey: oauthToken } : undefined;
  const openai: ResolvedAIProvider | undefined = openaiKey ? { provider: 'openai', model: c.model || DEFAULT_MODELS.openai, baseUrl: trim(c.baseUrl || OPENAI_BASE_URL), apiKey: openaiKey } : undefined;
  const gemini: ResolvedAIProvider | undefined = geminiKey ? { provider: 'gemini', model: c.model || DEFAULT_MODELS.gemini, apiKey: geminiKey } : undefined;
  const ollama: ResolvedAIProvider = {
    provider: 'ollama',
    model: c.model || env.OLLAMA_MODEL || DEFAULT_MODELS.ollama,
    baseUrl: ollamaBaseUrl(c.baseUrl || env.OLLAMA_HOST || OLLAMA_DEFAULT_HOST),
  };
  const compatible: ResolvedAIProvider | undefined = c.baseUrl && c.model
    ? { provider: 'openai-compatible', model: c.model, baseUrl: trim(c.baseUrl), apiKey: openaiKey }
    : undefined;

  const explicit = (resolved: ResolvedAIProvider | undefined, problem: string): AIProviderResolution =>
    resolved ? { resolved, oauthInApiKey, localShadowed: false } : { problem: `ai.provider is "${String(c.provider)}" but ${problem}`, oauthInApiKey, localShadowed: false };

  switch (c.provider) {
    case undefined: break;
    case 'anthropic': return explicit(anthropic ?? claudeCli, 'neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN is set');
    case 'openai': return explicit(openai, 'OPENAI_API_KEY is not set');
    case 'gemini': return explicit(gemini, 'GEMINI_API_KEY is not set');
    case 'ollama': return explicit(ollama, '');
    case 'openai-compatible': return explicit(compatible, 'it needs both ai.baseUrl and ai.model');
    default: return explicit(undefined, 'that is not a supported provider');
  }

  const localSet = !!(env.OLLAMA_HOST || env.OLLAMA_MODEL);
  const resolved = anthropic ?? openai ?? gemini ?? claudeCli ?? (localSet ? ollama : undefined);
  return { resolved, oauthInApiKey, localShadowed: localSet && resolved !== ollama };
}

/** Provider and model behind a report's AI output; empty when the report has none. */
export function aiReportInfo(
  input: {
    options: { ai?: AIConfig };
    results: ReadonlyArray<{ aiSuggestion?: string }>;
    failureClusters?: ReadonlyArray<{ aiSuggestion?: string }>;
    aiSuiteHealthSummary?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): { provider?: string; model?: string } {
  const hasOutput = !!input.aiSuiteHealthSummary
    || input.results.some(r => r.aiSuggestion)
    || (input.failureClusters ?? []).some(c => c.aiSuggestion);
  const resolved = hasOutput ? resolveAIProvider(input.options.ai, env).resolved : undefined;
  return resolved ? { provider: resolved.provider, model: resolved.model } : {};
}

/** The request never got a response: connection refused, DNS failure, timeout, or unreadable body. */
class AITransportError extends Error {
  readonly timedOut: boolean;
  constructor(readonly url: string, cause: unknown) {
    const inner = (cause as { cause?: unknown })?.cause;
    super(inner instanceof Error ? inner.message : cause instanceof Error ? cause.message : String(cause));
    this.timedOut = (cause as { name?: string })?.name === 'TimeoutError';
  }
}

class AISkippedError extends Error {}

async function postJson(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: response.ok, status: response.status, data: response.ok ? await response.json() : undefined };
  } catch (err) {
    throw new AITransportError(url, err);
  }
}

/** POST to any OpenAI-compatible `/chat/completions` (OpenAI, Ollama, LM Studio, vLLM, gateways). */
export async function callOpenAICompatible(
  prompt: string,
  { baseUrl, model, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }: { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number },
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const url = `${baseUrl}/chat/completions`;
  const res = await postJson(url, headers, {
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  }, timeoutMs);

  if (!res.ok) {
    const hint = res.status === 404 ? ` (check that model "${model}" exists there; for Ollama run \`ollama pull ${model}\`)` : '';
    throw new Error(`OpenAI-compatible API error: ${res.status} from ${url}${hint}`);
  }
  const data = res.data as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || NO_SUGGESTION;
}

const secs = (ms: number) => `${+(ms / 1000).toFixed(1)}s`;

/**
 * AI-powered analysis for test failures and recommendations.
 * Bring your own API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY), use a Claude
 * subscription via CLAUDE_CODE_OAUTH_TOKEN and the Claude Code CLI, or run a local model
 * through Ollama or any OpenAI-compatible endpoint. See resolveAIProvider for precedence.
 * An unreachable or slow provider skips the remaining analysis with one warning; it never fails the run.
 */
export class AIAnalyzer {
  private provider?: ResolvedAIProvider;
  private configProblem = false;
  private timeoutMs: number;
  private maxTotalMs: number;
  private deadline?: number;
  private skipReason?: string;
  private cliUnavailable = false;

  constructor(config?: AIConfig, env: NodeJS.ProcessEnv = process.env) {
    this.timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTotalMs = config?.maxTotalMs ?? DEFAULT_MAX_TOTAL_MS;
    let resolution: AIProviderResolution;
    try {
      resolution = resolveAIProvider(config, env);
    } catch (err) {
      // runs in the reporter constructor, where a throw would abort the whole test run
      resolution = { problem: `the ai options are invalid (${err instanceof Error ? err.message : String(err)})`, oauthInApiKey: false, localShadowed: false };
    }
    const { resolved, problem, oauthInApiKey, localShadowed } = resolution;
    this.provider = resolved;

    // Issue #40: subscription OAuth tokens (sk-ant-oat...) are not API keys; resolveAIProvider
    // reroutes one found in ANTHROPIC_API_KEY to the Claude Code CLI (the API would 401).
    if (oauthInApiKey) {
      console.warn('⚠️  ANTHROPIC_API_KEY contains a Claude subscription OAuth token, not an API key. Routing AI analysis through the Claude Code CLI instead. Set CLAUDE_CODE_OAUTH_TOKEN (and unset ANTHROPIC_API_KEY) to silence this warning.');
    }
    if (problem) {
      this.configProblem = true;
      console.warn(`⚠️  AI analysis is disabled: ${problem}.`);
    }
    if (localShadowed && resolved) {
      console.warn(`⚠️  OLLAMA_HOST/OLLAMA_MODEL is set, but AI analysis uses ${resolved.provider} because its key takes precedence. Set ai: { provider: 'ollama' } to use the local model.`);
    }
  }

  isAvailable(): boolean {
    return !!this.provider;
  }

  async analyzeFailed(results: TestResultData[]): Promise<void> {
    const failedTests = results.filter(
      r => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    if (!this.isAvailable()) {
      if (!this.configProblem) console.log(NO_KEY_TIP);
      return;
    }
    if (this.skipReason) return;

    console.log(`\n   Analyzing ${failedTests.length} failure(s) with AI (${this.provider!.provider}, ${this.provider!.model})...`);

    const BATCH_SIZE = 3;
    for (let i = 0; i < failedTests.length; i += BATCH_SIZE) {
      if (this.skipReason) break;
      const batch = failedTests.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(failedTests.length / BATCH_SIZE);
      console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} tests)...`);

      const promises = batch.map(async (test) => {
        try {
          const prompt = test.aiPrompt ?? this.buildFailurePrompt(test);
          test.aiSuggestion = await this.callAI(prompt);
        } catch (err) {
          if (!(err instanceof AISkippedError)) console.error(`Failed to get AI suggestion for "${test.title}":`, err);
        }
      });

      await Promise.all(promises);
    }

    if (!this.skipReason) console.log(`   AI analysis complete`);
  }

  async analyzeClusters(clusters: FailureCluster[]): Promise<void> {
    if (clusters.length === 0) return;
    if (!this.isAvailable() || this.skipReason) return;

    console.log(`\n   Analyzing ${clusters.length} failure cluster(s) with AI...`);

    for (const cluster of clusters) {
      if (this.skipReason) break;
      try {
        const prompt = this.buildClusterPrompt(cluster);
        cluster.aiSuggestion = await this.callAI(prompt);
      } catch (err) {
        if (!(err instanceof AISkippedError)) console.error(`Failed to get AI suggestion for cluster "${cluster.errorType}":`, err);
      }
    }
  }

  async analyzeSuiteHealth(
    results: TestResultData[],
    stats: SuiteStats,
    failureClusters: FailureCluster[],
    historySummaries: RunSummary[],
  ): Promise<string | undefined> {
    if (!this.isAvailable() || this.skipReason) return undefined;

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
      if (!(err instanceof AISkippedError)) console.error('Failed to generate suite health summary:', err);
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
    const p = this.provider;
    if (!p) return 'AI analysis not available';
    if (this.skipReason) throw new AISkippedError(this.skipReason);

    const capReason = `the ${secs(this.maxTotalMs)} total analysis cap (ai.maxTotalMs) was reached; remaining items were not analyzed`;
    this.deadline ??= Date.now() + this.maxTotalMs;
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) this.skip(capReason);
    const timeoutMs = Math.min(this.timeoutMs, remaining);

    try {
      switch (p.provider) {
        case 'anthropic': return await this.callAnthropic(prompt, p, timeoutMs);
        case 'gemini': return await this.callGemini(prompt, p, timeoutMs);
        case 'claude-cli': return await this.callClaudeCli(prompt, p, timeoutMs);
        default: return await callOpenAICompatible(prompt, { baseUrl: p.baseUrl!, model: p.model, apiKey: p.apiKey, timeoutMs });
      }
    } catch (err) {
      if (err instanceof AITransportError) {
        this.skip(!err.timedOut
          ? `${p.provider} request to ${err.url} failed (${err.message})`
          : timeoutMs < this.timeoutMs
            ? capReason
            : `${p.provider} (${p.model}) did not respond within ${secs(timeoutMs)}; raise ai.timeoutMs for slow local models`);
      }
      throw err;
    }
  }

  /** Stops all further AI calls this run and warns once. */
  private skip(reason: string): never {
    if (!this.skipReason) {
      this.skipReason = reason;
      console.warn(`⚠️  AI analysis skipped: ${reason}. The test run and report are unaffected.`);
    }
    throw new AISkippedError(reason);
  }

  /**
   * Issue #40: route analysis through the Claude Code CLI for subscription
   * users (team/pro plans) that have CLAUDE_CODE_OAUTH_TOKEN but no API key.
   * The prompt is piped via stdin to avoid argv length limits.
   */
  private callClaudeCli(prompt: string, p: ResolvedAIProvider, timeoutMs: number): Promise<string> {
    if (this.cliUnavailable) {
      return Promise.reject(new Error('Claude CLI unavailable (previous call failed to find the binary)'));
    }
    return new Promise((resolve, reject) => {
      // --restricted --tools "" makes the CLI text-in/text-out like the HTTP providers:
      // failure text can contain untrusted page content, so no tools may run.
      const child = spawn('claude', ['-p', '--output-format', 'text', '--model', p.model, '--restricted', '--tools', ''], {
        stdio: ['pipe', 'pipe', 'pipe'],
        // npm installs the CLI as a .cmd shim on Windows, which spawn only resolves via a shell
        shell: process.platform === 'win32',
        env: { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: p.apiKey },
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
          reject(new Error(`Claude CLI timed out after ${secs(timeoutMs)}`));
        });
      }, timeoutMs);

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

  private async callAnthropic(prompt: string, p: ResolvedAIProvider, timeoutMs: number): Promise<string> {
    const response = await postJson('https://api.anthropic.com/v1/messages', {
      'Content-Type': 'application/json',
      'x-api-key': p.apiKey!,
      'anthropic-version': '2023-06-01',
    }, {
      model: p.model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }, timeoutMs);

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Anthropic API error: 401 (invalid API key). Note: Claude subscription OAuth tokens are not API keys — unset ANTHROPIC_API_KEY and set CLAUDE_CODE_OAUTH_TOKEN to use the Claude Code CLI instead.');
      }
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = response.data as {
      content: Array<{ type: string; text?: string }>;
    };
    return data.content[0]?.text || 'No suggestion available';
  }

  private async callGemini(prompt: string, p: ResolvedAIProvider, timeoutMs: number): Promise<string> {
    const response = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, {
      'Content-Type': 'application/json',
      'x-goog-api-key': p.apiKey!,
    }, {
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        maxOutputTokens: 512,
      },
    }, timeoutMs);

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = response.data as {
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
