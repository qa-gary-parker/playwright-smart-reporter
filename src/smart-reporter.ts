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
  RunSnapshotFile,
} from './types';

// ============================================================================
// Imports: Collectors
// ============================================================================

import {
  HistoryCollector,
  StepCollector,
  AttachmentCollector,
  NetworkCollector,
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
import type { CIInfo } from './types';

/**
 * Auto-detect CI environment and capture metadata
 */
function detectCIInfo(): CIInfo | undefined {
  const env = process.env;

  if (env.GITHUB_ACTIONS) {
    return {
      provider: 'github',
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GITHUB_REF?.replace('refs/heads/', ''),
      commit: env.GITHUB_SHA?.slice(0, 8),
      buildId: env.GITHUB_RUN_ID,
    };
  }
  if (env.GITLAB_CI) {
    return {
      provider: 'gitlab',
      branch: env.CI_COMMIT_REF_NAME,
      commit: env.CI_COMMIT_SHORT_SHA || env.CI_COMMIT_SHA?.slice(0, 8),
      buildId: env.CI_PIPELINE_ID,
    };
  }
  if (env.CIRCLECI) {
    return {
      provider: 'circleci',
      branch: env.CIRCLE_BRANCH,
      commit: env.CIRCLE_SHA1?.slice(0, 8),
      buildId: env.CIRCLE_BUILD_NUM,
    };
  }
  if (env.JENKINS_URL) {
    return {
      provider: 'jenkins',
      branch: env.GIT_BRANCH || env.BRANCH_NAME,
      commit: env.GIT_COMMIT?.slice(0, 8),
      buildId: env.BUILD_NUMBER,
    };
  }
  if (env.TF_BUILD) {
    return {
      provider: 'azure',
      branch: env.BUILD_SOURCEBRANCH?.replace('refs/heads/', ''),
      commit: env.BUILD_SOURCEVERSION?.slice(0, 8),
      buildId: env.BUILD_BUILDID,
    };
  }
  if (env.BUILDKITE) {
    return {
      provider: 'buildkite',
      branch: env.BUILDKITE_BRANCH,
      commit: env.BUILDKITE_COMMIT?.slice(0, 8),
      buildId: env.BUILDKITE_BUILD_NUMBER,
    };
  }
  if (env.CI) {
    return {
      provider: 'unknown',
      branch: env.CI_BRANCH || env.BRANCH,
      commit: env.CI_COMMIT || env.COMMIT,
      buildId: env.CI_BUILD_ID || env.BUILD_ID,
    };
  }
  return undefined;
}

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
  private networkCollector: NetworkCollector;

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
  private resultsMap: Map<string, TestResultData> = new Map(); // Track final result per test
  private outputDir: string = '';
  private startTime: number = 0;
  private fullConfig: FullConfig | null = null;
  private runnerErrors: string[] = [];
  private ciInfo?: CIInfo;

  constructor(options: SmartReporterOptions = {}) {
    this.options = options;

    // Initialize collectors (attachment collector will be re-initialized in onBegin with outputDir)
    // Issue #22: Pass filterPwApiSteps option to StepCollector
    this.stepCollector = new StepCollector({
      filterPwApiSteps: options.filterPwApiSteps,
    });
    this.attachmentCollector = new AttachmentCollector();

    // Note: NetworkCollector is initialized in onBegin when we have access to full config
    this.networkCollector = new NetworkCollector({
      excludeStaticAssets: false,  // Show all network activity by default
      maxEntries: 30,
      includeBodies: true,
    });

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
    // Issue #20: Support path resolution relative to current working directory
    // When relativeToCwd is true, use process.cwd() instead of config.rootDir
    this.outputDir = this.options.relativeToCwd ? process.cwd() : config.rootDir;
    this.fullConfig = config;

    // Auto-detect CI environment
    this.ciInfo = detectCIInfo();

    // Initialize HistoryCollector and load history
    this.historyCollector = new HistoryCollector(this.options, this.outputDir);
    this.historyCollector.loadHistory();

    // Re-initialize attachment collector with output directory for CSP-safe mode
    const outputPath = path.resolve(this.outputDir, this.options.outputFile ?? 'smart-report.html');
    const outputDir = path.dirname(outputPath);
    this.attachmentCollector = new AttachmentCollector({
      cspSafe: this.options.cspSafe,
      outputDir: outputDir,
    });

    // Initialize all analyzers with thresholds from options
    const thresholds = this.options.thresholds;
    const performanceThreshold = thresholds?.performanceRegression ?? this.options.performanceThreshold ?? 0.2;
    const retryFailureThreshold = this.options.retryFailureThreshold ?? 3;
    const stabilityThreshold = this.options.stabilityThreshold ?? 70;

    this.flakinessAnalyzer = new FlakinessAnalyzer(thresholds);
    this.performanceAnalyzer = new PerformanceAnalyzer(performanceThreshold);
    this.retryAnalyzer = new RetryAnalyzer(retryFailureThreshold);
    this.stabilityScorer = new StabilityScorer(stabilityThreshold, thresholds);

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
  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    const testId = this.getTestId(test);
    const file = path.relative(this.outputDir, test.location.file);

    // Collect test components
    const steps = this.stepCollector.extractSteps(result);
    const attachments = this.attachmentCollector.collectAttachments(result);
    const history = this.historyCollector.getTestHistory(testId);

    // Issue #15: Improved tag extraction
    // 1. Use test.tags directly (Playwright's built-in tag collection)
    // 2. Fall back to annotations for older Playwright versions
    // 3. Extract from test title as backup
    const tags: string[] = [];

    // Primary source: test.tags (includes @-tokens from title and test.describe tags)
    if (test.tags && Array.isArray(test.tags)) {
      for (const tag of test.tags) {
        const normalizedTag = tag.startsWith('@') ? tag : `@${tag}`;
        if (!tags.includes(normalizedTag)) tags.push(normalizedTag);
      }
    }

    // Secondary source: annotations (for backwards compatibility)
    for (const a of test.annotations) {
      if (a.type === 'tag' || a.type.startsWith('@')) {
        const tag = a.type.startsWith('@') ? a.type : `@${a.description || a.type}`;
        if (!tags.includes(tag)) tags.push(tag);
      }
    }

    // Tertiary source: extract from test title (e.g., "Login @smoke @critical")
    const titleTagMatches = test.title.match(/@[\w-]+/g);
    if (titleTagMatches) {
      for (const tag of titleTagMatches) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }

    // Extract suite hierarchy from titlePath (last element is test title itself)
    const titlePath = test.titlePath();
    // Filter out empty strings from titlePath (some Playwright versions include empty root)
    const filteredPath = titlePath.filter(p => p && p.length > 0);
    const suites = filteredPath.slice(1, -1); // Remove project name (first) and test title (last)
    const suite = suites.length > 0 ? suites[suites.length - 1] : undefined;

    // Extract browser name and project name from project configuration (if available)
    // Common patterns: 'chromium', 'firefox', 'webkit', 'Desktop Chrome', 'Mobile Safari', etc.
    let browserName: string | undefined;
    let projectName: string | undefined;
    try {
      const project = test.parent?.project?.();
      if (project) {
        // Get project name directly from project configuration
        projectName = project.name || undefined;

        // Try to get browser from project use.browserName or infer from project name
        const browserFromUse = project.use?.browserName;
        if (browserFromUse) {
          browserName = browserFromUse;
        } else if (project.name) {
          // Infer from common project naming patterns
          const name = project.name.toLowerCase();
          if (name.includes('chromium') || name.includes('chrome')) {
            browserName = 'chromium';
          } else if (name.includes('firefox')) {
            browserName = 'firefox';
          } else if (name.includes('webkit') || name.includes('safari')) {
            browserName = 'webkit';
          }
        }
      }
    } catch (err) {
      // Project info not available - only log unexpected errors in debug scenarios
      // This is expected to fail for some test setups where project() is not available
      if (process.env.DEBUG) {
        console.warn('Could not extract browser/project info:', err);
      }
    }

    // Extract all annotations (not just tags) - captures @slow, @fixme, @skip, custom annotations
    const annotations: { type: string; description?: string }[] = [];
    for (const a of test.annotations) {
      // Skip tags (already captured above) - only capture other annotation types
      if (a.type !== 'tag' && !a.type.startsWith('@')) {
        annotations.push({
          type: a.type,
          description: a.description || undefined,
        });
      }
    }

    // Get test outcome and expected status for proper handling of:
    // - Flaky tests (passed on retry)
    // - Expected failures (test.fail())
    const outcome = test.outcome(); // 'expected' | 'unexpected' | 'flaky' | 'skipped'
    const expectedStatus = test.expectedStatus; // 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted'

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
      tags: tags.length > 0 ? tags : undefined,
      suite,
      suites: suites.length > 0 ? suites : undefined,
      // Browser/project info for multi-browser setups
      browser: browserName,
      project: projectName,
      // All annotations (not just tags) - @slow, @fixme, @skip reason, custom
      annotations: annotations.length > 0 ? annotations : undefined,
      // Track outcome and expected status for proper counting
      outcome,
      expectedStatus,
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
      // Embed trace as base64 for one-click viewing (skip in CSP-safe mode)
      // Respect maxEmbeddedSize to prevent huge HTML files (default: 5MB)
      const maxEmbeddedSize = this.options.maxEmbeddedSize ?? 5 * 1024 * 1024;
      if (!this.options.cspSafe) {
        try {
          const stats = fs.statSync(traceAttachment.path);
          if (stats.size <= maxEmbeddedSize) {
            const traceBuffer = fs.readFileSync(traceAttachment.path);
            testData.traceData = `data:application/zip;base64,${traceBuffer.toString('base64')}`;
          }
        } catch {
          // If we can't read the trace, just use the path
        }
      }
      // Extract network logs from trace (enabled by default when traces exist)
      if (this.options.enableNetworkLogs !== false) {
        try {
          const networkLogs = await this.networkCollector.collectFromTrace(traceAttachment.path);
          if (networkLogs.entries.length > 0) {
            testData.networkLogs = networkLogs;
          }
        } catch {
          // Network log extraction is optional, don't fail on errors
        }
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

    // Store result - only keep the final attempt for each test (Issue #17 fix)
    // This prevents double-counting when tests retry
    const existingResult = this.resultsMap.get(testId);
    if (!existingResult || result.retry > existingResult.retry) {
      // This is a newer attempt - replace the previous one
      this.resultsMap.set(testId, testData);
    }
  }

  /**
   * Called when the test run completes
   * Performs final analysis, generates HTML report, updates history, and sends notifications
   * @param result - Full test run result
   */
  async onEnd(result: FullResult): Promise<void> {
    // Convert resultsMap to array - this ensures we only have the final attempt for each test
    // This fixes Issue #17: retries no longer double-counted
    this.results = Array.from(this.resultsMap.values());

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
        // Build current run summary with proper outcome-based counting
        // Issue #17: Use outcome to properly count flaky tests
        // Issue #16: Tests with expectedStatus='failed' that fail are counted as passed (expected behavior)
        const passed = this.results.filter(r =>
          r.status === 'passed' ||
          r.outcome === 'expected' ||  // Expected failures count as "passed" (they behaved as expected)
          r.outcome === 'flaky'        // Flaky tests passed on retry
        ).length;
        const failed = this.results.filter(r =>
          r.outcome === 'unexpected' && // Only count truly unexpected failures
          (r.status === 'failed' || r.status === 'timedOut')
        ).length;
        const skipped = this.results.filter(r => r.status === 'skipped').length;
        // Flaky: tests that passed on retry (outcome === 'flaky')
        const flaky = this.results.filter(r => r.outcome === 'flaky').length;
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
          passRate: this.results.length > 0 ? Math.round((passed / this.results.length) * 100) : 0,
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

	    // Embed per-run snapshots when drilldown is enabled so it works from file:// without a local server.
	    let historyRunSnapshots: Record<string, RunSnapshotFile> | undefined;
	    if (this.options.enableHistoryDrilldown) {
	      try {
	        const history = this.historyCollector.getHistory();
	        const runFiles = history.runFiles || {};
	        const historyPath = path.resolve(this.outputDir, this.options.historyFile ?? 'test-history.json');
	        const historyDir = path.dirname(historyPath);

	        historyRunSnapshots = {};
	        for (const [runId, rel] of Object.entries(runFiles)) {
	          const abs = path.resolve(historyDir, rel);
	          if (!fs.existsSync(abs)) continue;
	          try {
	            const content = fs.readFileSync(abs, 'utf-8');
	            historyRunSnapshots[runId] = JSON.parse(content) as RunSnapshotFile;
	          } catch {
	            // ignore bad snapshot files
	          }
	        }
	      } catch {
	        // ignore
	      }
	    }

	    const htmlData: HtmlGeneratorData = {
	      results: this.results,
	      history: this.historyCollector.getHistory(),
	      startTime: this.startTime,
	      options: this.options,
	      comparison,
	      historyRunSnapshots,
	      failureClusters,
	      ciInfo: this.ciInfo,
	    };

    // Generate and save HTML report
    const html = generateHtml(htmlData);
    fs.writeFileSync(outputPath, html);

    // Issue #15: Better console output with command to open report
    console.log(`\n📊 Smart Report: ${outputPath}`);
    console.log(`   Serve with trace viewer: npx playwright-smart-reporter-serve "${outputPath}"`);
    console.log(`   Or open directly: open "${outputPath}"`);

    // Update history
    this.historyCollector.updateHistory(this.results);

    // Send webhook notifications if enabled - use outcome-based counting
    const failed = this.results.filter(r =>
      r.outcome === 'unexpected' &&
      (r.status === 'failed' || r.status === 'timedOut')
    ).length;
    if (failed > 0) {
      await this.slackNotifier.notify(this.results);
      await this.teamsNotifier.notify(this.results);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Create a unique test ID from test file, title, and project name
   * Issue #26: Include project name for parameterized projects
   * @param test - Playwright TestCase
   * @returns Test ID string (e.g., "[Chrome] src/tests/login.spec.ts::Login Test")
   */
  private getTestId(test: TestCase): string {
    const file = path.relative(this.outputDir, test.location.file);
    const project = test.parent?.project?.()?.name;
    const prefix = project?.trim() ? `[${project}] ` : '';
    return `${prefix}${file}::${test.title}`;
  }

  private getFlakinessIndicator(score: number): string {
    const stableThreshold = this.options.thresholds?.flakinessStable ?? 0.1;
    const unstableThreshold = this.options.thresholds?.flakinessUnstable ?? 0.3;
    if (score < stableThreshold) return '🟢 Stable';
    if (score < unstableThreshold) return '🟡 Unstable';
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
