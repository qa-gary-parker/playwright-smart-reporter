import { aiReportInfo } from '../analyzers/ai-analyzer';
import { forecastRun } from '../analyzers/flake-forecast';
import { summarizeOwnership } from '../analyzers/ownership';
import { getReporterVersion } from '../generators/json-exporter';
import type {
  CIInfo,
  FailureCluster,
  QualityGateResult,
  QuarantineEntry,
  RunComparison,
  RunSnapshotFile,
  RunSummary,
  SmartReporterOptions,
  TestHistory,
  TestResultData,
} from '../types';
import { summarizeA11y } from '../analyzers/a11y-analyzer';
import { isFailedTest, isFlakyTest, isPassedTest, isSkippedTest } from '../utils/flakiness';
import {
  SCHEMA_VERSION,
  type ComparisonKey,
  type ReportCoverage,
  type ReportData,
  type ReportSummary,
  type ReportTest,
  type Signal,
} from './schema';

export interface ReportInput {
  results: TestResultData[];
  // The id history saves this run under; the reporter passes the history collector's.
  runId?: string;
  history: TestHistory;
  startTime: number;
  options: SmartReporterOptions;
  comparison?: RunComparison;
  historyRunSnapshots?: Record<string, RunSnapshotFile>;
  failureClusters?: FailureCluster[];
  ciInfo?: CIInfo;
  outputBasename?: string;
  // The live results file relative to the report, which is where the Live view fetches it from.
  liveFile?: string;
  qualityGateResult?: QualityGateResult;
  quarantinedTestIds?: Set<string>;
  quarantineEntries?: QuarantineEntry[];
  quarantineThreshold?: number;
  aiSuiteHealthSummary?: string;
  // Phase 6: Code coverage is merged by the reporter before gates run, so it arrives ready-built.
  coverage?: ReportCoverage;
}

const COMPARISON_KEYS: ComparisonKey[] = ['newFailures', 'fixedTests', 'newTests', 'regressions', 'improvements'];

export function summarize(results: TestResultData[], duration: number): ReportSummary {
  // Outcome-based counting (issues #16, #17): flaky and expected failures count as passed.
  const passed = results.filter(isPassedTest).length;
  const failed = results.filter(isFailedTest).length;
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of results) {
    if (r.stabilityScore) grades[r.stabilityScore.grade]++;
  }
  return {
    total: results.length,
    passed,
    failed,
    skipped: results.filter(isSkippedTest).length,
    // Passed on retry this run, as history and the comparison count it; the per-test 'flaky' signal also reads history.
    flaky: results.filter((r) => r.outcome === 'flaky').length,
    slow: results.filter((r) => r.performanceTrend?.startsWith('↑')).length,
    newTests: results.filter((r) => r.flakinessIndicator?.includes('New')).length,
    passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
    duration,
    grades,
  };
}

// History is updated after the report is written, so add this run's summary here.
function withCurrentRun(input: ReportInput, summary: ReportSummary): RunSummary[] {
  const past = input.history.summaries ?? [];
  const runId = runIdOf(input);
  if (past.some((r) => r.runId === runId)) return past;
  const { total, passed, failed, skipped, flaky, slow, duration, passRate } = summary;
  return [...past, { runId, timestamp: new Date(input.startTime).toISOString(), total, passed, failed, skipped, flaky, slow, duration, passRate }];
}

function runIdOf(input: ReportInput): string {
  return input.runId ?? `run-${input.options.runId ?? input.startTime}`;
}

export function buildReportData(input: ReportInput, now: number = Date.now()): ReportData {
  const { results, options, comparison } = input;

  const changes = Object.fromEntries(
    COMPARISON_KEYS.map((k) => [k, comparison ? comparison.changes[k].map((t) => t.testId) : []]),
  ) as Record<ComparisonKey, string[]>;
  const sets = Object.fromEntries(COMPARISON_KEYS.map((k) => [k, new Set(changes[k])])) as Record<ComparisonKey, Set<string>>;

  const clusterOf = new Map<string, string>();
  const clusters = (input.failureClusters ?? []).map((c) => {
    for (const t of c.tests) clusterOf.set(t.testId, c.id);
    return { id: c.id, errorType: c.errorType, testIds: c.tests.map((t) => t.testId), aiSuggestion: c.aiSuggestion };
  });

  const forecast = forecastRun(results, options.forecast);

  const tests: ReportTest[] = results.map((r) => {
    // screenshot repeats attachments.screenshots[0], which would embed every first screenshot twice.
    const { failureCluster: _cluster, traceData: _trace, screenshot: _screenshot, ...rest } = r;
    const signals: Signal[] = [];
    if (sets.newFailures.has(r.testId)) signals.push('new-failure');
    if (sets.regressions.has(r.testId) || r.performanceMetrics?.isRegression) signals.push('regression');
    if (isFlakyTest(r)) signals.push('flaky');
    if (input.quarantinedTestIds?.has(r.testId)) signals.push('quarantined');
    if (r.performanceTrend?.startsWith('↑')) signals.push('slow');
    if (sets.fixedTests.has(r.testId)) signals.push('fixed');
    if (sets.newTests.has(r.testId) || r.flakinessIndicator?.includes('New')) signals.push('new');
    const testForecast = forecast?.forecasts[r.testId];
    return { ...rest, clusterId: clusterOf.get(r.testId), signals, ...(testForecast && { forecast: testForecast }) };
  });

  const summary = summarize(results, now - input.startTime);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      generatedAt: new Date(now).toISOString(),
      reporterVersion: getReporterVersion(),
      runId: runIdOf(input),
      startTime: input.startTime,
      duration: now - input.startTime,
      ci: input.ciInfo,
      projectName: options.projectName,
      outputBasename: input.outputBasename ?? 'smart-report',
    },
    config: {
      theme: options.theme,
      branding: options.branding,
      features: {
        gallery: options.enableGalleryView !== false,
        comparison: options.enableComparison !== false && !!comparison,
        trends: options.enableTrendsView !== false,
        traceViewer: options.enableTraceViewer !== false,
        historyDrilldown: options.enableHistoryDrilldown === true,
        live: options.live?.enabled !== false,
        networkLogs: options.enableNetworkLogs !== false,
      },
      exports: {
        json: !!options.exportJson,
        junit: !!options.exportJunit,
        pdf: !!options.exportPdf,
        pdfFull: !!options.exportPdfFull,
        ctrf: !!options.exportCtrf,
        failures: !!options.exportFailures,
      },
      live: options.live?.enabled ? { jsonlFile: input.liveFile ?? options.live.outputFile ?? '.smart-live-results.jsonl' } : undefined,
    },
    summary,
    tests,
    clusters,
    trends: withCurrentRun(input, summary),
    comparison: comparison && {
      baselineRun: comparison.baselineRun,
      currentRun: comparison.currentRun,
      changes,
    },
    historySnapshots: input.historyRunSnapshots,
    gates: input.qualityGateResult,
    quarantine: input.quarantineEntries && { threshold: input.quarantineThreshold, entries: input.quarantineEntries },
    ai: {
      suiteHealthSummary: input.aiSuiteHealthSummary,
      ...aiReportInfo(input),
      ...(options.enableAIRecommendations !== true && { analysisOff: true }),
      ...((options.enableAIRecommendations !== true || options.enableAISuiteHealth === false) && { summaryOff: true }),
    },
    ...(forecast && { forecastSummary: forecast.summary }),
    ownership: summarizeOwnership(tests),
    a11y: summarizeA11y(results),
    coverage: input.coverage,
  };
}
