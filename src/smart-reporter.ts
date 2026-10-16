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

// ============================================================================
// Imports: Types
// ============================================================================

import type {
  SmartReporterOptions,
  TestResultData,
  AttemptData,
  TestHistory,
  RunComparison,
  StepData,
  TestHistoryEntry,
  RunSummary,
  RunSnapshotFile,
  QualityGateResult,
  QuarantineFile,
} from './types';

// ============================================================================
// Imports: Collectors
// ============================================================================

import {
  HistoryCollector,
  StepCollector,
  AttachmentCollector,
  NetworkCollector,
  A11yCollector,
  CoverageCollector,
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
  forecastRun,
} from './analyzers';

// ============================================================================
// Imports: Generators & Notifiers
// ============================================================================

import { buildComparison } from './report-data/comparison';
import { buildReportData, type ReportInput } from './report-data/builder';
import { loadUiAssets, writeReport } from './report-data/writer';
import { exportJsonData } from './generators/json-exporter';
import { writeFailureBundle } from './agent/failure-bundle';
import { exportJunitXml } from './generators/junit-exporter';
import { exportCtrfReport } from './generators/ctrf-exporter';
import { exportPdfReport } from './generators/pdf-exporter';
import { SlackNotifier, TeamsNotifier, NotificationManager } from './notifiers';
import { QualityGateEvaluator, formatGateReport } from './gates';
import { QuarantineGenerator } from './quarantine';
import { generateExecutivePdf, type PdfThemeName } from './generators/executive-pdf';
import { formatDuration, stripAnsiCodes, sanitizeFilename, detectCIInfo, isFlakyTest } from './utils';
import { buildRunSummary, computeRunStats } from './utils/run-stats';
import { buildPlaywrightStyleAiPrompt } from './ai/prompt-builder';
import { readTrace, type TraceContents } from './collectors/trace-reader';
import { createRedactor, redactTestResult } from './agent/redact';
import { buildCausalTimeline, findFailureMoment } from './analyzers/causal-timeline';
import type { CIInfo } from './types';
import { LiveWriter, generateLiveReportPage } from './live';
import { resolveOwnership, type OwnerInfo } from './analyzers/ownership';
import type { ReportCoverage } from './report-data/schema';

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
  private a11yCollector = new A11yCollector();
  private coverageCollector?: CoverageCollector;

  // Analyzers
  private flakinessAnalyzer!: FlakinessAnalyzer;
  private performanceAnalyzer!: PerformanceAnalyzer;
  private retryAnalyzer!: RetryAnalyzer;
  private failureClusterer: FailureClusterer;
  private stabilityScorer!: StabilityScorer;
  private aiAnalyzer?: AIAnalyzer; // only with enableAIRecommendations: true

  // Notifiers
  private slackNotifier!: SlackNotifier;
  private teamsNotifier!: TeamsNotifier;
  private notificationManager?: NotificationManager;

  // State
  private options: SmartReporterOptions;
  private results: TestResultData[] = [];
  private resultsMap: Map<string, TestResultData> = new Map(); // Track final result per test
  private outputDir: string = '';
  private startTime: number = 0;
  private fullConfig: FullConfig | null = null;
  private runnerErrors: string[] = [];
  private ciInfo?: CIInfo;
  private liveWriter: LiveWriter;
  private liveFirstFailureSent: boolean = false;
  private ownership = new Map<string, OwnerInfo>();
  private testIds = new Map<string, string>(); // Playwright's test.id -> the id results and history are keyed on
  private allTests: TestCase[] = [];
  private redact?: (text: string) => string;

  constructor(options: SmartReporterOptions = {}) {
    this.options = options;
    if (options.redact) this.redact = createRedactor(process.env, options.redact === true ? [] : options.redact.patterns).string;

    // Initialize collectors (attachment collector will be re-initialized in onBegin with outputDir)
    // Issue #22: Pass filterPwApiSteps option to StepCollector
    this.stepCollector = new StepCollector({
      filterPwApiSteps: options.filterPwApiSteps,
      showExpectSteps: options.showExpectSteps,
    });
    this.attachmentCollector = new AttachmentCollector();

    this.networkCollector = new NetworkCollector({
      urlFilter: options.networkLogFilter,
      excludeStaticAssets: options.networkLogExcludeAssets ?? true,
      maxEntries: options.networkLogMaxEntries ?? 50,
      includeBodies: true,
    });

    // Initialize other components
    this.failureClusterer = new FailureClusterer();
    if (options.enableAIRecommendations === true) this.aiAnalyzer = new AIAnalyzer(options.ai);

    // Initialize live writer (defaults to disabled no-op)
    if (options.live?.enabled) {
      const liveOutputFile = options.live.outputFile ?? '.smart-live-results.jsonl';
      this.liveWriter = new LiveWriter({ outputFile: liveOutputFile });
    } else {
      this.liveWriter = LiveWriter.disabled();
    }

    // Initialize advanced notification manager if configured
    if (options.notifications) {
      this.notificationManager = new NotificationManager(options.notifications);
    }
  }

  /**
   * Called when the test run begins
   * Initializes collectors, analyzers, and loads test history
   * @param config - Playwright full configuration
   * @param _suite - Root test suite (unused)
   */
  onBegin(config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    // Issue #20: Support path resolution relative to current working directory
    // When relativeToCwd is true, use process.cwd() instead of config.rootDir
    this.outputDir = this.options.relativeToCwd ? process.cwd() : config.rootDir;
    this.fullConfig = config;
    this.allTests = suite.allTests();
    const legacyIds = this.assignTestIds(this.allTests);

    // Auto-detect CI environment
    this.ciInfo = detectCIInfo();

    // Resolve owners once per run, for every test file, so live notifications can route too
    try {
      this.ownership = resolveOwnership(suite.allTests().map(t => t.location.file), config.rootDir, this.options.ownership);
    } catch (err) {
      console.warn('⚠️  Ownership resolution failed:', err instanceof Error ? err.message : err);
    }

    // Initialize HistoryCollector and load history
    this.historyCollector = new HistoryCollector(this.options, this.outputDir);
    this.historyCollector.loadHistory();
    this.historyCollector.adoptLegacyIds(legacyIds);

    // Re-initialize attachment collector with output directory for CSP-safe mode
    const outputPath = path.resolve(this.outputDir, this.options.outputFile ?? 'smart-report.html');
    const outputDir = path.dirname(outputPath);
    this.attachmentCollector = new AttachmentCollector({
      cspSafe: this.options.cspSafe,
      outputDir: outputDir,
      reportName: path.basename(outputPath, '.html'),
    });
    this.coverageCollector = new CoverageCollector(this.outputDir);

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

    // Start live reporting (writes start event with total test count)
    const totalTests = suite.allTests().length;
    this.liveWriter.start(totalTests, this.ciInfo);

    // Write live report page to the main report output path
    // When tests complete, onEnd() will overwrite this with the full static report
    if (this.options.live?.enabled) {
      const reportPath = path.resolve(this.outputDir, this.options.outputFile ?? 'smart-report.html');
      const liveRelPath = path.relative(path.dirname(reportPath), this.liveWriter.getOutputPath());
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, generateLiveReportPage({
        jsonlFile: liveRelPath,
        title: this.options.branding?.title,
        theme: this.options.theme?.preset,
      }));
      console.log(`\n📡 Live report: ${reportPath}`);
      console.log(`   Serve for SSE: npx playwright-smart-reporter-serve --live "${reportPath}"`);
    }
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
    // Phase 6: Code coverage. Started before any await: Playwright does not await onTestEnd,
    // and onEnd waits for every collect() it has seen. Errors are caught inside the collector.
    void this.coverageCollector?.collect(result);

    // Collect test components
    const steps = this.stepCollector.extractSteps(result);
    // An attempt Playwright may retry keeps cspSafe screenshots in memory; settleAttemptEvidence writes them if they are kept
    const mayRetry = result.retry < test.retries && result.status !== test.expectedStatus && result.status !== 'skipped';
    const attachments = this.attachmentCollector.collectAttachments(result, mayRetry);
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
        const rawTag = a.type.startsWith('@') ? a.type : (a.description || a.type);
        const tag = rawTag.startsWith('@') ? rawTag : `@${rawTag}`;
        if (!tags.includes(tag)) tags.push(tag);
      }
    }

    // Tertiary source: extract from test title (e.g., "Login @smoke @critical"), only for Playwright before 1.42,
    // which has no test.tags. A tag starts a word, so the "@example" in "user@example.com" is not one.
    if (!Array.isArray(test.tags)) {
      for (const [, tag] of test.title.matchAll(/(?:^|\s)(@[\w-]+)/g)) {
        if (!tags.includes(tag)) tags.push(tag);
      }
    }

    // Extract suite hierarchy from titlePath (last element is test title itself)
    const titlePath = test.titlePath();
    // Filter out empty strings from titlePath (some Playwright versions include empty root)
    const filteredPath = titlePath.filter(p => p && p.length > 0);
    // Drop the project name and the test title. An unnamed project's '' is already filtered out,
    // so named and unnamed projects both get [file, ...describes].
    const suites = filteredPath.slice(test.parent?.project?.()?.name ? 1 : 0, -1);
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
      line: test.location.line,
      column: test.location.column,
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

    const ownerInfo = this.ownership.get(test.location.file);
    if (ownerInfo) {
      testData.owners = ownerInfo.owners;
      testData.ownerSource = ownerInfo.source;
    }

    // Add error if failed (strip ANSI codes for clean display)
    if (result.status === 'failed' || result.status === 'timedOut') {
      const error = result.errors[0];
      if (error) {
        const rawError = error.stack || error.message || 'Unknown error';
        testData.error = stripAnsiCodes(rawError);
        if (error.snippet) testData.errorSnippet = stripAnsiCodes(error.snippet);
        if (error.location) {
          testData.errorLocation = { ...error.location, file: path.relative(this.outputDir, error.location.file) };
        }
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
    const wantTimeline = (result.status === 'failed' || result.status === 'timedOut') && this.options.enableCausalTimeline !== false;
    let trace: TraceContents | undefined;
    if (traceAttachment?.path) {
      testData.tracePath = traceAttachment.path;
      // One trace read feeds both the network log and the causal timeline
      if (this.options.enableNetworkLogs !== false || wantTimeline) {
        try {
          trace = readTrace(traceAttachment.path, { timeline: wantTimeline });
        } catch (err) {
          console.warn(`Failed to parse trace file: ${traceAttachment.path}`, err);
        }
      }
      // Extract network logs from trace (enabled by default when traces exist)
      if (trace && this.options.enableNetworkLogs !== false) {
        try {
          const networkLogs = this.networkCollector.collectFromContents(trace);
          if (networkLogs.entries.length > 0) {
            testData.networkLogs = networkLogs;
          }
        } catch {
          // Network log extraction is optional, don't fail on errors
        }
      }
    }

    // Phase 10: Accessibility
    try {
      const a11y = this.a11yCollector.collect(result);
      if (a11y) testData.a11y = a11y;
    } catch (err) {
      console.warn(`Smart Reporter: could not read accessibility results for "${test.title}":`, err);
    }

    if (wantTimeline) {
      try {
        const attemptStart = result.startTime.getTime();
        testData.timeline = buildCausalTimeline({
          attemptStart,
          attemptDuration: result.duration,
          steps,
          failureAt: findFailureMoment(result.steps, attemptStart),
          trace,
          history,
        });
      } catch (err) {
        console.warn(`Failed to build causal timeline for "${test.title}":`, err);
      }
    }

    // Build Playwright-style prompt for AI analysis and Copy AI prompt (no binaries)
    if (this.fullConfig && (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted')) {
      try {
        testData.aiPrompt = buildPlaywrightStyleAiPrompt({
          config: this.fullConfig,
          test,
          result,
          firstAnomaly: testData.timeline?.firstAnomaly,
        });
      } catch (err) {
        // Prompt building should never fail the reporter
        console.warn(`Failed to build AI prompt for "${test.title}":`, err);
      }
    }

    // Before attempts, the live file, history and every export copy these fields
    if (this.redact) redactTestResult(testData, this.redact);

    // Run all analyzers (flakiness, performance, retries, stability)
    this.flakinessAnalyzer.analyze(testData, history);
    this.performanceAnalyzer.analyze(testData, history);
    if (this.options.enableRetryAnalysis !== false) this.retryAnalyzer.analyze(testData, history);
    if (this.options.enableStabilityScore !== false) this.stabilityScorer.scoreTest(testData);

    // Store result - only keep the final attempt for each test (Issue #17 fix)
    // This prevents double-counting when tests retry
    const existingResult = this.resultsMap.get(testId);
    const attempt: AttemptData = { retry: result.retry, status: result.status, duration: result.duration, error: testData.error, steps };
    testData.attempts = [...(existingResult?.attempts ?? []), attempt].sort((a, b) => a.retry - b.retry);
    if (!existingResult || result.retry > existingResult.retry) {
      // This is a newer attempt - replace the previous one
      if (existingResult) keepAttemptEvidence(existingResult, testData.attempts.find((a) => a.retry === existingResult.retry)!);
      this.resultsMap.set(testId, testData);
    } else {
      keepAttemptEvidence(testData, attempt);
      existingResult.attempts = testData.attempts;
    }
    if (!mayRetry) this.settleAttemptEvidence(this.resultsMap.get(testId)!);

    // Write live result for real-time dashboard
    this.liveWriter.writeTestResult({
      testId,
      title: test.title,
      file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
      error: testData.error,
      outcome,
    });

    // Live: send notification on first failure
    if (
      this.options.live?.notifyOnFirstFailure &&
      !this.liveFirstFailureSent &&
      (result.status === 'failed' || result.status === 'timedOut')
    ) {
      this.liveFirstFailureSent = true;
      const msg = `First failure detected: "${test.title}" in ${file}`;
      if (this.options.slackWebhook) {
        this.slackNotifier.sendMessage(msg).catch(() => {});
      }
      if (this.options.teamsWebhook) {
        this.teamsNotifier.sendMessage(msg).catch(() => {});
      }
      if (this.notificationManager) {
        const failureResult: TestResultData[] = [testData];
        this.notificationManager.notify(failureResult, this.startTime).catch(() => {});
      }
    }
  }

  /**
   * Called when the test run completes
   * Performs final analysis, generates HTML report, updates history, and sends notifications
   * @param result - Full test run result
   */
  async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
    // Tests that never started (a failed setup project, --max-failures, Ctrl-C) get no onTestEnd, and the
    // global timeout skips it for the test it cuts off. Playwright reports them as skipped, so add them.
    for (const test of this.allTests) {
      if (this.resultsMap.has(this.getTestId(test))) continue;
      await this.onTestEnd(test, test.results[test.results.length - 1] ?? {
        retry: 0, parallelIndex: -1, workerIndex: -1, duration: 0, startTime: new Date(this.startTime), status: 'skipped',
        errors: [], attachments: [], annotations: [], steps: [], stdout: [], stderr: [],
      });
    }

    // Convert resultsMap to array - this ensures we only have the final attempt for each test
    // This fixes Issue #17: retries no longer double-counted
    this.results = Array.from(this.resultsMap.values());

    // A run that stopped before a retry leaves attempts unsettled
    for (const r of this.results) this.settleAttemptEvidence(r);

    // Durations below are Date.now() - startTime. merge-reports calls onBegin at merge time,
    // so start the clock from the run's own duration instead. Playwright's duration is fractional;
    // round it so the history run id stays a whole number.
    if (result.duration > 0) this.startTime = Date.now() - Math.round(result.duration);
    this.historyCollector.setRunStart(this.startTime);

    // Signal live reporting that the run is complete
    // Note: JSONL file is intentionally NOT cleaned up here — the SSE handler
    // may still need to push the 'complete' event to connected dashboards.
    // The file is truncated automatically on the next run via LiveWriter.start().
    this.liveWriter.complete(Date.now() - this.startTime);

    // Get failure clusters
    const failureClusters = this.options.enableFailureClustering === false ? [] : this.failureClusterer.clusterFailures(this.results);

    // Run AI analysis on failures and clusters if enabled
    const options = this.historyCollector.getOptions();
    let aiSuiteHealthSummary: string | undefined;
    // An AI outage must never fail the run (Phase 0.5)
    try {
      if (this.aiAnalyzer) {
        await this.aiAnalyzer.analyzeFailed(this.results);
        if (failureClusters.length > 0) {
          await this.aiAnalyzer.analyzeClusters(failureClusters);
        }
        // AI Suite Health Summary (opt-out with enableAISuiteHealth: false)
        if (options.enableAISuiteHealth !== false && this.aiAnalyzer.isAvailable()) {
          const { total, passed, failed, skipped, passRate } = computeRunStats(this.results);
          // Flaky here means flaky by history or on retry this run, which is what the AI should look at.
          const flakyCount = this.results.filter(r => isFlakyTest(r)).length;
          const slowCount = this.results.filter(r => r.performanceTrend?.startsWith('↑')).length;
          const needsRetry = this.results.filter(r => r.retryInfo?.needsAttention).length;
          const avgStability = this.results.reduce((sum, r) => sum + (r.stabilityScore?.overall ?? 100), 0) / Math.max(total, 1);
          const suiteStats = {
            total, passed, failed, skipped,
            flaky: flakyCount, slow: slowCount, needsRetry,
            passRate, averageStability: Math.round(avgStability),
          };
          const historySummaries = this.historyCollector.getHistory().summaries ?? [];
          aiSuiteHealthSummary = await this.aiAnalyzer.analyzeSuiteHealth(
            this.results, suiteStats, failureClusters, historySummaries,
          );
        }
      }
    } catch (err) {
      console.warn('⚠️  AI analysis failed and was skipped:', err);
    }

    // Get comparison data if enabled
    let comparison: RunComparison | undefined;
    if (options.enableComparison !== false) {
      const baselineRun = this.historyCollector.getBaselineRun();
      if (baselineRun) {
        const currentSummary = buildRunSummary(this.results, { ...this.historyCollector.getCurrentRun(), duration: Date.now() - this.startTime });

        // Build baseline tests map from history
        const baselineTests = new Map<string, TestResultData>();
        const history = this.historyCollector.getHistory();

        // Reconstruct baseline test results: each test's last entry, or with baselineRunId its entry for that run
        // (history saved before entries carried a run id cannot tell, so it keeps the last entry).
        const pinned = !!options.baselineRunId && Object.values(history.tests).some(entries => entries.some(e => e.runId === baselineRun.runId));
        for (const [testId, entries] of Object.entries(history.tests)) {
          const entry = pinned ? entries.filter(e => e.runId === baselineRun.runId).pop() : entries[entries.length - 1];
          const matchingTest = this.results.find(r => r.testId === testId);

          if (entry && matchingTest) {
            baselineTests.set(testId, {
              ...matchingTest,
              status: entry.skipped ? 'skipped' : entry.passed ? 'passed' : 'failed',
              // History saved the baseline's verdict; the outcome spread above is this run's.
              outcome: entry.skipped ? 'skipped' : entry.passed ? 'expected' : 'unexpected',
              duration: entry.duration,
            });
          }
        }

        comparison = buildComparison(
          this.results,
          currentSummary,
          baselineRun,
          baselineTests,
          this.options.thresholds?.performanceRegression ?? this.options.performanceThreshold ?? 0.2,
        );
      }
    }

    const outputPath = path.resolve(this.outputDir, this.options.outputFile ?? 'smart-report.html');

    // Copy trace files to traces subdirectory for browser download BEFORE HTML generation
    const tracesDir = path.join(path.dirname(outputPath), 'traces');
    const copyTraces = (traces: string[], prefix: string) => {
      for (let i = 0; i < traces.length; i++) {
        const tracePath = traces[i];
        if (!fs.existsSync(tracePath)) continue;
        const traceFileName = `${prefix}-trace-${i}.zip`;
        try {
          fs.mkdirSync(tracesDir, { recursive: true });
          fs.copyFileSync(tracePath, path.join(tracesDir, traceFileName));
          // Update the path to relative for HTML
          traces[i] = `./traces/${traceFileName}`;
        } catch (err) {
          console.warn(`⚠️  Could not copy trace ${tracePath}:`, err);
        }
      }
    };
    for (const result of this.results) {
      // Sanitize testId to prevent path separator issues
      const safeTestId = sanitizeFilename(result.testId);
      copyTraces(result.attachments?.traces ?? [], safeTestId);
      for (const attempt of result.attempts ?? []) {
        copyTraces(attempt.attachments?.traces ?? [], `${safeTestId}-attempt-${attempt.retry + 1}`);
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

    const exportDir = path.dirname(outputPath);

    // Phase 6: Code coverage - merged before gates so minCoverage can read it
    let coverage: ReportCoverage | undefined;
    try {
      coverage = await this.coverageCollector?.finish();
    } catch (err) {
      console.warn('⚠️  Coverage merge failed:', err);
    }

    // Quality gates - evaluate BEFORE HTML generation so results embed in report
    let qualityGateResult: QualityGateResult | undefined;
    if (this.options.qualityGates) {
      try {
        const evaluator = new QualityGateEvaluator();
        qualityGateResult = evaluator.evaluate(this.options.qualityGates, this.results, comparison, coverage?.summary);
      } catch (err) {
        console.warn('⚠️  Quality gate evaluation failed:', err);
      }
    }

    // Quarantine - evaluate BEFORE HTML generation so badges/cards embed in report
    let quarantineResult: QuarantineFile | null = null;
    let quarantinedTestIds: Set<string> | undefined;
    if (this.options.quarantine?.enabled) {
      try {
        const generator = new QuarantineGenerator(this.options.quarantine);
        quarantineResult = generator.generate(this.results, exportDir);
        if (quarantineResult) {
          quarantinedTestIds = new Set(quarantineResult.entries.map(e => e.testId));
        }
      } catch (err) {
        console.warn('⚠️  Quarantine generation failed:', err);
      }
    }

    const reportInput: ReportInput = {
      results: this.results,
      runId: this.historyCollector.getCurrentRun().runId,
      history: this.historyCollector.getHistory(),
      startTime: this.startTime,
      options: this.options,
      comparison,
      historyRunSnapshots,
      failureClusters,
      ciInfo: this.ciInfo,
      outputBasename: path.basename(outputPath, '.html'),
      liveFile: this.options.live?.enabled ? path.relative(path.dirname(outputPath), path.resolve(this.liveWriter.getOutputPath())).split(path.sep).join('/') : undefined,
      qualityGateResult,
      quarantinedTestIds,
      quarantineEntries: quarantineResult?.entries,
      quarantineThreshold: this.options.quarantine?.threshold,
      aiSuiteHealthSummary,
      coverage,
    };

    const reportData = buildReportData(reportInput);
    // A failed write must not skip history, exports, notifications, or gates below.
    let reportWritten = false;
    try {
      const written = await writeReport(reportData, {
        outputPath,
        assets: loadUiAssets(),
        cspSafe: this.options.cspSafe,
        assetMode: this.options.assetMode,
      });
      const dataMb = (written.dataBytes / (1024 * 1024)).toFixed(1);
      console.log(`\n   Report data: ${dataMb} MB, ${written.mode === 'inline' ? 'inline in the HTML' : `in ${path.basename(written.files.find((f) => f.endsWith('-data.js')) ?? '')}`}`);
      reportWritten = true;
    } catch (err) {
      console.error('❌ Smart Reporter could not write the HTML report:', err);
    }

    // Issue #15: Better console output with command to open report
    if (reportWritten) {
      console.log(`\n📊 Smart Report: ${outputPath}`);
      console.log(`   Serve with trace viewer: npx playwright-smart-reporter-serve "${outputPath}"`);
      console.log(`   Or open directly: open "${outputPath}"`);
    }
    if (coverage) {
      const { lines } = coverage.summary;
      console.log(`   Coverage: ${lines.pct}% of lines (${lines.covered}/${lines.total}) across ${coverage.files.length} file(s)`);
    }


    if (this.options.exportJson) {
      try {
        const jsonPath = exportJsonData(
          this.results,
          this.historyCollector.getHistory(),
          this.startTime,
          this.options,
          comparison,
          failureClusters,
          exportDir,
          reportInput.outputBasename,
          qualityGateResult,
          this.outputDir,
          coverage,
        );
        console.log(`   JSON data: ${jsonPath}`);
      } catch (err) {
        console.warn('⚠️  JSON export failed:', err);
      }
    }

    if (this.options.exportFailures) {
      try {
        const failuresPath = writeFailureBundle(reportData, { outputDir: exportDir, rootDir: this.outputDir });
        console.log(`   Failure bundle: ${failuresPath}`);
      } catch (err) {
        console.warn('⚠️  Failure bundle export failed:', err);
      }
    }

    if (this.options.exportJunit) {
      try {
        const junitPath = exportJunitXml(this.results, this.options, exportDir, reportInput.outputBasename);
        console.log(`   JUnit XML: ${junitPath}`);
      } catch (err) {
        console.warn('⚠️  JUnit export failed:', err);
      }
    }

    if (this.options.exportCtrf) {
      try {
        const ctrfPath = exportCtrfReport(this.results, this.startTime, this.options, exportDir, reportInput.outputBasename, {
          playwrightVersion: this.fullConfig?.version,
          ciInfo: this.ciInfo,
        });
        console.log(`   CTRF JSON: ${ctrfPath}`);
      } catch (err) {
        console.warn('⚠️  CTRF export failed:', err);
      }
    }

    if (this.options.exportPdf) {
      try {
        if (this.options.exportPdfFull) {
          // Legacy: full HTML-to-PDF dump via playwright-core
          const pdfPath = await exportPdfReport(outputPath, this.options, exportDir);
          if (pdfPath) {
            console.log(`   PDF report (full): ${pdfPath}`);
          }
        } else {
          // Default: executive summary PDFs via pdfkit (3 themed variants)
          const pdfData = {
            results: this.results,
            history: this.historyCollector.getHistory(),
            startTime: this.startTime,
            ciInfo: this.ciInfo,
            failureClusters,
            projectName: this.options.projectName,
            qualityGateResult,
            quarantineEntries: quarantineResult?.entries,
            quarantineThreshold: this.options.quarantine?.threshold,
            branding: this.options.branding,
            pdfFont: this.options.pdfFont,
          };
          const pdfThemes: PdfThemeName[] = ['corporate', 'dark', 'minimal'];
          for (const pdfTheme of pdfThemes) {
            let pdfPath: string;
            try {
              pdfPath = generateExecutivePdf(pdfData, exportDir, reportInput.outputBasename, pdfTheme);
            } catch (err) {
              // a font can pass the register-time check but still fail during subsetting
              if (!pdfData.pdfFont) throw err;
              console.warn(`⚠️  PDF generation failed with the custom font (${pdfData.pdfFont.regular}); retrying without it:`, err instanceof Error ? err.message : err);
              pdfData.pdfFont = undefined;
              pdfPath = generateExecutivePdf(pdfData, exportDir, reportInput.outputBasename, pdfTheme);
            }
            if (pdfTheme === 'corporate') {
              console.log(`   PDF executive summary: ${pdfPath}`);
            }
          }
        }
      } catch (err) {
        console.warn('⚠️  PDF export failed:', err);
      }
    } else if (this.options.exportPdfFull) {
      console.warn('⚠️  exportPdfFull requires exportPdf: true — no PDF was generated');
    }

    // Forecast before updateHistory: each result.history is the live history array it appends to
    let forecastRisks: Record<string, number> | undefined;
    try {
      forecastRisks = forecastRun(this.results, this.options.forecast)?.risks;
    } catch (err) {
      console.warn('⚠️  Flake forecast failed:', err);
    }

    // A failed history write must not skip notifications or quality gates below.
    try {
      this.historyCollector.updateHistory(this.results, forecastRisks);
    } catch (err) {
      console.error('⚠️  Could not save test history:', err instanceof Error ? err.message : err);
    }

    // Send webhook notifications if enabled
    const { failed } = computeRunStats(this.results);

    // Advanced notification manager takes precedence
    if (this.notificationManager) {
      await this.notificationManager.notify(this.results, this.startTime, comparison);
    } else {
      // Legacy webhook notification path
      if (failed > 0) {
        await this.slackNotifier.notify(this.results);
        await this.teamsNotifier.notify(this.results);
      }
    }

    // Quality gates - log results and fail the run. Playwright exits with a code derived from the
    // run status and ignores process.exitCode, so a breached gate must change the status.
    let status: FullResult['status'] | undefined;
    if (qualityGateResult) {
      console.log(formatGateReport(qualityGateResult));
      if (!qualityGateResult.passed) {
        process.exitCode = 1;
        status = 'failed';
      }
    }

    // Quarantine - log results (file already written above)
    if (quarantineResult) {
      const qPath = new QuarantineGenerator(this.options.quarantine!).getOutputPath(exportDir);
      console.log(`   Quarantine: ${quarantineResult.entries.length} test(s) quarantined -> ${qPath}`);
    } else if (this.options.quarantine?.enabled) {
      console.log('   Quarantine: no tests exceed flakiness threshold');
    }

    return status ? { status } : undefined;
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  // Earlier attempts keep their evidence only when a later attempt passed. A test that failed
  // every time has the same evidence on its final attempt. Safe to call more than once.
  private settleAttemptEvidence(r: TestResultData): void {
    for (const attempt of r.attempts ?? []) {
      if (r.outcome !== 'flaky') {
        delete attempt.attachments;
        delete attempt.tracePath;
      } else if (attempt.attachments) {
        this.attachmentCollector.saveInlineScreenshots(attempt.attachments.screenshots);
      }
    }
    if (r.attachments) {
      this.attachmentCollector.saveInlineScreenshots(r.attachments.screenshots);
      if (r.screenshot) r.screenshot = r.attachments.screenshots[0];
    }
  }

  /**
   * Create a unique test ID from test file, title, and project name
   * Issue #26: Include project name for parameterized projects
   * @param test - Playwright TestCase
   * @returns Test ID string (e.g., "[Chrome] src/tests/login.spec.ts::Login › signs in")
   */
  private getTestId(test: TestCase): string {
    return this.testIds.get(test.id) ?? this.idFor(test, [...describePath(test), test.title]);
  }

  private idFor(test: TestCase, titles: string[]): string {
    const file = path.relative(this.outputDir, test.location.file)
      .replace(/\\/g, '/')       // Normalize to forward slashes
      .replace(/^\.\//, '');     // Strip leading ./
    const project = test.parent?.project?.()?.name;
    const prefix = project?.trim() ? `[${project}] ` : '';
    return `${prefix}${file}::${titles.join(' › ')}`;
  }

  // The id includes the describe path, so it does not depend on which other tests are in the run
  // (a shard, --grep, --project). --repeat-each copies get a suffix, so each copy is its own result and
  // attempts stay retries. Returns each id -> the file::title id 2.x saved history under.
  private assignTestIds(tests: TestCase[]): Map<string, string> {
    const legacyIds = new Map<string, string>();
    for (const test of tests) {
      const suffix = test.repeatEachIndex > 0 ? ` (repeat ${test.repeatEachIndex})` : '';
      const id = this.idFor(test, [...describePath(test), test.title]) + suffix;
      this.testIds.set(test.id, id);
      legacyIds.set(id, this.idFor(test, [test.title]) + suffix);
    }
    return legacyIds;
  }

}

// A retried attempt keeps its screenshots, videos and traces; the rest of its result is dropped.
function keepAttemptEvidence(from: TestResultData, attempt: AttemptData): void {
  const { screenshots = [], videos = [], traces = [] } = from.attachments ?? {};
  if (screenshots.length + videos.length + traces.length > 0) attempt.attachments = { screenshots, videos, traces };
  if (from.tracePath) attempt.tracePath = from.tracePath;
}

// The describe blocks around a test: its suites below root > project > file.
function describePath(test: TestCase): string[] {
  const titles: string[] = [];
  for (let s: Suite | undefined = test.parent; s?.parent?.parent?.parent; s = s.parent) {
    if (s.title) titles.unshift(s.title);
  }
  return titles;
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

export { withAccessibility } from './accessibility/a11y-config';

export default SmartReporter;
