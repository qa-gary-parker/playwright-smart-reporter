import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// ============================================================================
// Imports: Types
// ============================================================================

import type {
  SmartReporterOptions,
  TestResultData,
  TestHistory,
  RunComparison,
  StepData,
  TestHistoryEntry,
  RunSummary,
} from './types';

// ============================================================================
// Imports: Collectors
// ============================================================================

import {
  HistoryCollector,
  StepCollector,
  AttachmentCollector,
} from './collectors';

// ============================================================================
// Imports: Analyzers
// ============================================================================

import {
  FlakinessAnalyzer,
  PerformanceAnalyzer,
  RetryAnalyzer,
  FailureClusterer,
  StabilityScorer,
  AIAnalyzer,
} from './analyzers';

// ============================================================================
// Imports: Generators & Notifiers
// ============================================================================

import { generateHtml, type HtmlGeneratorData } from './generators/html-generator';
import { buildComparison } from './generators/comparison-generator';
import { SlackNotifier, TeamsNotifier } from './notifiers';
import { formatDuration, stripAnsiCodes, sanitizeFilename } from './utils';
import { buildPlaywrightStyleAiPrompt } from './ai/prompt-builder';

// ============================================================================
// Smart Reporter
// ============================================================================

/**
 * Smart Reporter - Orchestrates all modular components to analyze and report
 * on Playwright test results with AI insights and advanced analytics.
 *
 * Public API:
 * - Implements Playwright's Reporter interface
 * - Constructor takes SmartReporterOptions
 * - Methods: onBegin, onTestEnd, onEnd
 */
class SmartReporter implements Reporter {
  // Core dependencies
  private historyCollector!: HistoryCollector;
  private stepCollector: StepCollector;
  private attachmentCollector: AttachmentCollector;

  // Analyzers
  private flakinessAnalyzer!: FlakinessAnalyzer;
  private performanceAnalyzer!: PerformanceAnalyzer;
  private retryAnalyzer!: RetryAnalyzer;
  private failureClusterer: FailureClusterer;
  private stabilityScorer!: StabilityScorer;
  private aiAnalyzer: AIAnalyzer;

  // Notifiers
  private slackNotifier!: SlackNotifier;
  private teamsNotifier!: TeamsNotifier;

  // State
  private options: SmartReporterOptions;
  private results: TestResultData[] = [];
  private outputDir: string = '';
  private startTime: number = 0;
  private fullConfig: FullConfig | null = null;
  private runnerErrors: string[] = [];

  constructor(options: SmartReporterOptions = {}) {
    this.options = options;

    // Initialize collectors
    this.stepCollector = new StepCollector();
    this.attachmentCollector = new AttachmentCollector();

    // Initialize other components
    this.failureClusterer = new FailureClusterer();
    this.aiAnalyzer = new AIAnalyzer();
  }

  /**
   * Called when the test run begins
   * Initializes collectors, analyzers, and loads test history
   * @param config - Playwright full configuration
   * @param _suite - Root test suite (unused)
   */
  onBegin(config: FullConfig, _suite: Suite): void {
    this.startTime = Date.now();
    this.outputDir = config.rootDir;
    this.fullConfig = config;

    // Initialize HistoryCollector and load history
    this.historyCollector = new HistoryCollector(this.options, this.outputDir);
    this.historyCollector.loadHistory();

    // Initialize all analyzers with thresholds from options
    const performanceThreshold = this.options.performanceThreshold ?? 0.2;
    const retryFailureThreshold = this.options.retryFailureThreshold ?? 3;
    const stabilityThreshold = this.options.stabilityThreshold ?? 70;

    this.flakinessAnalyzer = new FlakinessAnalyzer();
    this.performanceAnalyzer = new PerformanceAnalyzer(performanceThreshold);
    this.retryAnalyzer = new RetryAnalyzer(retryFailureThreshold);
    this.stabilityScorer = new StabilityScorer(stabilityThreshold);

    // Initialize notifiers
    this.slackNotifier = new SlackNotifier(this.options.slackWebhook);
    this.teamsNotifier = new TeamsNotifier(this.options.teamsWebhook);
  }

  onError(error: unknown): void {
    const err = error as { message?: string; stack?: string; value?: string };
    const payload = err.stack || err.message || err.value || String(error);
    this.runnerErrors.push(payload);
    if (this.runnerErrors.length > 50) {
      this.runnerErrors = this.runnerErrors.slice(-50);
    }
  }

  /**
   * Called when a test completes
   * Collects test data, runs analyzers, and stores results
   * @param test - Playwright test case
   * @param result - Test execution result
   */
  onTestEnd(test: TestCase, result: TestResult): void {
    const testId = this.getTestId(test);
    const file = path.relative(this.outputDir, test.location.file);

    // Collect test components
    const steps = this.stepCollector.extractSteps(result);
    const attachments = this.attachmentCollector.collectAttachments(result);
    const history = this.historyCollector.getTestHistory(testId);

    // Build test result data
    const testData: TestResultData = {
      testId,
      title: test.title,
      file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
      steps,
      attachments,
      history,
    };

    // Add error if failed (strip ANSI codes for clean display)
    if (result.status === 'failed' || result.status === 'timedOut') {
      const error = result.errors[0];
      if (error) {
        const rawError = error.stack || error.message || 'Unknown error';
        testData.error = stripAnsiCodes(rawError);
      }
    }

    // Build Playwright-style prompt for AI analysis (no binaries, includes env + config snapshot)
    if (this.fullConfig && (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted')) {
      try {
        testData.aiPrompt = buildPlaywrightStyleAiPrompt({
          config: this.fullConfig,
          test,
          result,
        });
      } catch (err) {
        // Prompt building should never fail the reporter
        console.warn(`Failed to build AI prompt for "${test.title}":`, err);
      }
    }

    // Backwards compatibility: extract first screenshot for legacy code
    if (attachments.screenshots.length > 0) {
      testData.screenshot = attachments.screenshots[0];
    }

    // Backwards compatibility: extract first video for legacy code
    if (attachments.videos.length > 0) {
      testData.videoPath = attachments.videos[0];
    }

    // Look for trace attachment
    const traceAttachment = result.attachments.find(
      a => a.name === 'trace' && a.contentType === 'application/zip'
    );
    if (traceAttachment?.path) {
      testData.tracePath = traceAttachment.path;
      // Embed trace as base64 for one-click viewing
      try {
        const traceBuffer = fs.readFileSync(traceAttachment.path);
        testData.traceData = `data:application/zip;base64,${traceBuffer.toString('base64')}`;
      } catch {
        // If we can't read the trace, just use the path
      }
    }

    // Calculate flakiness - use history already declared above
    // For skipped tests, set a special indicator
    if (result.status === 'skipped') {
      testData.flakinessIndicator = '⚪ Skipped';
      testData.performanceTrend = '→ Skipped';
    } else if (history.length > 0) {
      // Filter out skipped runs for flakiness calculation
      const relevantHistory = history.filter((e: TestHistoryEntry) => !e.skipped);
      if (relevantHistory.length > 0) {
        const failures = relevantHistory.filter((e: TestHistoryEntry) => !e.passed).length;
        const flakinessScore = failures / relevantHistory.length;
        testData.flakinessScore = flakinessScore;
        testData.flakinessIndicator = this.getFlakinessIndicator(flakinessScore);

        // Calculate performance trend (also exclude skipped runs)
        const avgDuration =
          relevantHistory.reduce((sum: number, e: TestHistoryEntry) => sum + e.duration, 0) /
          relevantHistory.length;
        testData.averageDuration = avgDuration;
        testData.performanceTrend = this.getPerformanceTrend(
          result.duration,
          avgDuration
        );
      } else {
        // All history entries were skipped
        testData.flakinessIndicator = '⚪ New';
        testData.performanceTrend = '→ Baseline';
      }
    } else {
      testData.flakinessIndicator = '⚪ New';
      testData.performanceTrend = '→ Baseline';
    }

    // Run all analyzers
    this.flakinessAnalyzer.analyze(testData, history);
    this.performanceAnalyzer.analyze(testData, history);
    this.retryAnalyzer.analyze(testData, history);
    this.stabilityScorer.scoreTest(testData);

    this.results.push(testData);
  }

  /**
   * Called when the test run completes
   * Performs final analysis, generates HTML report, updates history, and sends notifications
   * @param result - Full test run result
   */
  async onEnd(result: FullResult): Promise<void> {
    // Get failure clusters
    const failureClusters = this.failureClusterer.clusterFailures(this.results);

    // Run AI analysis on failures and clusters if enabled
    const options = this.historyCollector.getOptions();
    if (options.enableAIRecommendations !== false) {
      await this.aiAnalyzer.analyzeFailed(this.results);
      if (failureClusters.length > 0) {
        await this.aiAnalyzer.analyzeClusters(failureClusters);
      }
    }

    // Get comparison data if enabled
    let comparison: RunComparison | undefined;
    if (options.enableComparison !== false) {
      const baselineRun = this.historyCollector.getBaselineRun();
      if (baselineRun) {
        // Build current run summary
        const passed = this.results.filter(r => r.status === 'passed').length;
        const failed = this.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
        const skipped = this.results.filter(r => r.status === 'skipped').length;
        const flaky = this.results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
        const slow = this.results.filter(r => r.performanceTrend?.startsWith('↑')).length;
        const duration = Date.now() - this.startTime;

        const currentSummary = {
          runId: this.historyCollector.getCurrentRun().runId,
          timestamp: this.historyCollector.getCurrentRun().timestamp,
          total: this.results.length,
          passed,
          failed,
          skipped,
          flaky,
          slow,
          duration,
          passRate: (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0,
        };

        // Build baseline tests map from history
        const baselineTests = new Map<string, TestResultData>();
        const history = this.historyCollector.getHistory();

        // Reconstruct baseline test results from history
        for (const [testId, entries] of Object.entries(history.tests)) {
          if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            const matchingTest = this.results.find(r => r.testId === testId);

            if (matchingTest) {
              baselineTests.set(testId, {
                ...matchingTest,
                status: lastEntry.passed ? 'passed' : 'failed',
                duration: lastEntry.duration,
              });
            }
          }
        }

        comparison = buildComparison(
          this.results,
          currentSummary,
          baselineRun,
          baselineTests
        );
      }
    }

    // Use dynamic import to support both CommonJS and ESM
    const fs = await import('fs');
    const outputPath = path.resolve(this.outputDir, this.options.outputFile ?? 'smart-report.html');

    // Copy trace files to traces subdirectory for browser download BEFORE HTML generation
    const tracesDir = path.join(path.dirname(outputPath), 'traces');
    const traceResults = this.results.filter(r => r.attachments?.traces && r.attachments.traces.length > 0);

    if (traceResults.length > 0) {
      if (!fs.existsSync(tracesDir)) {
        fs.mkdirSync(tracesDir, { recursive: true });
      }

      for (const result of traceResults) {
        if (result.attachments && result.attachments.traces) {
          for (let i = 0; i < result.attachments.traces.length; i++) {
            const tracePath = result.attachments.traces[i];
            if (fs.existsSync(tracePath)) {
              // Sanitize testId to prevent path separator issues
              const safeTestId = sanitizeFilename(result.testId);
              const traceFileName = `${safeTestId}-trace-${i}.zip`;
              const destPath = path.join(tracesDir, traceFileName);
              fs.copyFileSync(tracePath, destPath);
              // Update the path to relative for HTML
              result.attachments.traces[i] = `./traces/${traceFileName}`;
            }
          }
        }
      }
    }

    // Prepare data for HTML generation (after trace paths are updated)
    const htmlData: HtmlGeneratorData = {
      results: this.results,
      history: this.historyCollector.getHistory(),
      startTime: this.startTime,
      options: this.options,
      comparison,
    };

    // Generate and save HTML report
    const html = generateHtml(htmlData);
    fs.writeFileSync(outputPath, html);
    console.log(`\n📊 Smart Report: ${outputPath}`);

    // Update history
    this.historyCollector.updateHistory(this.results);

    // Send webhook notifications if enabled
    const failed = this.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
    if (failed > 0) {
      await this.slackNotifier.notify(this.results);
      await this.teamsNotifier.notify(this.results);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Create a unique test ID from test file and title
   * @param test - Playwright TestCase
   * @returns Test ID string (e.g., "src/tests/login.spec.ts::Login Test")
   */
  private getTestId(test: TestCase): string {
    const file = path.relative(this.outputDir, test.location.file);
    return `${file}::${test.title}`;
  }

  private getFlakinessIndicator(score: number): string {
    if (score < 0.1) return '🟢 Stable';
    if (score < 0.3) return '🟡 Unstable';
    return '🔴 Flaky';
  }

  private getPerformanceTrend(current: number, average: number): string {
    const diff = (current - average) / average;
    const threshold = this.options.performanceThreshold ?? 0.2;
    if (diff > threshold) {
      return `↑ ${Math.round(diff * 100)}% slower`;
    }
    if (diff < -threshold) {
      return `↓ ${Math.round(Math.abs(diff) * 100)}% faster`;
    }
    return '→ Stable';
  }

  // ============================================================================
  // Step Extraction
  // ============================================================================

  private extractSteps(result: TestResult): StepData[] {
    const steps: StepData[] = [];

    // Recursively extract steps from the result
    const processStep = (step: TestResult['steps'][0]) => {
      // Only include meaningful steps (skip internal hooks)
      if (step.category === 'test.step' || step.category === 'pw:api') {
        steps.push({
          title: step.title,
          duration: step.duration,
          category: step.category,
        });
      }

      // Process nested steps
      if (step.steps) {
        for (const nested of step.steps) {
          processStep(nested);
        }
      }
    };

    for (const step of result.steps) {
      processStep(step);
    }

    // Mark the slowest step if we have any
    if (steps.length > 0) {
      const maxDuration = Math.max(...steps.map((s) => s.duration));
      const slowestIndex = steps.findIndex((s) => s.duration === maxDuration);
      if (slowestIndex !== -1 && maxDuration > 100) {
        steps[slowestIndex].isSlowest = true;
      }
    }

    return steps;
  }

  // ============================================================================
  // AI Suggestions
  // ============================================================================

  private async addAiSuggestions(): Promise<void> {
    const failedTests = this.results.filter(
      (r) => r.status === 'failed' || r.status === 'timedOut'
    );

    if (failedTests.length === 0) return;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey && !openaiKey) {
      console.log(
        '💡 Tip: Set ANTHROPIC_API_KEY or OPENAI_API_KEY for AI failure analysis'
      );
      return;
    }

    console.log(`\n🤖 Analyzing ${failedTests.length} failure(s) with AI...`);

    for (const test of failedTests) {
      try {
        const prompt = this.buildAiPrompt(test);

        if (anthropicKey) {
          test.aiSuggestion = await this.callAnthropic(prompt, anthropicKey);
        } else if (openaiKey) {
          test.aiSuggestion = await this.callOpenAI(prompt, openaiKey);
        }
      } catch (err) {
        console.error(`Failed to get AI suggestion for "${test.title}":`, err);
      }
    }
  }

  private buildAiPrompt(test: TestResultData): string {
    return `Analyze this Playwright test failure and suggest a fix. Be concise (2-3 sentences max).

Test: ${test.title}
File: ${test.file}
Error:
${test.error || 'Unknown error'}

Provide a brief, actionable suggestion to fix this failure.`;
  }

  private async callAnthropic(
    prompt: string,
    apiKey: string
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
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

  private async callOpenAI(prompt: string, apiKey: string): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
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

  // ============================================================================
  // HTML Generation
  // ============================================================================

  private generateHtml(result: FullResult): string {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;
    const flaky = this.results.filter(
      (r) => r.flakinessScore && r.flakinessScore >= 0.3
    ).length;
    const slow = this.results.filter((r) =>
      r.performanceTrend?.startsWith('↑')
    ).length;
    const newTests = this.results.filter((r) =>
      r.flakinessIndicator?.includes('New')
    ).length;
    const total = this.results.length;
    const passRate = (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;

    const testsJson = JSON.stringify(this.results);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Test Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a24;
      --bg-card-hover: #22222e;
      --border-subtle: #2a2a3a;
      --border-glow: #3b3b4f;
      --text-primary: #f0f0f5;
      --text-secondary: #8888a0;
      --text-muted: #5a5a70;
      --accent-green: #00ff88;
      --accent-green-dim: #00cc6a;
      --accent-red: #ff4466;
      --accent-red-dim: #cc3355;
      --accent-yellow: #ffcc00;
      --accent-yellow-dim: #ccaa00;
      --accent-blue: #00aaff;
      --accent-blue-dim: #0088cc;
      --accent-purple: #aa66ff;
      --accent-orange: #ff8844;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* Subtle grid background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(var(--border-subtle) 1px, transparent 1px),
        linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
      background-size: 60px 60px;
      opacity: 0.3;
      pointer-events: none;
      z-index: -1;
    }

    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      box-shadow: 0 0 30px rgba(0, 255, 136, 0.2);
    }

    .logo-text h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .logo-text span {
      font-size: 0.875rem;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', monospace;
    }

    .timestamp {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: var(--text-muted);
      background: var(--bg-secondary);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }

    @media (max-width: 900px) {
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
    }

    @media (max-width: 500px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.25rem;
      text-align: center;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--stat-color);
      opacity: 0.8;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: var(--stat-color);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px color-mix(in srgb, var(--stat-color) 20%, transparent);
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 2rem;
      font-weight: 700;
      color: var(--stat-color);
      text-shadow: 0 0 20px color-mix(in srgb, var(--stat-color) 40%, transparent);
    }

    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }

    .stat-card.passed { --stat-color: var(--accent-green); }
    .stat-card.failed { --stat-color: var(--accent-red); }
    .stat-card.skipped { --stat-color: var(--text-muted); }
    .stat-card.flaky { --stat-color: var(--accent-yellow); }
    .stat-card.slow { --stat-color: var(--accent-orange); }
    .stat-card.duration { --stat-color: var(--accent-blue); }

    /* Progress Ring */
    .progress-ring {
      width: 120px;
      height: 120px;
      margin: 0 auto 1.5rem;
      position: relative;
    }

    .progress-ring svg {
      transform: rotate(-90deg);
    }

    .progress-ring circle {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
    }

    .progress-ring .bg { stroke: var(--border-subtle); }
    .progress-ring .progress {
      stroke: var(--accent-green);
      stroke-dasharray: 314;
      stroke-dashoffset: calc(314 - (314 * ${passRate}) / 100);
      transition: stroke-dashoffset 1s ease;
      filter: drop-shadow(0 0 8px var(--accent-green));
    }

    .progress-ring .value {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent-green);
    }

    /* Trend Chart - Pass Rate Over Time */
    .trend-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      position: relative;
      overflow: hidden;
    }

    .trend-section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
      opacity: 0.8;
    }

    .trend-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }

    .trend-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .trend-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: 'JetBrains Mono', monospace;
    }

    .trend-chart {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      height: 140px;
      padding: 20px 16px 12px;
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      position: relative;
    }

    /* Grid lines */
    .trend-chart::before {
      content: '';
      position: absolute;
      left: 8px;
      right: 8px;
      top: 25%;
      border-top: 1px dashed var(--border-subtle);
    }

    .trend-chart::after {
      content: '';
      position: absolute;
      left: 8px;
      right: 8px;
      top: 50%;
      border-top: 1px dashed var(--border-subtle);
    }

    .trend-bar-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 40px;
      max-width: 60px;
      z-index: 1;
    }

    .trend-bar {
      width: 100%;
      background: linear-gradient(180deg, var(--accent-green) 0%, var(--accent-green-dim) 100%);
      border-radius: 6px 6px 2px 2px;
      transition: all 0.3s ease;
      position: relative;
      box-shadow: 0 2px 8px rgba(0, 255, 136, 0.2);
    }

    .trend-bar:hover {
      transform: scaleY(1.02);
      box-shadow: 0 4px 16px rgba(0, 255, 136, 0.3);
    }

    .trend-bar.low {
      background: linear-gradient(180deg, var(--accent-red) 0%, var(--accent-red-dim) 100%);
      box-shadow: 0 2px 8px rgba(255, 68, 102, 0.2);
    }

    .trend-bar.low:hover {
      box-shadow: 0 4px 16px rgba(255, 68, 102, 0.3);
    }

    .trend-bar.medium {
      background: linear-gradient(180deg, var(--accent-yellow) 0%, var(--accent-yellow-dim) 100%);
      box-shadow: 0 2px 8px rgba(255, 204, 0, 0.2);
    }

    .trend-bar.medium:hover {
      box-shadow: 0 4px 16px rgba(255, 204, 0, 0.3);
    }

    .trend-bar.current {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), 0 2px 8px rgba(0, 255, 136, 0.3);
      border: 2px solid var(--text-primary);
    }

    .trend-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      color: var(--text-muted);
      white-space: nowrap;
      margin-top: 4px;
    }

    .trend-legend {
      display: flex;
      justify-content: center;
      gap: 2rem;
      margin-top: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border-subtle);
    }

    .trend-legend-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .trend-legend-item:hover {
      background: var(--bg-card);
      color: var(--text-primary);
      transform: scale(1.05);
    }

    .trend-legend-item:hover .trend-legend-dot {
      transform: scale(1.2);
      box-shadow: 0 0 8px currentColor;
    }

    .trend-legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 4px;
      transition: all 0.2s ease;
    }

    .trend-legend-dot.good { background: var(--accent-green); }
    .trend-legend-dot.warning { background: var(--accent-yellow); }
    .trend-legend-dot.bad { background: var(--accent-red); }
    .trend-legend-dot.skipped { background: var(--text-muted); }
    .trend-legend-dot.duration { background: var(--accent-purple); }

    /* Stacked Bar Styles */
    .trend-stacked-bar {
      width: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 6px 6px 2px 2px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .trend-segment {
      width: 100%;
      transition: all 0.2s ease;
      position: relative;
      cursor: pointer;
    }

    .trend-segment-label {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--bg-primary);
      background: rgba(0, 0, 0, 0.7);
      padding: 3px 6px;
      border-radius: 4px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 10;
    }

    .trend-segment:hover .trend-segment-label {
      opacity: 1;
    }

    .trend-segment.passed {
      background: linear-gradient(180deg, var(--accent-green) 0%, var(--accent-green-dim) 100%);
    }

    .trend-segment.passed:hover {
      background: linear-gradient(180deg, #00ffaa 0%, var(--accent-green) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.3), 0 0 12px rgba(0, 255, 136, 0.5);
      z-index: 2;
    }

    .trend-segment.passed .trend-segment-label {
      color: var(--accent-green);
    }

    .trend-segment.failed {
      background: linear-gradient(180deg, var(--accent-red) 0%, var(--accent-red-dim) 100%);
    }

    .trend-segment.failed:hover {
      background: linear-gradient(180deg, #ff6688 0%, var(--accent-red) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.3), 0 0 12px rgba(255, 68, 102, 0.5);
      z-index: 2;
    }

    .trend-segment.failed .trend-segment-label {
      color: var(--accent-red);
    }

    .trend-segment.skipped {
      background: linear-gradient(180deg, var(--text-muted) 0%, #444455 100%);
    }

    .trend-segment.skipped:hover {
      background: linear-gradient(180deg, #8888bb 0%, var(--text-muted) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.2), 0 0 12px rgba(136, 136, 187, 0.4);
      z-index: 2;
    }

    .trend-segment.skipped .trend-segment-label {
      color: #aaaacc;
    }

    .trend-bar-wrapper.current .trend-stacked-bar {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), 0 2px 8px rgba(0, 255, 136, 0.3);
      border: 2px solid var(--text-primary);
    }

    /* Line Chart Containers */
    .line-chart-container {
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .chart-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 1rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Chart Bar Hover Effects */
    .chart-bar {
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .chart-bar:hover {
      opacity: 1 !important;
      filter: brightness(1.1);
    }

    .bar-group {
      cursor: pointer;
    }

    .bar-group:hover .chart-bar {
      transform: translateY(-2px);
    }

    /* Chart Tooltip */
    .chart-tooltip {
      position: absolute;
      display: none;
      background: var(--bg-card);
      color: var(--text-primary);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      pointer-events: none;
      z-index: 10000;
      white-space: nowrap;
    }

    .secondary-trends-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.25rem;
      margin-top: 1rem;
    }

    @media (max-width: 1024px) {
      .secondary-trends-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Secondary Trend Sections (Duration, Flaky, Slow) */
    .secondary-trends {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.25rem;
      margin-top: 1.75rem;
      padding-top: 1.75rem;
      border-top: 1px solid var(--border-subtle);
    }

    @media (max-width: 768px) {
      .secondary-trends {
        grid-template-columns: 1fr;
      }
    }

    .secondary-trend-section {
      background: var(--bg-primary);
      border-radius: 10px;
      border: 1px solid var(--border-subtle);
      padding: 1rem 1.25rem;
    }

    .secondary-trend-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.875rem;
    }

    .secondary-trend-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .secondary-trend-chart {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      height: 50px;
      padding: 4px 0;
    }

    .secondary-bar-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-width: 24px;
      max-width: 44px;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    .secondary-bar-wrapper:hover {
      transform: translateY(-2px);
    }

    .secondary-bar-wrapper:hover .secondary-value {
      color: var(--text-primary);
    }

    .secondary-bar {
      width: 100%;
      border-radius: 4px 4px 1px 1px;
      transition: all 0.3s ease;
    }

    .secondary-bar:hover {
      transform: scaleY(1.08);
    }

    .secondary-bar.current {
      border: 1px solid var(--text-primary);
    }

    /* Duration bars */
    .secondary-bar.duration {
      background: linear-gradient(180deg, var(--accent-purple) 0%, #7744cc 100%);
      box-shadow: 0 2px 6px rgba(170, 102, 255, 0.2);
    }

    .secondary-bar.duration:hover {
      box-shadow: 0 4px 12px rgba(170, 102, 255, 0.4);
      background: linear-gradient(180deg, #bb88ff 0%, var(--accent-purple) 100%);
    }

    /* Flaky bars */
    .secondary-bar.flaky {
      background: linear-gradient(180deg, var(--accent-yellow) 0%, var(--accent-yellow-dim) 100%);
      box-shadow: 0 2px 6px rgba(255, 204, 0, 0.2);
    }

    .secondary-bar.flaky:hover {
      box-shadow: 0 4px 12px rgba(255, 204, 0, 0.4);
      background: linear-gradient(180deg, #ffdd44 0%, var(--accent-yellow) 100%);
    }

    /* Slow bars */
    .secondary-bar.slow {
      background: linear-gradient(180deg, var(--accent-orange) 0%, #cc6633 100%);
      box-shadow: 0 2px 6px rgba(255, 136, 68, 0.2);
    }

    .secondary-bar.slow:hover {
      box-shadow: 0 4px 12px rgba(255, 136, 68, 0.4);
      background: linear-gradient(180deg, #ffaa66 0%, var(--accent-orange) 100%);
    }

    .secondary-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.6rem;
      color: var(--text-muted);
      margin-top: 4px;
      transition: color 0.2s ease;
    }

    /* Legacy duration styles for backwards compat */
    .duration-trend-section {
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--border-subtle);
    }

    .duration-trend-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .duration-trend-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .duration-trend-chart {
      display: flex;
      align-items: flex-end;
      gap: 6px;
      height: 80px;
      padding: 8px 8px 20px 8px;
      background: var(--bg-primary);
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }

    .duration-bar-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 32px;
      max-width: 50px;
    }

    .duration-bar {
      width: 100%;
      background: linear-gradient(180deg, var(--accent-purple) 0%, #7744cc 100%);
      border-radius: 4px 4px 2px 2px;
      transition: all 0.3s ease;
      box-shadow: 0 2px 8px rgba(170, 102, 255, 0.2);
    }

    .duration-bar:hover {
      transform: scaleY(1.05);
      box-shadow: 0 4px 16px rgba(170, 102, 255, 0.3);
    }

    .duration-bar.current {
      box-shadow: 0 0 15px rgba(170, 102, 255, 0.5);
      border: 2px solid var(--text-primary);
    }

    .duration-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.6rem;
      color: var(--text-muted);
    }

    /* Individual Test History Sparkline */
    .history-section {
      display: flex;
      gap: 2rem;
      padding: 1rem;
      background: var(--bg-primary);
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }

    .history-column {
      flex: 1;
    }

    .history-label {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .sparkline {
      display: flex;
      gap: 3px;
      align-items: center;
      height: 24px;
    }

    .spark-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: transform 0.2s ease;
    }

    .spark-dot:hover {
      transform: scale(1.4);
    }

    .spark-dot.pass {
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
    }

    .spark-dot.fail {
      background: var(--accent-red);
      box-shadow: 0 0 6px var(--accent-red);
    }

    .spark-dot.skip {
      background: var(--text-muted);
    }

    .spark-dot.current {
      width: 10px;
      height: 10px;
      border: 2px solid var(--text-primary);
    }

    /* Duration Trend Mini Chart */
    .duration-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 32px;
      padding: 4px 0;
    }

    .duration-bar {
      width: 8px;
      min-height: 4px;
      background: var(--accent-blue);
      border-radius: 2px 2px 0 0;
      transition: all 0.2s ease;
    }

    .duration-bar:hover {
      filter: brightness(1.2);
    }

    .duration-bar.current {
      background: var(--accent-purple);
      box-shadow: 0 0 8px var(--accent-purple);
    }

    .duration-bar.slower {
      background: var(--accent-orange);
    }

    .duration-bar.faster {
      background: var(--accent-green);
    }

    .history-stats {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
    }

    .history-stat {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .history-stat span {
      color: var(--text-secondary);
    }

    /* Filters */
    .filters {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
    }

    .filter-btn {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .filter-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
      color: var(--text-primary);
    }

    .filter-btn.active {
      background: var(--text-primary);
      color: var(--bg-primary);
      border-color: var(--text-primary);
    }

    /* Search Container */
    .search-container {
      margin-bottom: 1rem;
    }

    .search-wrapper {
      position: relative;
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 0.75rem 1rem;
      padding-left: 2.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(0, 170, 255, 0.1);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    /* Test Cards */
    .test-list { display: flex; flex-direction: column; gap: 0.75rem; }

    .test-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
    }

    .test-card:hover {
      border-color: var(--border-glow);
      background: var(--bg-card-hover);
    }

    .test-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      cursor: pointer;
      gap: 1rem;
    }

    .test-card-left {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
      flex: 1;
    }

    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      animation: pulse 2s infinite;
    }

    .status-indicator.passed {
      background: var(--accent-green);
      box-shadow: 0 0 12px var(--accent-green);
    }

    .status-indicator.failed {
      background: var(--accent-red);
      box-shadow: 0 0 12px var(--accent-red);
      animation: pulse-red 1.5s infinite;
    }

    .status-indicator.skipped {
      background: var(--text-muted);
      box-shadow: none;
      animation: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    @keyframes pulse-red {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.1); }
    }

    .test-info { min-width: 0; flex: 1; }

    .test-title {
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .test-file {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .test-card-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .test-duration {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      border: 1px solid;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge.stable {
      color: var(--accent-green);
      border-color: var(--accent-green-dim);
      background: rgba(0, 255, 136, 0.1);
    }

    .badge.unstable {
      color: var(--accent-yellow);
      border-color: var(--accent-yellow-dim);
      background: rgba(255, 204, 0, 0.1);
    }

    .badge.flaky {
      color: var(--accent-red);
      border-color: var(--accent-red-dim);
      background: rgba(255, 68, 102, 0.1);
    }

    .badge.new {
      color: var(--text-muted);
      border-color: var(--border-subtle);
      background: rgba(90, 90, 112, 0.1);
    }

    .badge.skipped {
      color: var(--text-muted);
      border-color: var(--border-subtle);
      background: rgba(90, 90, 112, 0.1);
    }

    .trend {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
    }

    .trend.slower { color: var(--accent-orange); }
    .trend.faster { color: var(--accent-green); }
    .trend.stable { color: var(--text-muted); }

    .expand-icon {
      color: var(--text-muted);
      transition: transform 0.2s ease;
      font-size: 0.75rem;
    }

    .test-card.expanded .expand-icon {
      transform: rotate(90deg);
    }

    /* Test Details */
    .test-details {
      display: none;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
    }

    .test-card.expanded .test-details {
      display: block;
      animation: slideDown 0.2s ease;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .detail-section {
      margin-bottom: 1rem;
    }

    .detail-section:last-child {
      margin-bottom: 0;
    }

    .detail-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .detail-label .icon {
      font-size: 1rem;
    }

    .error-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      background: rgba(255, 68, 102, 0.1);
      border: 1px solid var(--accent-red-dim);
      border-radius: 8px;
      padding: 1rem;
      color: var(--accent-red);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .stack-box {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text-secondary);
      overflow-x: auto;
      max-height: 200px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ai-box {
      background: linear-gradient(135deg, rgba(0, 170, 255, 0.1) 0%, rgba(170, 102, 255, 0.1) 100%);
      border: 1px solid var(--accent-blue-dim);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text-primary);
      font-size: 0.9rem;
      position: relative;
    }

    .ai-box::before {
      content: '';
      position: absolute;
      top: -1px;
      left: 20px;
      right: 20px;
      height: 2px;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      border-radius: 2px;
    }

    .duration-compare {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Step Timings */
    .steps-container {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .step-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: var(--bg-primary);
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
    }

    .step-row.slowest {
      border-color: var(--accent-orange);
      background: rgba(255, 136, 68, 0.1);
    }

    .step-bar-container {
      flex: 1;
      height: 6px;
      background: var(--border-subtle);
      border-radius: 3px;
      overflow: hidden;
    }

    .step-bar {
      height: 100%;
      background: var(--accent-blue);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .step-row.slowest .step-bar {
      background: var(--accent-orange);
    }

    .step-title {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-secondary);
      min-width: 0;
      flex: 2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .step-row.slowest .step-title {
      color: var(--accent-orange);
    }

    .step-duration {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      min-width: 60px;
      text-align: right;
    }

    /* File Groups */
    .file-group {
      margin-bottom: 1rem;
    }

    .file-group-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 0.5rem;
      transition: all 0.2s;
    }

    .file-group-header:hover {
      border-color: var(--border-glow);
    }

    .file-group-header .expand-icon {
      transition: transform 0.2s;
    }

    .file-group.collapsed .file-group-header .expand-icon {
      transform: rotate(-90deg);
    }

    .file-group-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      color: var(--text-primary);
      flex: 1;
    }

    .file-group-stats {
      display: flex;
      gap: 0.5rem;
      font-size: 0.75rem;
    }

    .file-group-stat {
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: 'JetBrains Mono', monospace;
    }

    .file-group-stat.passed { color: var(--accent-green); background: rgba(0, 255, 136, 0.1); }
    .file-group-stat.failed { color: var(--accent-red); background: rgba(255, 68, 102, 0.1); }

    .file-group-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-left: 1rem;
    }

    .file-group.collapsed .file-group-content {
      display: none;
    }


    .step-row.slowest .step-duration {
      color: var(--accent-orange);
      font-weight: 600;
    }

    .slowest-badge {
      font-size: 0.65rem;
      padding: 0.15rem 0.4rem;
      background: var(--accent-orange);
      color: var(--bg-primary);
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    /* Screenshot Display */
    .screenshot-box {
      margin-top: 0.5rem;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
    }

    .screenshot-box img {
      width: 100%;
      height: auto;
      display: block;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .screenshot-box img:hover {
      transform: scale(1.02);
    }
    }

    .attachments {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .attachment-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--accent-blue);
      text-decoration: none;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      transition: all 0.2s;
      cursor: pointer;
    }

    .attachment-link:hover {
      border-color: var(--accent-blue);
      background: rgba(0, 170, 255, 0.1);
    }

    .export-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .export-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="logo">
        <div class="logo-icon">S</div>
        <div class="logo-text">
          <h1>Smart Report</h1>
          <span>playwright test insights</span>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <button class="export-btn" onclick="exportJSON()">📥 Export JSON</button>
        <div class="timestamp">${new Date().toLocaleString()}</div>
      </div>
    </header>

    <!-- Progress Ring + Stats -->
    <div style="display: flex; gap: 2rem; align-items: flex-start; margin-bottom: 2rem;">
      <div style="text-align: center;">
        <div class="progress-ring">
          <svg width="120" height="120">
            <circle class="bg" cx="60" cy="60" r="50"/>
            <circle class="progress" cx="60" cy="60" r="50"/>
          </svg>
          <div class="value">${passRate}%</div>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.875rem;">Pass Rate</div>
      </div>

      <div class="stats-grid" style="flex: 1;">
        <div class="stat-card passed">
          <div class="stat-value">${passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card failed">
          <div class="stat-value">${failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card skipped">
          <div class="stat-value">${skipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat-card flaky">
          <div class="stat-value">${flaky}</div>
          <div class="stat-label">Flaky</div>
        </div>
        <div class="stat-card slow">
          <div class="stat-value">${slow}</div>
          <div class="stat-label">Slow</div>
        </div>
        <div class="stat-card duration">
          <div class="stat-value">${this.formatDuration(totalDuration)}</div>
          <div class="stat-label">Duration</div>
        </div>
      </div>
    </div>

    <!-- Trend Chart -->
    ${this.generateTrendChart()}

    <!-- Search -->
    <div class="search-container">
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" placeholder="Search tests by name..." oninput="searchTests(this.value)">
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <button class="filter-btn active" data-filter="all" onclick="filterTests('all')">All (${total})</button>
      <button class="filter-btn" data-filter="passed" onclick="filterTests('passed')">Passed (${passed})</button>
      <button class="filter-btn" data-filter="failed" onclick="filterTests('failed')">Failed (${failed})</button>
      <button class="filter-btn" data-filter="skipped" onclick="filterTests('skipped')">Skipped (${skipped})</button>
      <button class="filter-btn" data-filter="new" onclick="filterTests('new')">New (${newTests})</button>
      <button class="filter-btn" data-filter="flaky" onclick="filterTests('flaky')">Flaky (${flaky})</button>
      <button class="filter-btn" data-filter="slow" onclick="filterTests('slow')">Slow (${slow})</button>
      <button class="filter-btn" data-filter="new" onclick="filterTests('new')">New (${newTests})</button>
    </div>

    <!-- Test List -->
    <div class="test-list">
      ${this.generateGroupedTests()}
    </div>
  </div>

  <script>
    const tests = ${testsJson};

    function searchTests(query) {
      const lowerQuery = query.toLowerCase();
      document.querySelectorAll('.test-card').forEach(card => {
        const title = card.querySelector('.test-title')?.textContent?.toLowerCase() || '';
        const file = card.querySelector('.test-file')?.textContent?.toLowerCase() || '';
        const matches = title.includes(lowerQuery) || file.includes(lowerQuery);
        card.style.display = matches ? 'block' : 'none';
      });

      // Also show/hide file groups if all tests are hidden
      document.querySelectorAll('.file-group').forEach(group => {
        const visibleTests = group.querySelectorAll('.test-card[style="display: block"], .test-card:not([style*="display"])');
        const hasVisible = Array.from(group.querySelectorAll('.test-card')).some(
          card => card.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });
    }

    function filterTests(filter) {
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });

      document.querySelectorAll('.test-card').forEach(card => {
        const status = card.dataset.status;
        const isFlaky = card.dataset.flaky === 'true';
        const isSlow = card.dataset.slow === 'true';
        const isNew = card.dataset.new === 'true';

        let show = filter === 'all' ||
          (filter === 'passed' && status === 'passed') ||
          (filter === 'failed' && (status === 'failed' || status === 'timedOut')) ||
          (filter === 'skipped' && status === 'skipped') ||
          (filter === 'new' && isNew) ||
          (filter === 'flaky' && isFlaky) ||
          (filter === 'slow' && isSlow) ||
          (filter === 'new' && isNew);

        card.style.display = show ? 'block' : 'none';

      // Update group visibility
      document.querySelectorAll('.file-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.test-card')).some(
          card => card.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });
      });
    }

    function toggleDetails(id) {
      const card = document.getElementById('card-' + id);
      card.classList.toggle('expanded');
    }

    function toggleGroup(groupId) {
      const group = document.getElementById('group-' + groupId);
      group.classList.toggle('collapsed');
    }

    function exportJSON() {
      const data = {
        timestamp: new Date().toISOString(),
        summary: {
          total: tests.length,
          passed: tests.filter(t => t.status === 'passed').length,
          failed: tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length,
          skipped: tests.filter(t => t.status === 'skipped').length,
        },
        tests: tests
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'test-results-' + new Date().toISOString().split('T')[0] + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function viewTrace(base64Data, filename) {
      // Convert base64 to blob and trigger download
      const byteChars = atob(base64Data.split(',')[1]);
      const byteNumbers = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], {type: 'application/zip'});
      const url = URL.createObjectURL(blob);
      
      // Auto-download the trace file
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Open trace viewer in new tab
      window.open('https://trace.playwright.dev', '_blank');
      
      URL.revokeObjectURL(url);
    }

    // Chart bar tooltips
    (function initChartTooltips() {
      const tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      document.body.appendChild(tooltip);

      document.querySelectorAll('.bar-group').forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
          const text = bar.getAttribute('data-tooltip');
          if (text) {
            tooltip.textContent = text;
            tooltip.style.display = 'block';
          }
        });

        bar.addEventListener('mousemove', (e) => {
          tooltip.style.left = e.pageX + 10 + 'px';
          tooltip.style.top = e.pageY - 30 + 'px';
        });

        bar.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    })();
  </script>
</body>
</html>`;
  }

  private generateTestCard(test: TestResultData): string {
    const isFlaky = test.flakinessScore !== undefined && test.flakinessScore >= 0.3;
    const isUnstable = test.flakinessScore !== undefined && test.flakinessScore >= 0.1 && test.flakinessScore < 0.3;
    const isSlow = test.performanceTrend?.startsWith('↑') || false;
    const isFaster = test.performanceTrend?.startsWith('↓') || false;
    const isNew = test.flakinessIndicator?.includes('New') || false;
    const hasDetails = test.error || test.aiSuggestion || test.steps.length > 0 || test.status !== 'passed';
    const cardId = this.sanitizeId(test.testId);

    // Determine badge class
    let badgeClass = 'new';
    if (test.flakinessIndicator?.includes('Stable')) badgeClass = 'stable';
    else if (test.flakinessIndicator?.includes('Unstable')) badgeClass = 'unstable';
    else if (test.flakinessIndicator?.includes('Flaky')) badgeClass = 'flaky';
    else if (test.flakinessIndicator?.includes('Skipped')) badgeClass = 'skipped';

    // Determine trend class
    let trendClass = 'stable';
    if (isSlow) trendClass = 'slower';
    else if (isFaster) trendClass = 'faster';

    return `
      <div id="card-${cardId}" class="test-card"
           data-status="${test.status}"
           data-flaky="${isFlaky}"
           data-slow="${isSlow}"
           data-new="${isNew}">
        <div class="test-card-header" ${hasDetails ? `onclick="toggleDetails('${cardId}')"` : ''}>
          <div class="test-card-left">
            <div class="status-indicator ${test.status === 'passed' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed'}"></div>
            <div class="test-info">
              <div class="test-title">${this.escapeHtml(test.title)}</div>
              <div class="test-file">${this.escapeHtml(test.file)}</div>
            </div>
          </div>
          <div class="test-card-right">
            <span class="test-duration">${this.formatDuration(test.duration)}</span>
            ${test.flakinessIndicator ? `<span class="badge ${badgeClass}">${test.flakinessIndicator.replace(/[🟢🟡🔴⚪]\s*/g, '')}</span>` : ''}
            ${test.performanceTrend ? `<span class="trend ${trendClass}">${test.performanceTrend}</span>` : ''}
            ${hasDetails ? `<span class="expand-icon">▶</span>` : ''}
          </div>
        </div>
        ${hasDetails ? this.generateTestDetails(test, cardId) : ''}
      </div>
    `;
  }

  private generateTestDetails(test: TestResultData, cardId: string): string {
    let details = '';

    // History visualization - show sparkline and duration trend if we have history
    if (test.history && test.history.length > 0) {
      const currentPassed = test.status === 'passed';
      const currentSkipped = test.status === 'skipped';
      const maxDuration = Math.max(...test.history.map(h => h.duration), test.duration);
      const nonSkippedHistory = test.history.filter(h => !h.skipped);
      const avgDuration = nonSkippedHistory.length > 0
        ? nonSkippedHistory.reduce((sum, h) => sum + h.duration, 0) / nonSkippedHistory.length
        : 0;
      const passCount = nonSkippedHistory.filter(h => h.passed).length;
      const passRate = nonSkippedHistory.length > 0 ? Math.round((passCount / nonSkippedHistory.length) * 100) : 0;

      // Determine if current run is slower/faster than average
      const currentTrendClass = test.duration > avgDuration * 1.2 ? 'slower' : test.duration < avgDuration * 0.8 ? 'faster' : '';

      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">📊</span> Run History (Last ${test.history.length} runs)</div>
          <div class="history-section">
            <div class="history-column">
              <div class="history-label">Pass/Fail</div>
              <div class="sparkline">
                ${test.history.map((h, i) => `<div class="spark-dot ${h.skipped ? 'skip' : h.passed ? 'pass' : 'fail'}" title="Run ${i + 1}: ${h.skipped ? 'Skipped' : h.passed ? 'Passed' : 'Failed'}"></div>`).join('')}
                <div class="spark-dot ${currentSkipped ? 'skip' : currentPassed ? 'pass' : 'fail'} current" title="Current: ${currentSkipped ? 'Skipped' : currentPassed ? 'Passed' : 'Failed'}"></div>
              </div>
              <div class="history-stats">
                <span class="history-stat">Pass rate: <span>${passRate}%</span></span>
              </div>
            </div>
            <div class="history-column">
              <div class="history-label">Duration Trend</div>
              <div class="duration-chart">
                ${test.history.map((h, i) => {
                  const height = maxDuration > 0 ? Math.max(4, (h.duration / maxDuration) * 28) : 4;
                  return `<div class="duration-bar" style="height: ${height}px" title="Run ${i + 1}: ${this.formatDuration(h.duration)}"></div>`;
                }).join('')}
                <div class="duration-bar current ${currentTrendClass}" style="height: ${maxDuration > 0 ? Math.max(4, (test.duration / maxDuration) * 28) : 4}px" title="Current: ${this.formatDuration(test.duration)}"></div>
              </div>
              <div class="history-stats">
                <span class="history-stat">Avg: <span>${this.formatDuration(avgDuration)}</span></span>
                <span class="history-stat">Current: <span>${this.formatDuration(test.duration)}</span></span>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Step timings - show first as it's most useful for performance analysis
    if (test.steps.length > 0) {
      const maxDuration = Math.max(...test.steps.map((s) => s.duration));
      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">⏱</span> Step Timings</div>
          <div class="steps-container">
            ${test.steps
              .map(
                (step) => `
              <div class="step-row ${step.isSlowest ? 'slowest' : ''}">
                <span class="step-title" title="${this.escapeHtml(step.title)}">${this.escapeHtml(step.title)}</span>
                <div class="step-bar-container">
                  <div class="step-bar" style="width: ${maxDuration > 0 ? (step.duration / maxDuration) * 100 : 0}%"></div>
                </div>
                <span class="step-duration">${this.formatDuration(step.duration)}</span>
                ${step.isSlowest ? '<span class="slowest-badge">Slowest</span>' : ''}
              </div>
            `
              )
              .join('')}
          </div>
        </div>
      `;
    }

    if (test.error) {
      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">⚠</span> Error</div>
          <div class="error-box">${this.escapeHtml(test.error)}</div>
        </div>
      `;
    }

    if (test.screenshot) {
      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">📸</span> Screenshot</div>
          <div class="screenshot-box">
            <img src="${test.screenshot}" alt="Failure screenshot" onclick="window.open(this.src, '_blank')"/>
          </div>
        </div>
      `;
    }

    if (test.videoPath || test.tracePath || test.traceData) {
      const traceFilename = `trace-${this.sanitizeId(test.title)}.zip`;
      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">📎</span> Attachments</div>
          <div class="attachments">
            ${test.videoPath ? `<a href="file://${test.videoPath}" class="attachment-link" target="_blank">🎬 Video</a>` : ''}
            ${test.traceData
              ? `<button class="attachment-link" onclick="viewTrace('${test.traceData}', '${traceFilename}')">🔍 Download and View Trace</button>`
              : test.tracePath
              ? `<a href="file://${test.tracePath}" class="attachment-link" target="_blank">🔍 Download and View Trace</a>`
              : ''}
          </div>
        </div>
      `;
    }

    if (test.aiSuggestion) {
      details += `
        <div class="detail-section">
          <div class="detail-label"><span class="icon">🤖</span> AI Suggestion</div>
          <div class="ai-box">${this.escapeHtml(test.aiSuggestion)}</div>
        </div>
      `;
    }

    if (test.averageDuration !== undefined) {
      details += `
        <div class="duration-compare">
          Average: ${this.formatDuration(test.averageDuration)} → Current: ${this.formatDuration(test.duration)}
        </div>
      `;
    }

    return `<div class="test-details">${details}</div>`;
  }

  private generateGroupedTests(): string {
    // Group tests by file
    const groups = new Map<string, TestResultData[]>();
    for (const test of this.results) {
      const file = test.file;
      if (!groups.has(file)) {
        groups.set(file, []);
      }
      groups.get(file)!.push(test);
    }

    return Array.from(groups.entries()).map(([file, tests]) => {
      const passed = tests.filter(t => t.status === 'passed').length;
      const failed = tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length;
      const groupId = this.sanitizeId(file);

      return `
      <div id="group-${groupId}" class="file-group">
        <div class="file-group-header" onclick="toggleGroup('${groupId}')">
          <span class="expand-icon">▼</span>
          <span class="file-group-name">📄 ${this.escapeHtml(file)}</span>
          <div class="file-group-stats">
            ${passed > 0 ? `<span class="file-group-stat passed">${passed} passed</span>` : ''}
            ${failed > 0 ? `<span class="file-group-stat failed">${failed} failed</span>` : ''}
          </div>
        </div>
        <div class="file-group-content">
          ${tests.map(test => this.generateTestCard(test)).join('\n')}
        </div>
      </div>
    `;
    }).join('\n');
  }

  private generateTrendChart(): string {
    const summaries = this.historyCollector.getHistory().summaries || [];
    if (summaries.length < 2) {
      return ''; // Don't show trend with less than 2 data points
    }

    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;
    const currentFlaky = this.results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
    const currentSlow = this.results.filter(r => r.performanceTrend?.startsWith('↑')).length;
    const total = this.results.length;
    const currentDuration = Date.now() - this.startTime;

    // Chart dimensions
    const chartWidth = 800;
    const chartHeight = 120;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const plotWidth = chartWidth - padding.left - padding.right;
    const plotHeight = chartHeight - padding.top - padding.bottom;

    // Prepare data points including current run
    const allSummaries = [...summaries, {
      runId: 'current',
      timestamp: new Date().toISOString(),
      total,
      passed,
      failed,
      skipped,
      flaky: currentFlaky,
      slow: currentSlow,
      duration: currentDuration,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0
    }];

    // Find max values for scaling
    const maxTotal = Math.max(...allSummaries.map((s: any) => s.passed + s.failed), 1);
    const maxDuration = Math.max(...allSummaries.map((s: any) => s.duration || 0), 1);
    const maxFlaky = Math.max(...allSummaries.map((s: any) => s.flaky || 0), 1);
    const maxSlow = Math.max(...allSummaries.map((s: any) => s.slow || 0), 1);

    // Helper function to generate SVG line chart
    const generateLineChart = (
      data: any[],
      getValue: (d: any) => number,
      maxValue: number,
      color: string,
      yAxisLabel: string
    ): string => {
      const stepX = plotWidth / (data.length - 1);

      // Generate line points
      const points = data.map((d, i) => {
        const x = padding.left + i * stepX;
        const value = getValue(d);
        const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
        return `${x},${y}`;
      }).join(' ');

      // Generate data point circles
      const circles = data.map((d, i) => {
        const x = padding.left + i * stepX;
        const value = getValue(d);
        const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
        const label = i === data.length - 1 ? 'Current' : new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const isCurrent = i === data.length - 1;
        return `
          <circle cx="${x}" cy="${y}" r="${isCurrent ? 5 : 3}" fill="${color}" stroke="var(--bg-primary)" stroke-width="2">
            <title>${label}: ${value}</title>
          </circle>
        `;
      }).join('');

      // Generate x-axis labels
      const xLabels = data.map((d, i) => {
        if (i % Math.ceil(data.length / 5) !== 0 && i !== data.length - 1) return '';
        const x = padding.left + i * stepX;
        const label = i === data.length - 1 ? 'Now' : new Date(d.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<text x="${x}" y="${chartHeight - 5}" fill="var(--text-muted)" font-size="10" text-anchor="middle">${label}</text>`;
      }).join('');

      // Generate y-axis labels
      const yTicks = 4;
      const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
        const value = Math.round((maxValue / yTicks) * i);
        const y = padding.top + plotHeight - (i / yTicks) * plotHeight;
        return `
          <text x="${padding.left - 5}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${value}</text>
          <line x1="${padding.left}" y1="${y}" x2="${padding.left + plotWidth}" y2="${y}" stroke="var(--border-subtle)" stroke-width="1" opacity="0.3"/>
        `;
      }).join('');

      return `
        <svg width="${chartWidth}" height="${chartHeight}" style="overflow: visible;">
          <!-- Y-axis label -->
          <text x="10" y="${chartHeight / 2}" fill="var(--text-secondary)" font-size="11" font-weight="600" text-anchor="middle" transform="rotate(-90, 10, ${chartHeight / 2})">${yAxisLabel}</text>

          <!-- Grid lines and y-axis labels -->
          ${yLabels}

          <!-- Line -->
          <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>

          <!-- Data points -->
          ${circles}

          <!-- X-axis labels -->
          ${xLabels}
        </svg>
      `;
    };

    // Generate pass rate line chart
    const passRateChart = generateLineChart(
      allSummaries,
      (s: any) => s.passRate || 0,
      100,
      'var(--accent-green)',
      'Pass Rate (%)'
    );

    // Generate duration line chart
    const durationChart = generateLineChart(
      allSummaries,
      (s: any) => Math.round((s.duration || 0) / 1000), // Convert to seconds
      Math.ceil(maxDuration / 1000),
      'var(--accent-purple)',
      'Duration (s)'
    );

    // Generate flaky tests line chart
    const flakyChart = generateLineChart(
      allSummaries,
      (s: any) => s.flaky || 0,
      maxFlaky,
      'var(--accent-yellow)',
      'Flaky Tests'
    );

    // Generate slow tests line chart
    const slowChart = generateLineChart(
      allSummaries,
      (s: any) => s.slow || 0,
      maxSlow,
      'var(--accent-orange)',
      'Slow Tests'
    );

    return `
      <div class="trend-section">
        <div class="trend-header">
          <div class="trend-title">📊 Test Run Trends</div>
          <div class="trend-subtitle">Last ${allSummaries.length} runs</div>
        </div>

        <!-- Pass Rate Chart -->
        <div class="line-chart-container">
          <h4 class="chart-title">✅ Pass Rate Over Time</h4>
          ${passRateChart}
        </div>

        <!-- Secondary Charts Grid -->
        <div class="secondary-trends-grid">
          <div class="line-chart-container">
            <h4 class="chart-title">⏱️ Duration Trend</h4>
            ${durationChart}
          </div>
          <div class="line-chart-container">
            <h4 class="chart-title">🟡 Flaky Tests</h4>
            ${flakyChart}
          </div>
          <div class="line-chart-container">
            <h4 class="chart-title">🐢 Slow Tests</h4>
            ${slowChart}
          </div>
        </div>
      </div>
    `;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private sanitizeId(str: string): string {
    return str.replace(/[^a-zA-Z0-9]/g, '_');
  }
}

// ============================================================================
// History Merge Utility
// ============================================================================

export function mergeHistories(
  historyFiles: string[],
  outputFile: string,
  maxHistoryRuns: number = 10
): void {
  const mergedHistory: TestHistory = { runs: [], tests: {}, summaries: [] };

  // Load and merge all history files
  for (const filePath of historyFiles) {
    if (!fs.existsSync(filePath)) {
      console.warn(`History file not found: ${filePath}`);
      continue;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const history: TestHistory = JSON.parse(content);

      // Merge runs metadata
      if (history.runs) {
        mergedHistory.runs.push(...history.runs);
      }

      // Merge test entries
      if (history.tests) {
        for (const [testId, entries] of Object.entries(history.tests)) {
          if (!mergedHistory.tests[testId]) {
            mergedHistory.tests[testId] = [];
          }
          mergedHistory.tests[testId].push(...entries);
        }
      }

      // Merge summaries
      if (history.summaries) {
        mergedHistory.summaries!.push(...history.summaries);
      }
    } catch (err) {
      console.error(`Failed to parse history file ${filePath}:`, err);
    }
  }

  // Sort and deduplicate runs by runId
  const seenRunIds = new Set<string>();
  mergedHistory.runs = mergedHistory.runs
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .filter(run => {
      if (seenRunIds.has(run.runId)) return false;
      seenRunIds.add(run.runId);
      return true;
    })
    .slice(-maxHistoryRuns);

  // Sort test entries by timestamp and keep last N
  for (const testId of Object.keys(mergedHistory.tests)) {
    mergedHistory.tests[testId] = mergedHistory.tests[testId]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-maxHistoryRuns);
  }

  // Sort and deduplicate summaries by runId
  const seenSummaryIds = new Set<string>();
  mergedHistory.summaries = mergedHistory.summaries!
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .filter(summary => {
      if (seenSummaryIds.has(summary.runId)) return false;
      seenSummaryIds.add(summary.runId);
      return true;
    })
    .slice(-maxHistoryRuns);

  // Write merged history
  fs.writeFileSync(outputFile, JSON.stringify(mergedHistory, null, 2));
  console.log(`✅ Merged ${historyFiles.length} history files into ${outputFile}`);
}

export default SmartReporter;
