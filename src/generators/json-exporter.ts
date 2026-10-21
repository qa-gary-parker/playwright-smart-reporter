import * as fs from 'fs';
import * as path from 'path';
import type {
  TestResultData,
  TestHistory,
  SmartReporterOptions,
  RunComparison,
  FailureCluster,
  A11yResult,
  CausalTimeline,
  QualityGateResult,
  CIInfo,
} from '../types';
import type { CoverageSummary, ReportCoverage } from '../report-data/schema';
import { computeRunStats, runStabilityGrade } from '../utils/run-stats';
import { detectCIInfo } from '../utils/ci-detector';

export function getReporterVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface JsonExportData {
  metadata: {
    generatedAt: string;
    reporterVersion: string;
    projectName?: string;
    // Phase 5: CI surface integrations — absolute directory that test `file` paths are relative to
    rootDir?: string;
    ci?: CIInfo;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    duration: number;
    // Passed out of the tests that ran; null when every test was skipped.
    passRate: number | null;
    stabilityGrade?: string;
  };
  tests: JsonTestEntry[];
  failureClusters?: JsonClusterEntry[];
  comparison?: RunComparison;
  history?: {
    runCount: number;
    runs: TestHistory['runs'];
    summaries?: TestHistory['summaries'];
  };
  // Phase 5: CI surface integrations
  qualityGates?: QualityGateResult;
  // Phase 6: Code coverage (totals only; per-line hits and source live in the report data)
  coverage?: {
    summary: CoverageSummary;
    files: Array<CoverageSummary & { path: string }>;
  };
}

export interface JsonTestEntry {
  testId: string;
  title: string;
  file: string;
  status: string;
  duration: number;
  error?: string;
  retry: number;
  outcome?: string;
  flakinessScore?: number;
  stabilityScore?: {
    overall: number;
    grade: string;
  };
  performanceTrend?: string;
  tags?: string[];
  suite?: string;
  browser?: string;
  project?: string;
  aiSuggestion?: string;
  // Phase 10: Accessibility
  a11y?: A11yResult;
  // Phase 4: Causal failure timeline
  timeline?: CausalTimeline;
  owners?: string[];
  ownerSource?: TestResultData['ownerSource'];
  // Phase 5: CI surface integrations
  line?: number;
  column?: number;
  errorLocation?: TestResultData['errorLocation'];
}

interface JsonClusterEntry {
  id: string;
  errorType: string;
  count: number;
  testIds: string[];
  aiSuggestion?: string;
}

export function exportJsonData(
  results: TestResultData[],
  history: TestHistory,
  startTime: number,
  options: SmartReporterOptions,
  comparison?: RunComparison,
  failureClusters?: FailureCluster[],
  outputDir?: string,
  basename?: string,
  qualityGateResult?: QualityGateResult,
  rootDir?: string,
  coverage?: ReportCoverage,
): string {
  const baseDir = outputDir ?? (
    options.outputFile
      ? path.dirname(path.resolve(options.outputFile))
      : process.cwd()
  );
  const filename = `${basename ?? 'smart-report'}-data.json`;
  const outputPath = path.resolve(baseDir, filename);

  const { total, passed, failed, skipped, flaky, passRate } = computeRunStats(results);
  const duration = Date.now() - startTime;

  const tests: JsonTestEntry[] = results.map(r => ({
    testId: r.testId,
    title: r.title,
    file: r.file,
    status: r.status,
    duration: r.duration,
    error: r.error,
    retry: r.retry,
    outcome: r.outcome,
    flakinessScore: r.flakinessScore,
    stabilityScore: r.stabilityScore ? {
      overall: r.stabilityScore.overall,
      grade: r.stabilityScore.grade,
    } : undefined,
    performanceTrend: r.performanceTrend,
    tags: r.tags,
    suite: r.suite,
    browser: r.browser,
    project: r.project,
    aiSuggestion: r.aiSuggestion,
    a11y: r.a11y,
    timeline: r.timeline,
    owners: r.owners,
    ownerSource: r.ownerSource,
    line: r.line,
    column: r.column,
    errorLocation: r.errorLocation,
  }));

  const clusters: JsonClusterEntry[] | undefined = failureClusters?.map(c => ({
    id: c.id,
    errorType: c.errorType,
    count: c.count,
    testIds: c.tests.map(t => t.testId),
    aiSuggestion: c.aiSuggestion,
  }));

  const data: JsonExportData = {
    metadata: {
      generatedAt: new Date().toISOString(),
      reporterVersion: getReporterVersion(),
      projectName: options.projectName,
      rootDir,
      ci: detectCIInfo(),
    },
    summary: {
      total,
      passed,
      failed,
      skipped,
      flaky,
      duration,
      passRate,
      stabilityGrade: runStabilityGrade(results),
    },
    tests,
    failureClusters: clusters,
    comparison,
    history: {
      runCount: history.runs.length,
      runs: history.runs,
      summaries: history.summaries,
    },
    qualityGates: qualityGateResult,
    coverage: coverage && {
      summary: coverage.summary,
      files: coverage.files.map(({ path, lines, functions, branches }) => ({ path, lines, functions, branches })),
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  return outputPath;
}
