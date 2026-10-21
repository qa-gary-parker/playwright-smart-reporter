import * as fs from 'fs';
import * as path from 'path';
import type { TestHistory, TestHistoryEntry, TestResultData, RunSummary, RunMetadata, SmartReporterOptions, RunSnapshotFile, TestResultSnapshot, HistoryRunFile } from '../types';
import { detectCIInfo, isPassedTest, isSkippedTest, renderMarkdownLite } from '../utils';
import { sanitizeFilename } from '../utils/sanitizers';
import { buildRunSummary, retryWasteOf } from '../utils/run-stats';
import { readHistoryFile, readRunFiles, rebuildHistory, runsDirOf } from '../utils/history-merge';
import { stepDurationsOf } from '../analyzers/causal-timeline';

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/**
 * Manages test history persistence and retrieval
 */
export class HistoryCollector {
  private history: TestHistory = { runs: [], tests: {}, summaries: [] };
  private options: Required<Omit<SmartReporterOptions, 'slackWebhook' | 'teamsWebhook' | 'baselineRunId' | 'networkLogFilter' | 'projectName' | 'thresholds' | 'maxEmbeddedSize' | 'runId' | 'exportJson' | 'exportPdf' | 'exportJunit' | 'exportPdfFull' | 'pdfFont' | 'theme' | 'notifications' | 'branding' | 'qualityGates' | 'quarantine' | 'live' | 'assetMode' | 'ai' | 'forecast' | 'ownership' | 'accessibility' | 'enableCausalTimeline' | 'exportFailures' | 'exportCtrf' | 'redact' | 'baseline' | 'ciCostPerMinute' | 'exportMetrics' | 'suspects'>> &
                   Pick<SmartReporterOptions, 'slackWebhook' | 'teamsWebhook' | 'baselineRunId' | 'networkLogFilter' | 'projectName' | 'thresholds' | 'maxEmbeddedSize' | 'runId' | 'exportJson' | 'exportPdf' | 'exportJunit' | 'exportPdfFull' | 'pdfFont' | 'theme' | 'notifications' | 'branding' | 'qualityGates' | 'quarantine' | 'live' | 'assetMode' | 'ai' | 'forecast' | 'ownership' | 'accessibility' | 'enableCausalTimeline' | 'exportFailures' | 'exportCtrf' | 'redact' | 'baseline' | 'ciCostPerMinute' | 'exportMetrics' | 'suspects'>;
  private outputDir: string;
  private currentRun!: RunMetadata;
  private startTime!: number;
  private legacyIds = new Map<string, string>();
  private baselineBranch?: string;
  private filterHistory: boolean;

  constructor(options: SmartReporterOptions, outputDir: string, private shard: { current: number; total: number } | null = null) {
    // Issue #21: Support {project} placeholder in historyFile path
    let historyFile = options.historyFile ?? 'test-history.json';
    if (options.projectName) {
      // Replace {project} placeholder with actual project name
      historyFile = historyFile.replace('{project}', options.projectName);
      // If no placeholder was used but projectName is set, prepend project name
      if (!options.historyFile?.includes('{project}')) {
        const ext = path.extname(historyFile);
        const base = path.basename(historyFile, ext);
        const dir = path.dirname(historyFile);
        historyFile = path.join(dir, `${base}-${options.projectName}${ext}`);
      }
    }

    this.options = {
      outputFile: options.outputFile ?? 'smart-report.html',
      historyFile,
      maxHistoryRuns: options.maxHistoryRuns ?? 10,
      performanceThreshold: options.performanceThreshold ?? 0.2,
      enableRetryAnalysis: options.enableRetryAnalysis ?? true,
      enableFailureClustering: options.enableFailureClustering ?? true,
      enableStabilityScore: options.enableStabilityScore ?? true,
      enableGalleryView: options.enableGalleryView ?? true,
      enableComparison: options.enableComparison ?? true,
      enableAIRecommendations: options.enableAIRecommendations ?? false,
      enableAISuiteHealth: options.enableAISuiteHealth ?? true,
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
      // Issue #21: Store project name for reference
      projectName: options.projectName,
      // Issue #22: Step filtering
      filterPwApiSteps: options.filterPwApiSteps ?? false,
      // Issue #41: Include expect() steps
      showExpectSteps: options.showExpectSteps ?? true,
      // Issue #20: Path resolution
      relativeToCwd: options.relativeToCwd ?? false,
      // Issue #26: External run ID (sanitized for safe use in filenames and HTML)
      runId: options.runId ? sanitizeFilename(options.runId.trim(), 100) : undefined,
      // Pass-through options (for reference)
      exportJson: options.exportJson,
      exportPdf: options.exportPdf,
      pdfFont: options.pdfFont,
      exportJunit: options.exportJunit,
      theme: options.theme,
      notifications: options.notifications,
      branding: options.branding,
      qualityGates: options.qualityGates,
      quarantine: options.quarantine,
      live: options.live,
      exportPdfFull: options.exportPdfFull,
      enableCausalTimeline: options.enableCausalTimeline,
    };
    this.outputDir = outputDir;
    this.setRunStart(Date.now());

    const branch = options.baseline?.branch;
    this.baselineBranch = withoutRemote(branch === 'target' ? detectCIInfo()?.targetBranch : branch);
    if (branch === 'target' && !this.baselineBranch) {
      console.log("Smart Reporter: baseline.branch is 'target', but this run has no target branch, so it is compared with the previous run.");
    }
    this.filterHistory = options.baseline?.filterHistory === true;
  }

  /**
   * Set when the run started. merge-reports builds the collector at merge time, so the reporter
   * passes the run's own start once onEnd knows it. The summary duration, timestamp and run id follow it.
   */
  setRunStart(startTime: number): void {
    this.startTime = startTime;
    this.currentRun = {
      runId: `run-${this.options.runId ?? startTime}`,
      timestamp: new Date(startTime).toISOString(),
    };
  }

  /**
   * Load test history from disk: the index, plus the run files it does not list yet
   */
  loadHistory(): void {
    this.history = this.trim(this.readSaved().history);
  }

  /**
   * Save the run as its own run file, then rebuild the index from the run files under a lock,
   * so runs that share the history never lose each other's results. A run with the same id
   * (and shard) replaces the earlier run file.
   */
  updateHistory(results: TestResultData[], forecasts?: Record<string, number>): void {
    // A run with no tests (global setup failed, nothing matched) says nothing, and would become the next baseline.
    if (results.length === 0) return;
    const timestamp = new Date().toISOString();
    const runId = this.currentRun.runId;
    const run: HistoryRunFile = {
      version: 1,
      summary: buildRunSummary(results, { ...this.currentRun, duration: Date.now() - this.startTime, ciInfo: detectCIInfo() }),
      tests: Object.fromEntries(results.map((result): [string, TestHistoryEntry] => {
        const retryWaste = retryWasteOf(result);
        return [result.testId, {
          passed: isPassedTest(result),
          duration: result.duration,
          timestamp,
          runId,
          skipped: isSkippedTest(result),
          retry: result.retry,
          ...this.stepDurationsEntry(result),
          ...(result.failureCluster && { clusterId: result.failureCluster.id }),
          ...(retryWaste > 0 && { retryWaste }),
        }];
      })),
      ...(forecasts && { forecasts }),
    };

    const historyPath = this.historyPath();
    const shard = this.shard ? `.shard-${this.shard.current}-of-${this.shard.total}` : '';
    writeJsonAtomic(path.join(runsDirOf(historyPath), `${runId}${shard}.json`), run);

    withLock(`${historyPath}.lock`, () => {
      const { history, runFiles } = this.readSaved();
      if (this.options.enableHistoryDrilldown) this.saveRunSnapshot(history, results);
      this.history = this.trim(history);
      writeJsonAtomic(historyPath, this.history);
      this.prune(history, runFiles);
    });
  }

  private historyPath(): string {
    return path.resolve(this.outputDir, this.options.historyFile);
  }

  // The saved index, with legacy ids moved, rebuilt with every run file beside it
  private readSaved(): { history: TestHistory; runFiles: Map<string, HistoryRunFile> } {
    const historyPath = this.historyPath();
    let index: TestHistory = { runs: [], tests: {}, summaries: [] };
    if (fs.existsSync(historyPath)) {
      try {
        index = readHistoryFile(historyPath);
      } catch (err) {
        console.warn('Failed to load history:', err);
      }
    }
    moveLegacyIds(index.tests, this.legacyIds);
    const runFiles = readRunFiles(historyPath);
    return { history: rebuildHistory([index], runFiles.values()), runFiles };
  }

  // The last maxHistoryRuns runs, and the last maxHistoryRuns entries of each test
  private trim(history: TestHistory): TestHistory {
    const max = this.options.maxHistoryRuns;
    const summaries = (history.summaries ?? []).slice(-max);
    const runs = history.runs.slice(-max);
    const keep = <T>(byRunId: Record<string, T>, kept: { runId: string }[]) =>
      Object.fromEntries(Object.entries(byRunId).filter(([runId]) => kept.some((k) => k.runId === runId)));
    return {
      runs,
      tests: Object.fromEntries(Object.entries(history.tests).map(([testId, entries]) => [testId, entries.slice(-max)])),
      summaries,
      ...(history.runFiles && { runFiles: keep(history.runFiles, runs) }),
      ...(history.forecasts && { forecasts: keep(history.forecasts, summaries) }),
    };
  }

  // Deletes the run files of runs outside the kept ones. With drilldown, also deletes the snapshots
  // of this history's runs that the index does not list, such as those an earlier lost update left.
  private prune(all: TestHistory, runFiles: Map<string, HistoryRunFile>): void {
    const historyPath = this.historyPath();
    const kept = new Set(this.history.summaries!.map((s) => s.runId));
    for (const [name, run] of runFiles) {
      if (!kept.has(run.summary.runId)) fs.rmSync(path.join(runsDirOf(historyPath), name), { force: true });
    }
    if (!this.options.enableHistoryDrilldown) return;
    // Other history files in the folder (projectName) share history-runs/, so only this history's runs count
    const own = new Set([...all.summaries!.map((s) => s.runId), ...all.runs.map((r) => r.runId), ...Object.keys(all.runFiles ?? {})]);
    const snapshotsDir = path.join(path.dirname(historyPath), 'history-runs');
    for (const name of fs.readdirSync(snapshotsDir)) {
      const runId = path.basename(name, '.json');
      if (own.has(runId) && !this.history.runFiles?.[runId]) fs.rmSync(path.join(snapshotsDir, name), { force: true });
    }
  }

  // The drilldown snapshot of the run, in history-runs/ beside the history file
  private saveRunSnapshot(history: TestHistory, results: TestResultData[]): void {
    const runId = this.currentRun.runId;
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
    writeJsonAtomic(path.join(path.dirname(this.historyPath()), 'history-runs', runFileName), runFile);

    history.runs = [...history.runs.filter((r) => r.runId !== runId), { ...this.currentRun }]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    history.runFiles = { ...history.runFiles, [runId]: `./history-runs/${runFileName}` };
  }

  private stepDurationsEntry(result: TestResultData): { stepDurations?: Record<string, number> } {
    if (this.options.enableCausalTimeline === false) return {};
    const stepDurations = stepDurationsOf(result.steps ?? []);
    return stepDurations ? { stepDurations } : {};
  }

  // Moves history saved under a test's old id to its current one, here and in the saved index when the run saves
  adoptLegacyIds(legacyIds: Map<string, string>): void {
    this.legacyIds = legacyIds;
    moveLegacyIds(this.history.tests, legacyIds);
  }

  /**
   * Get history for a specific test
   */
  getTestHistory(testId: string): TestHistoryEntry[] {
    return this.history.tests[testId] || [];
  }

  /**
   * History for flakiness and performance: with baseline.filterHistory, only the runs on the baseline branch
   */
  getBaselineHistory(testId: string): TestHistoryEntry[] {
    const entries = this.getTestHistory(testId);
    if (!this.filterHistory || !this.baselineBranch) return entries;
    const runIds = new Set(this.baselineBranchRuns().map(s => s.runId));
    return entries.filter(e => e.runId !== undefined && runIds.has(e.runId));
  }

  private baselineBranchRuns(): RunSummary[] {
    return (this.history.summaries ?? []).filter(s => withoutRemote(s.ciInfo?.branch) === this.baselineBranch);
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

    // The runId the baseline ran with, which history saves as run-<runId>, or the saved id itself
    if (this.options.baselineRunId) {
      const wanted = this.options.baselineRunId.trim();
      const saved = `run-${sanitizeFilename(wanted, 100)}`;
      return this.history.summaries.find(s => s.runId === saved) ?? this.history.summaries.find(s => s.runId === wanted) ?? null;
    }

    // Otherwise, the latest run on the baseline branch, or the previous run
    const runs = this.baselineBranch ? this.baselineBranchRuns() : this.history.summaries;
    if (this.baselineBranch && runs.length === 0) {
      console.log(`Smart Reporter: history has no run on the baseline branch '${this.baselineBranch}', so this run has no comparison.`);
    }
    return runs.length > 0 ? runs[runs.length - 1] : null;
  }
}

// Jenkins freestyle jobs record GIT_BRANCH with the remote, as origin/main
function withoutRemote(branch: string | undefined): string | undefined {
  return branch?.replace(/^origin\//, '');
}

// Moves history saved under a test's old id (current id -> old id) to its current one. Every test
// sharing an old id gets a copy. An old id that is still a current id stays put.
function moveLegacyIds(tests: TestHistory['tests'], legacyIds: Map<string, string>): void {
  const moved = new Set<string>();
  for (const [id, legacy] of legacyIds) {
    if (!tests[legacy] || legacyIds.has(legacy)) continue;
    tests[id] ??= [...tests[legacy]];
    moved.add(legacy);
  }
  for (const legacy of moved) delete tests[legacy];
}

// Write beside the file and rename over it, so a crash or a concurrent reader sees the old file or the new one, never half of one
function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmpPath = `${file}.${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, file);
  } catch (err) {
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

// Runs fn while holding the lock file, so runs that share a history rebuild its index one at a time
function withLock<T>(lockPath: string, fn: () => T): T {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let wait = 10; ; wait = Math.min(wait * 2, 500)) {
    try {
      fs.closeSync(fs.openSync(lockPath, 'wx'));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // A run that crashed while holding the lock never deletes it
    if (lockAge(lockPath) > LOCK_STALE_MS) {
      fs.rmSync(lockPath, { force: true });
      continue;
    }
    if (Date.now() >= deadline) throw new Error(`Timed out after ${LOCK_WAIT_MS / 1000} s waiting for ${lockPath}`);
    // updateHistory is synchronous, so sleep without returning to the event loop
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function lockAge(lockPath: string): number {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return 0; // released since the open failed
  }
}
