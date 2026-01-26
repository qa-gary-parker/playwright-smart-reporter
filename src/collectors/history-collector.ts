import * as fs from 'fs';
import * as path from 'path';
import type { TestHistory, TestHistoryEntry, TestResultData, RunSummary, RunMetadata, SmartReporterOptions, RunSnapshotFile, TestResultSnapshot } from '../types';
import { renderMarkdownLite } from '../utils';

/**
 * Manages test history persistence and retrieval
 */
export class HistoryCollector {
  private history: TestHistory = { runs: [], tests: {}, summaries: [] };
  private options: Required<Omit<SmartReporterOptions, 'slackWebhook' | 'teamsWebhook' | 'baselineRunId' | 'networkLogFilter'>> &
                   Pick<SmartReporterOptions, 'slackWebhook' | 'teamsWebhook' | 'baselineRunId' | 'networkLogFilter'>;
  private outputDir: string;
  private currentRun: RunMetadata;
  private startTime: number;

  constructor(options: SmartReporterOptions, outputDir: string) {
    this.options = {
      outputFile: options.outputFile ?? 'smart-report.html',
      historyFile: options.historyFile ?? 'test-history.json',
      maxHistoryRuns: options.maxHistoryRuns ?? 10,
      performanceThreshold: options.performanceThreshold ?? 0.2,
      enableRetryAnalysis: options.enableRetryAnalysis ?? true,
      enableFailureClustering: options.enableFailureClustering ?? true,
      enableStabilityScore: options.enableStabilityScore ?? true,
      enableGalleryView: options.enableGalleryView ?? true,
      enableComparison: options.enableComparison ?? true,
      enableAIRecommendations: options.enableAIRecommendations ?? true,
      enableTrendsView: options.enableTrendsView ?? true,
      enableTraceViewer: options.enableTraceViewer ?? true,
      enableHistoryDrilldown: options.enableHistoryDrilldown ?? false,
      stabilityThreshold: options.stabilityThreshold ?? 70,
      retryFailureThreshold: options.retryFailureThreshold ?? 3,
      cspSafe: options.cspSafe ?? false,
      enableNetworkLogs: options.enableNetworkLogs ?? true,
      networkLogFilter: options.networkLogFilter ?? undefined,
      networkLogExcludeAssets: options.networkLogExcludeAssets ?? true,
      networkLogMaxEntries: options.networkLogMaxEntries ?? 50,
      slackWebhook: options.slackWebhook,
      teamsWebhook: options.teamsWebhook,
      baselineRunId: options.baselineRunId,
    };
    this.outputDir = outputDir;
    this.currentRun = {
      runId: `run-${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    this.startTime = Date.now();
  }

  /**
   * Load test history from disk
   */
  loadHistory(): void {
    const historyPath = path.resolve(this.outputDir, this.options.historyFile);
    if (fs.existsSync(historyPath)) {
      try {
        const loaded = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        // Support both old and new format
        if (loaded.tests) {
          // New format
          this.history = loaded;
        } else {
          // Old format: convert to new format
          this.history = { runs: [], tests: loaded, summaries: [] };
        }

        // Ensure summaries array exists
        if (!this.history.summaries) {
          this.history.summaries = [];
        }
        if (!this.history.runs) {
          this.history.runs = [];
        }
        if (!this.history.runFiles) {
          this.history.runFiles = {};
        }
      } catch (err) {
        console.warn('Failed to load history:', err);
        this.history = { runs: [], tests: {}, summaries: [] };
      }
    }
  }

  /**
   * Update history with test results
   */
  updateHistory(results: TestResultData[]): void {
    const timestamp = new Date().toISOString();
    const runId = this.currentRun.runId;

    for (const result of results) {
      if (!this.history.tests[result.testId]) {
        this.history.tests[result.testId] = [];
      }

      this.history.tests[result.testId].push({
        passed: result.status === 'passed',
        duration: result.duration,
        timestamp,
        ...(this.options.enableHistoryDrilldown ? { runId } : {}),
        skipped: result.status === 'skipped',
        retry: result.retry, // NEW: Track retry count
      });

      // Keep only last N runs
      if (this.history.tests[result.testId].length > this.options.maxHistoryRuns) {
        this.history.tests[result.testId] = this.history.tests[result.testId].slice(
          -this.options.maxHistoryRuns
        );
      }
    }

    // Add run summary
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const flaky = results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
    const slow = results.filter(r => r.performanceTrend?.startsWith('↑')).length;
    const total = results.length;
    const duration = Date.now() - this.startTime;

    const summary: RunSummary = {
      runId: this.currentRun.runId,
      timestamp: this.currentRun.timestamp,
      total,
      passed,
      failed,
      skipped,
      flaky,
      slow,
      duration,
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    };

    this.history.summaries!.push(summary);

    // Keep only last N summaries
    if (this.history.summaries!.length > this.options.maxHistoryRuns) {
      this.history.summaries = this.history.summaries!.slice(-this.options.maxHistoryRuns);
    }

    if (this.options.enableHistoryDrilldown) {
      this.history.runs.push({ ...this.currentRun });
      if (this.history.runs.length > this.options.maxHistoryRuns) {
        this.history.runs = this.history.runs.slice(-this.options.maxHistoryRuns);
      }

      const historyPath = path.resolve(this.outputDir, this.options.historyFile);
      const historyDir = path.dirname(historyPath);
      const runsDir = path.join(historyDir, 'history-runs');
      if (!fs.existsSync(runsDir)) {
        fs.mkdirSync(runsDir, { recursive: true });
      }

      const snapshots: Record<string, TestResultSnapshot> = {};
      for (const result of results) {
        const screenshots = result.attachments?.screenshots?.filter(s => !s.startsWith('data:')) ?? [];
        const videos = result.attachments?.videos ?? [];
        const traces = result.attachments?.traces ?? [];
        const custom = result.attachments?.custom ?? [];
        const hasAttachments = screenshots.length > 0 || videos.length > 0 || traces.length > 0 || custom.length > 0;

        const attachments = hasAttachments
          ? { screenshots, videos, traces, custom }
          : undefined;

        snapshots[result.testId] = {
          testId: result.testId,
          title: result.title,
          file: result.file,
          status: result.status,
          duration: result.duration,
          retry: result.retry,
          error: result.error,
          steps: result.steps ?? [],
          aiSuggestion: result.aiSuggestion,
          aiSuggestionHtml: result.aiSuggestion ? renderMarkdownLite(result.aiSuggestion) : undefined,
          attachments,
        };
      }

      const runFile: RunSnapshotFile = {
        runId,
        timestamp: this.currentRun.timestamp,
        tests: snapshots,
      };

      const runFileName = `${runId}.json`;
      const runFilePath = path.join(runsDir, runFileName);
      fs.writeFileSync(runFilePath, JSON.stringify(runFile, null, 2));

      if (!this.history.runFiles) this.history.runFiles = {};
      this.history.runFiles[runId] = `./history-runs/${runFileName}`;

      // Prune old run files
      const keepRunIds = new Set(this.history.runs.map(r => r.runId));
      for (const existingRunId of Object.keys(this.history.runFiles)) {
        if (keepRunIds.has(existingRunId)) continue;
        const rel = this.history.runFiles[existingRunId];
        if (rel) {
          try {
            fs.unlinkSync(path.resolve(historyDir, rel));
          } catch {
            // ignore
          }
        }
        delete this.history.runFiles[existingRunId];
      }
    }

    // Save to disk
    const historyPath = path.resolve(this.outputDir, this.options.historyFile);
    fs.writeFileSync(historyPath, JSON.stringify(this.history, null, 2));
  }

  /**
   * Get history for a specific test
   */
  getTestHistory(testId: string): TestHistoryEntry[] {
    return this.history.tests[testId] || [];
  }

  /**
   * Get full history
   */
  getHistory(): TestHistory {
    return this.history;
  }

  /**
   * Get current run metadata
   */
  getCurrentRun(): RunMetadata {
    return this.currentRun;
  }

  /**
   * Get options
   */
  getOptions(): SmartReporterOptions {
    return this.options;
  }

  /**
   * Get baseline run for comparison (if enabled)
   */
  getBaselineRun(): RunSummary | null {
    if (!this.options.enableComparison || !this.history.summaries) {
      return null;
    }

    // If specific baseline specified, find it
    if (this.options.baselineRunId) {
      return this.history.summaries.find(s => s.runId === this.options.baselineRunId) || null;
    }

    // Otherwise, use previous run
    return this.history.summaries.length > 0
      ? this.history.summaries[this.history.summaries.length - 1]
      : null;
  }
}
