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
  SmartReporterOptions,
  TestHistory,
  TestResultData,
} from '../types';
import { summarizeA11y } from '../analyzers/a11y-analyzer';
import { isFlakyTest } from '../utils/flakiness';
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
  history: TestHistory;
  startTime: number;
  options: SmartReporterOptions;
  comparison?: RunComparison;
  historyRunSnapshots?: Record<string, RunSnapshotFile>;
  failureClusters?: FailureCluster[];
  ciInfo?: CIInfo;
  outputBasename?: string;
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
  const passed = results.filter((r) => r.status === 'passed' || r.outcome === 'expected' || r.outcome === 'flaky').length;
  const failed = results.filter((r) => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut')).length;
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const r of results) {
    if (r.stabilityScore) grades[r.stabilityScore.grade]++;
  }
  return {
    total: results.length,
    passed,
    failed,
    skipped: results.filter((r) => r.status === 'skipped').length,
    flaky: results.filter((r) => isFlakyTest(r)).length,
    slow: results.filter((r) => r.performanceTrend?.startsWith('↑')).length,
    newTests: results.filter((r) => r.flakinessIndicator?.includes('New')).length,
    passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
    duration,
    grades,
  };
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
    const { failureCluster: _cluster, traceData: _trace, ...rest } = r;
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

  return {
    schemaVersion: SCHEMA_VERSION,
    meta: {
      generatedAt: new Date(now).toISOString(),
      reporterVersion: getReporterVersion(),
      runId: options.runId ?? `run-${input.startTime}`,
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
      exports: { json: !!options.exportJson, junit: !!options.exportJunit, pdf: !!options.exportPdf },
      live: options.live?.enabled ? { jsonlFile: options.live.outputFile ?? '.smart-live-results.jsonl' } : undefined,
    },
    summary: summarize(results, now - input.startTime),
    tests,
    clusters,
    trends: input.history.summaries ?? [],
    comparison: comparison && {
      baselineRun: comparison.baselineRun,
      currentRun: comparison.currentRun,
      changes,
    },
    historySnapshots: input.historyRunSnapshots,
    gates: input.qualityGateResult,
    quarantine: input.quarantineEntries && { threshold: input.quarantineThreshold, entries: input.quarantineEntries },
    ai: { suiteHealthSummary: input.aiSuiteHealthSummary, ...aiReportInfo(input) },
    ...(forecast && { forecastSummary: forecast.summary }),
    ownership: summarizeOwnership(tests),
    a11y: summarizeA11y(results),
    coverage: input.coverage,
  };
}
