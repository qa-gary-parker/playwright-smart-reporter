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
  TestHistory,
  RunComparison,
  StepData,
  TestHistoryEntry,
  RunSummary,
  RunSnapshotFile,
  LicenseInfo,
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

import { generateHtml, type HtmlGeneratorData, type GeneratedReport } from './generators/html-generator';
import { buildComparison } from './generators/comparison-generator';
import { exportJsonData } from './generators/json-exporter';
import { exportJunitXml } from './generators/junit-exporter';
import { exportPdfReport } from './generators/pdf-exporter';
import { SlackNotifier, TeamsNotifier, NotificationManager } from './notifiers';
import { CloudUploader } from './cloud/uploader';
import { LicenseValidator } from './license';
import { QualityGateEvaluator, formatGateReport } from './gates';
import { QuarantineGenerator } from './quarantine';
import { generateExecutivePdf, type PdfThemeName } from './generators/executive-pdf';
import { formatDuration, stripAnsiCodes, sanitizeFilename, detectCIInfo } from './utils';
import { buildPlaywrightStyleAiPrompt } from './ai/prompt-builder';
import type { CIInfo } from './types';
import { LiveWriter, generateLiveDashboard } from './live';

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

  // Cloud
  private cloudUploader: CloudUploader;

  // License
  private license: LicenseInfo;
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

  constructor(options: SmartReporterOptions = {}) {
    this.options = options;

    // Validate license
    const validator = new LicenseValidator();
    this.license = validator.validate(options.licenseKey);
    if (this.license.error) {
      console.warn(`⚠️  License: ${this.license.error}`);
    }

    // Gate theme behind Pro tier
    if (options.theme && !LicenseValidator.hasFeature(this.license, 'pro')) {
      console.warn('Smart Reporter: Custom themes require a Pro license. Using defaults.');
      this.options = { ...this.options, theme: undefined };
    }

    // Gate branding behind Pro tier
    if (options.branding && !LicenseValidator.hasFeature(this.license, 'pro')) {
      console.warn('Smart Reporter: Custom branding requires a Pro license. Using defaults.');
      this.options = { ...this.options, branding: undefined };
    }

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
    this.aiAnalyzer = new AIAnalyzer({
      licenseKey: options.licenseKey || process.env.SMART_REPORTER_LICENSE_KEY,
      tier: this.license.tier,
    });
    this.cloudUploader = new CloudUploader(options);

    // Initialize live writer (defaults to disabled no-op)
    if (options.live?.enabled) {
      const liveOutputFile = options.live.outputFile ?? '.smart-live-results.jsonl';
      this.liveWriter = new LiveWriter({ outputFile: liveOutputFile });
    } else {
      this.liveWriter = LiveWriter.disabled();
    }

    // Initialize advanced notification manager if configured (Pro feature)
    if (options.notifications && LicenseValidator.hasFeature(this.license, 'pro')) {
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

    // Start live reporting (writes start event with total test count)
    const totalTests = suite.allTests().length;
    this.liveWriter.start(totalTests, this.ciInfo);

    // Generate live dashboard HTML alongside the live results file
    if (this.options.live?.enabled && this.options.live?.dashboard !== false) {
      const liveOutputFile = this.options.live?.outputFile ?? '.smart-live-results.jsonl';
      const dashboardPath = path.resolve(this.outputDir, 'smart-live.html');
      const dashboardHtml = generateLiveDashboard({ jsonlFile: liveOutputFile });
      fs.writeFileSync(dashboardPath, dashboardHtml);
      console.log(`\n📡 Live dashboard: ${dashboardPath}`);
      console.log(`   Serve for SSE: npx playwright-smart-reporter-serve --live "${dashboardPath}"`);
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

    // Run all analyzers (flakiness, performance, retries, stability)
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

    // Write live result for real-time dashboard
    this.liveWriter.writeTestResult({
      testId,
      title: test.title,
      file,
      status: result.status,
      duration: result.duration,
      retry: result.retry,
      error: testData.error,
    });

    // Live: send notification on first failure (Starter+ tier)
    if (
      this.options.live?.notifyOnFirstFailure &&
      !this.liveFirstFailureSent &&
      (result.status === 'failed' || result.status === 'timedOut') &&
      (LicenseValidator.hasFeature(this.license, 'starter') || LicenseValidator.hasFeature(this.license, 'pro'))
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
  async onEnd(result: FullResult): Promise<void> {
    // Convert resultsMap to array - this ensures we only have the final attempt for each test
    // This fixes Issue #17: retries no longer double-counted
    this.results = Array.from(this.resultsMap.values());

    // Signal live reporting that the run is complete
    this.liveWriter.complete(Date.now() - this.startTime);

    // Get failure clusters
    const failureClusters = this.failureClusterer.clusterFailures(this.results);

    // Run AI analysis on failures and clusters if enabled (Pro feature)
    const options = this.historyCollector.getOptions();
    const hasProForAI = LicenseValidator.hasFeature(this.license, 'pro');
    if (hasProForAI && options.enableAIRecommendations !== false) {
      await this.aiAnalyzer.analyzeFailed(this.results);
      if (failureClusters.length > 0) {
        await this.aiAnalyzer.analyzeClusters(failureClusters);
      }
    } else if (!hasProForAI && options.enableAIRecommendations !== false) {
      const failedCount = this.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
      if (failedCount > 0) {
        console.log('\n   AI analysis requires Pro — see stagewright.dev/pricing');
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

    // Premium feature flags (needed before HTML generation)
    const hasPro = LicenseValidator.hasFeature(this.license, 'pro');
    const exportDir = path.dirname(outputPath);

    // Quality gates (Pro feature) - evaluate BEFORE HTML generation so results embed in report
    let qualityGateResult: QualityGateResult | undefined;
    if (this.options.qualityGates && hasPro) {
      try {
        const evaluator = new QualityGateEvaluator();
        qualityGateResult = evaluator.evaluate(this.options.qualityGates, this.results, comparison);
      } catch (err) {
        console.warn('⚠️  Quality gate evaluation failed:', err);
      }
    }

    // Quarantine (Pro feature) - evaluate BEFORE HTML generation so badges/cards embed in report
    let quarantineResult: QuarantineFile | null = null;
    let quarantinedTestIds: Set<string> | undefined;
    if (this.options.quarantine?.enabled && hasPro) {
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

	    const htmlData: HtmlGeneratorData = {
	      results: this.results,
	      history: this.historyCollector.getHistory(),
	      startTime: this.startTime,
	      options: this.options,
	      comparison,
	      historyRunSnapshots,
	      failureClusters,
	      ciInfo: this.ciInfo,
	      licenseTier: this.license.tier,
	      outputBasename: path.basename(outputPath, '.html'),
	      qualityGateResult,
	      quarantinedTestIds,
	      quarantineEntries: quarantineResult?.entries,
	      quarantineThreshold: this.options.quarantine?.threshold,
	    };

    // Generate and save HTML report (with optional companion CSS/JS for CSP-safe mode)
    const report = generateHtml(htmlData);
    fs.writeFileSync(outputPath, report.html);
    if (report.css || report.js) {
      const outputDir = path.dirname(outputPath);
      const basename = path.basename(outputPath, '.html');
      if (report.css) {
        fs.writeFileSync(path.join(outputDir, `${basename}.css`), report.css);
      }
      if (report.js) {
        fs.writeFileSync(path.join(outputDir, `${basename}.js`), report.js);
      }
    }

    // Issue #15: Better console output with command to open report
    console.log(`\n📊 Smart Report: ${outputPath}`);
    console.log(`   Serve with trace viewer: npx playwright-smart-reporter-serve "${outputPath}"`);
    console.log(`   Or open directly: open "${outputPath}"`);


    if (this.options.exportJson && hasPro) {
      try {
        const jsonPath = exportJsonData(
          this.results,
          this.historyCollector.getHistory(),
          this.startTime,
          this.options,
          comparison,
          failureClusters,
          exportDir,
          htmlData.outputBasename,
        );
        console.log(`   JSON data: ${jsonPath}`);
      } catch (err) {
        console.warn('⚠️  JSON export failed:', err);
      }
    } else if (this.options.exportJson && !hasPro) {
      console.log('   JSON export requires a Pro license — see stagewright.dev/pricing');
    }

    if (this.options.exportJunit && hasPro) {
      try {
        const junitPath = exportJunitXml(this.results, this.options, exportDir, htmlData.outputBasename);
        console.log(`   JUnit XML: ${junitPath}`);
      } catch (err) {
        console.warn('⚠️  JUnit export failed:', err);
      }
    } else if (this.options.exportJunit && !hasPro) {
      console.log('   JUnit export requires a Pro license — see stagewright.dev/pricing');
    }

    if (this.options.exportPdf && hasPro) {
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
          };
          const pdfThemes: PdfThemeName[] = ['corporate', 'dark', 'minimal'];
          for (const pdfTheme of pdfThemes) {
            const pdfPath = generateExecutivePdf(pdfData, exportDir, htmlData.outputBasename, pdfTheme);
            if (pdfTheme === 'corporate') {
              console.log(`   PDF executive summary: ${pdfPath}`);
            }
          }
        }
      } catch (err) {
        console.warn('⚠️  PDF export failed:', err);
      }
    } else if (this.options.exportPdf && !hasPro) {
      console.log('   PDF export requires a Pro license — see stagewright.dev/pricing');
    }

    // Update history
    this.historyCollector.updateHistory(this.results);

    // Send webhook notifications if enabled - use outcome-based counting
    const failed = this.results.filter(r =>
      r.outcome === 'unexpected' &&
      (r.status === 'failed' || r.status === 'timedOut')
    ).length;

    // Advanced notification manager (Pro feature) takes precedence
    if (this.notificationManager) {
      await this.notificationManager.notify(this.results, this.startTime, comparison);
    } else {
      // Legacy notification path (free tier)
      if (failed > 0) {
        await this.slackNotifier.notify(this.results);
        await this.teamsNotifier.notify(this.results);
      }
    }

    // Quality gates (Pro feature) - log results and set exitCode
    if (qualityGateResult) {
      console.log(formatGateReport(qualityGateResult));
      if (!qualityGateResult.passed) {
        process.exitCode = 1;
      }
    } else if (this.options.qualityGates && !hasPro) {
      console.log('   Quality gates require a Pro license — see stagewright.dev/pricing');
    }

    // Quarantine (Pro feature) - log results (file already written above)
    if (quarantineResult) {
      const qPath = new QuarantineGenerator(this.options.quarantine!).getOutputPath(exportDir);
      console.log(`   Quarantine: ${quarantineResult.entries.length} test(s) quarantined -> ${qPath}`);
    } else if (this.options.quarantine?.enabled && hasPro) {
      console.log('   Quarantine: no tests exceed flakiness threshold');
    } else if (this.options.quarantine?.enabled && !hasPro) {
      console.log('   Quarantine requires a Pro license — see stagewright.dev/pricing');
    }

    // Upload to StageWright Cloud if enabled
    if (this.cloudUploader.isEnabled()) {
      const uploadResult = await this.cloudUploader.upload(this.results, this.startTime);
      if (uploadResult.success) {
        console.log(`\n☁️  Cloud Report: ${uploadResult.url}`);
      } else {
        console.warn(`\n⚠️  Cloud upload failed: ${uploadResult.error}`);
      }
    }

    // Gentle upsell for community tier
    if (this.license.tier === 'community') {
      console.log(`\n   Pro features available — see stagewright.dev/pricing`);
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
    const file = path.relative(this.outputDir, test.location.file)
      .replace(/\\/g, '/')       // Normalize to forward slashes
      .replace(/^\.\//, '');     // Strip leading ./
    const project = test.parent?.project?.()?.name;
    const prefix = project?.trim() ? `[${project}] ` : '';
    return `${prefix}${file}::${test.title}`;
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
