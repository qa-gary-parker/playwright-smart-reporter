import * as fs from 'fs';
import * as path from 'path';
import type {
  TestResultData,
  TestHistory,
  SmartReporterOptions,
  RunComparison,
  FailureCluster,
} from '../types';

function getReporterVersion(): string {
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
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    flaky: number;
    duration: number;
    passRate: number;
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
}

interface JsonTestEntry {
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
): string {
  const baseDir = outputDir ?? (
    options.outputFile
      ? path.dirname(path.resolve(options.outputFile))
      : process.cwd()
  );
  const filename = `${basename ?? 'smart-report'}-data.json`;
  const outputPath = path.resolve(baseDir, filename);

  const passed = results.filter(r => r.status === 'passed' || r.outcome === 'expected' || r.outcome === 'flaky').length;
  const failed = results.filter(r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut')).length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const flaky = results.filter(r => r.outcome === 'flaky').length;
  const duration = Date.now() - startTime;

  // Calculate average stability grade
  const gradedTests = results.filter(r => r.stabilityScore?.grade);
  const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const reverseGradeMap: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'F' };
  let avgGrade: string | undefined;
  if (gradedTests.length > 0) {
    const sum = gradedTests.reduce((acc, r) => acc + (gradeMap[r.stabilityScore!.grade] || 0), 0);
    avgGrade = reverseGradeMap[Math.round(sum / gradedTests.length)] || 'C';
  }

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
    },
    summary: {
      total: results.length,
      passed,
      failed,
      skipped,
      flaky,
      duration,
      passRate: results.length > 0 ? Math.round((passed / results.length) * 100) : 0,
      stabilityGrade: avgGrade,
    },
    tests,
    failureClusters: clusters,
    comparison,
    history: {
      runCount: history.runs.length,
      runs: history.runs,
      summaries: history.summaries,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  return outputPath;
}
