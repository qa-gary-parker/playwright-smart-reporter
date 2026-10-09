import type {
  A11ySummary,
  BrandingConfig,
  CIInfo,
  FlakeForecast,
  ForecastSummary,
  QualityGateResult,
  QuarantineEntry,
  RunSnapshotFile,
  RunSummary,
  TestResultData,
  ThemeConfig,
} from '../types';

export const SCHEMA_VERSION = 3;

export type Signal = 'new-failure' | 'regression' | 'flaky' | 'quarantined' | 'slow' | 'fixed' | 'new';

export type ReportTest = Omit<TestResultData, 'failureCluster' | 'traceData' | 'screenshot'> & {
  clusterId?: string;
  signals: Signal[];
  // Phase 7: Flake forecasting
  forecast?: FlakeForecast;
};

export interface ReportCluster {
  id: string;
  errorType: string;
  testIds: string[];
  aiSuggestion?: string;
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  slow: number;
  newTests: number;
  passRate: number;
  duration: number;
  grades: Record<'A' | 'B' | 'C' | 'D' | 'F', number>;
}

export type ComparisonKey = 'newFailures' | 'fixedTests' | 'newTests' | 'regressions' | 'improvements';

export interface ReportComparison {
  baselineRun: RunSummary;
  currentRun: RunSummary;
  changes: Record<ComparisonKey, string[]>;
}

export interface ReportFeatures {
  gallery: boolean;
  comparison: boolean;
  trends: boolean;
  traceViewer: boolean;
  historyDrilldown: boolean;
  live: boolean;
  networkLogs: boolean;
}

export interface ReportData {
  schemaVersion: typeof SCHEMA_VERSION;
  meta: {
    generatedAt: string;
    reporterVersion: string;
    runId: string;
    startTime: number;
    duration: number;
    ci?: CIInfo;
    projectName?: string;
    outputBasename: string;
  };
  config: {
    theme?: ThemeConfig;
    branding?: BrandingConfig;
    features: ReportFeatures;
    exports: { json: boolean; junit: boolean; pdf: boolean; pdfFull?: boolean; ctrf: boolean; failures: boolean };
    live?: { jsonlFile: string };
  };
  summary: ReportSummary;
  tests: ReportTest[];
  clusters: ReportCluster[];
  trends: RunSummary[];
  comparison?: ReportComparison;
  historySnapshots?: Record<string, RunSnapshotFile>;
  gates?: QualityGateResult;
  quarantine?: { threshold?: number; entries: QuarantineEntry[] };
  ai: {
    suiteHealthSummary?: string;
    // Phase 0.5: Local model support (Ollama)
    provider?: string;
    model?: string;
    // Switched off by the options, as opposed to not configured.
    analysisOff?: boolean;
    summaryOff?: boolean;
  };
  // Phase 7: Flake forecasting
  forecastSummary?: ForecastSummary;
  // Phase 9: Ownership and routing (per-test owners/ownerSource come from TestResultData)
  ownership?: { owners: Array<{ owner: string; total: number; failed: number; flaky: number; passRate: number }> };
  // Phase 10: Accessibility (per-test results ride on ReportTest.a11y)
  a11y?: A11ySummary;
  // Phase 6: Code coverage
  coverage?: ReportCoverage;
}

// Percentages follow Istanbul: floored to 2 decimals, 100 when total is 0.
export interface CoverageTotals {
  total: number;
  covered: number;
  pct: number;
}

export interface CoverageSummary {
  lines: CoverageTotals;
  functions: CoverageTotals;
  branches: CoverageTotals;
}

export interface CoverageFile extends CoverageSummary {
  path: string;
  // Hits per line summed over every test: index 0 is line 1, null is a line with no statement.
  hits: Array<number | null>;
  source?: string;
}

export interface ReportCoverage {
  summary: CoverageSummary;
  files: CoverageFile[];
}
