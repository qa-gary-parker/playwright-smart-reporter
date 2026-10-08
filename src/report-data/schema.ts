import type {
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

export type ReportTest = Omit<TestResultData, 'failureCluster' | 'traceData'> & {
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
    exports: { json: boolean; junit: boolean; pdf: boolean };
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
  };
  // Phase 7: Flake forecasting
  forecastSummary?: ForecastSummary;
}
