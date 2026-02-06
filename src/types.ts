import type { TestCase, TestResult } from '@playwright/test/reporter';

// ============================================================================
// Configuration
// ============================================================================

export interface ThresholdConfig {
  // Flakiness thresholds (0-1 scale, where 0 = never fails, 1 = always fails)
  flakinessStable?: number;        // Default: 0.1 (below this = stable)
  flakinessUnstable?: number;      // Default: 0.3 (below this = unstable, above = flaky)

  // Performance threshold (fraction, e.g., 0.2 = 20% slower triggers regression)
  performanceRegression?: number;  // Default: 0.2

  // Stability score weights (must sum to 1.0)
  stabilityWeightFlakiness?: number;   // Default: 0.4
  stabilityWeightPerformance?: number; // Default: 0.3
  stabilityWeightReliability?: number; // Default: 0.3

  // Grade thresholds
  gradeA?: number;                 // Default: 90
  gradeB?: number;                 // Default: 80
  gradeC?: number;                 // Default: 70
  gradeD?: number;                 // Default: 60

}

export interface SmartReporterOptions {
  // Core options
  outputFile?: string;
  historyFile?: string;
  maxHistoryRuns?: number;
  performanceThreshold?: number;
  slackWebhook?: string;
  teamsWebhook?: string;

  // NEW: Feature flags (all default to true)
  enableRetryAnalysis?: boolean;
  enableFailureClustering?: boolean;
  enableStabilityScore?: boolean;
  enableGalleryView?: boolean;
  enableComparison?: boolean;
  enableAIRecommendations?: boolean;
  enableTrendsView?: boolean;
  enableTraceViewer?: boolean; // Enable "View trace" links
  enableHistoryDrilldown?: boolean; // Default: false (stores per-run snapshots for dot-click drilldown)

  // NEW: Thresholds
  stabilityThreshold?: number;     // Default: 70 (warn below this)
  retryFailureThreshold?: number;  // Default: 3 (warn if needs >3 retries)

  // Configurable thresholds for all analyzers
  thresholds?: ThresholdConfig;

  // NEW: Comparison
  baselineRunId?: string;          // Compare against specific run

  // CSP Compliance - Use system fonts and avoid base64 data URIs
  cspSafe?: boolean;               // Default: false (for backwards compatibility)

  // NEW: Network Logging (extracted from trace files)
  enableNetworkLogs?: boolean;     // Default: true (when traces exist)
  networkLogFilter?: string;       // Only show URLs containing this string
  networkLogExcludeAssets?: boolean; // Exclude static assets (default: true)
  networkLogMaxEntries?: number;   // Max entries per test (default: 50)

  // Issue #22: Step filtering - hide verbose pw:api steps
  filterPwApiSteps?: boolean;      // Default: false (show all steps for backwards compatibility)

  // Issue #20: Path resolution relative to current working directory
  // When true, outputFile and historyFile are resolved relative to process.cwd()
  // When false (default), paths are resolved relative to Playwright's rootDir
  relativeToCwd?: boolean;         // Default: false (backwards compatible)

  // Issue #21: Project-based history separation
  // Set this to isolate history per project (e.g., 'api', 'ui', 'regression')
  // Supports {project} placeholder in historyFile path
  projectName?: string;            // e.g., 'api-tests' or 'ui-regression'

  // Report size optimization
  maxEmbeddedSize?: number;        // Max bytes for inline base64 (default: 5MB). Traces larger are file-referenced.

  // Cloud upload options (for StageWright cloud service)
  apiKey?: string;                 // API key for cloud service
  projectId?: string;              // Project ID in cloud service
  uploadToCloud?: boolean;         // Enable cloud upload (default: false)
  cloudEndpoint?: string;          // Custom cloud endpoint URL
  uploadArtifacts?: boolean;       // Upload attachments to cloud (default: true)

  // Issue #26: External run ID for consistent IDs across CI shards
  runId?: string;                  // Unique identifier for this test run (e.g. GITHUB_RUN_ID)
}

// ============================================================================
// History & Test Data
// ============================================================================

export interface TestHistoryEntry {
  passed: boolean;
  duration: number;
  timestamp: string;
  skipped?: boolean;
  retry?: number;  // NEW: Track retry count in history
  runId?: string;  // NEW: Run identifier for drilldown
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  slow: number;
  duration: number;
  passRate: number;
  ciInfo?: CIInfo;  // NEW: CI metadata
}

export interface RunMetadata {
  runId: string;
  timestamp: string;
}

export interface TestHistory {
  runs: RunMetadata[];
  tests: {
    [testId: string]: TestHistoryEntry[];
  };
  summaries?: RunSummary[];
  runFiles?: Record<string, string>; // runId -> relative JSON snapshot path
}

export interface TestResultSnapshot {
  testId: string;
  title: string;
  file: string;
  status: TestResultData['status'];
  duration: number;
  retry: number;
  error?: string;
  steps: StepData[];
  aiSuggestion?: string;
  aiSuggestionHtml?: string;
  attachments?: AttachmentData;
}

export interface RunSnapshotFile {
  runId: string;
  timestamp: string;
  tests: Record<string, TestResultSnapshot>;
}

// NEW: CI Integration
export interface CIInfo {
  provider: string;  // 'github' | 'gitlab' | 'circleci' | 'jenkins' | 'azure'
  branch?: string;
  commit?: string;
  buildId?: string;
}

// ============================================================================
// Test Results & Analysis
// ============================================================================

export interface StepData {
  title: string;
  duration: number;
  category: string;
  isSlowest?: boolean;
}

// Test annotation (beyond tags) - captures @slow, @fixme, custom annotations
export interface TestAnnotation {
  type: string;              // e.g., 'slow', 'fixme', 'skip', 'issue', custom types
  description?: string;      // Optional description/reason
}

export interface TestResultData {
  testId: string;
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: string;
  retry: number;
  // Playwright outcome and expected status for proper handling of retries and test.fail()
  outcome?: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  expectedStatus?: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  aiPrompt?: string;         // NEW: Playwright-style prompt sent to AI (no binaries)
  flakinessScore?: number;
  flakinessIndicator?: string;
  performanceTrend?: string;
  averageDuration?: number;
  aiSuggestion?: string;
  steps: StepData[];
  screenshot?: string;
  videoPath?: string;
  tracePath?: string;      // NEW: Trace file path
  traceData?: string;      // NEW: Base64 encoded trace data
  history: TestHistoryEntry[];

  // NEW: Tag/Suite filtering
  tags?: string[];           // Tags from annotations (e.g., '@smoke', '@critical')
  suite?: string;            // Direct parent suite name
  suites?: string[];         // Full suite hierarchy (e.g., ['Auth', 'Login'])

  // Browser/Project info (for multi-browser/multi-project setups)
  browser?: string;          // Browser name (e.g., 'chromium', 'firefox', 'webkit')
  project?: string;          // Playwright project name (e.g., 'Desktop Chrome', 'Mobile Safari')

  // Annotations beyond tags (e.g., @slow, @fixme, custom annotations)
  annotations?: TestAnnotation[];

  // NEW: Enhanced data
  retryInfo?: RetryInfo;
  failureCluster?: FailureCluster;
  stabilityScore?: StabilityScore;
  attachments?: AttachmentData;
  performanceMetrics?: PerformanceMetrics;
  networkLogs?: NetworkLogData;        // NEW: Network logs from trace
}

// NEW: Retry Analysis
export interface RetryInfo {
  totalRetries: number;
  passedOnRetry: number;      // Which retry it passed on (0 = first try, -1 if never passed)
  failedRetries: number;
  retryPattern: boolean[];    // [false, false, true] = failed twice, passed on 3rd
  needsAttention: boolean;    // True if frequently needs retries
}

// NEW: Failure Clustering
export interface FailureCluster {
  id: string;
  errorType: string;
  count: number;              // Number of tests in this cluster
  tests: TestResultData[];
  aiSuggestion?: string;      // Single suggestion for the cluster
}

// NEW: Stability Scoring
export interface StabilityScore {
  overall: number;            // 0-100 composite score
  flakiness: number;          // 0-100
  performance: number;        // 0-100
  reliability: number;        // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  needsAttention: boolean;    // True if score < threshold
}

// NEW: Enhanced Attachments
export interface AttachmentData {
  screenshots: string[];      // Base64 data URIs or file paths
  videos: string[];           // File paths
  traces: string[];           // Trace file paths
  custom: CustomAttachment[]; // Issue #15: Support custom attachments
}

// Issue #15: Custom attachment from testInfo.attach()
export interface CustomAttachment {
  name: string;
  contentType: string;
  path?: string;              // File path for file attachments
  body?: string;              // Base64 content for inline attachments
}

// NEW: Performance Analysis
export interface PerformanceMetrics {
  averageDuration: number;
  currentDuration: number;
  percentChange: number;
  absoluteChange: number;
  threshold: number;
  isRegression: boolean;
  isImprovement: boolean;
  severity: 'low' | 'medium' | 'high';
}

// NEW: Run Comparison
export interface RunComparison {
  baselineRun: RunSummary;
  currentRun: RunSummary;
  changes: ComparisonChanges;
}

export interface ComparisonChanges {
  newFailures: TestResultData[];
  fixedTests: TestResultData[];
  newTests: TestResultData[];
  regressions: TestResultData[];  // Got slower
  improvements: TestResultData[]; // Got faster
}

// NEW: AI Recommendations
export interface TestRecommendation {
  type: 'flakiness' | 'retry' | 'performance' | 'cluster' | 'suite';
  priority: number;           // 0-100, higher = more urgent
  title: string;
  description: string;
  action: string;             // What to do about it
  affectedTests: string[];    // Test IDs
  icon: string;
}

// NEW: Gallery Items
export interface GalleryItem {
  id: string;
  testTitle: string;
  testId: string;
  status: string;
  dataUri?: string;           // For screenshots
  videoPath?: string;         // For videos
  tracePath?: string;         // For traces
}

// NEW: Network Logging (extracted from trace files)
export interface NetworkLogEntry {
  method: string;
  url: string;
  urlPath: string;            // Just the path portion for display
  status: number;
  statusText: string;
  duration: number;           // Total time in ms
  timestamp: string;
  contentType?: string;
  requestSize: number;
  responseSize: number;
  timings?: {
    dns: number;
    connect: number;
    ssl: number;
    wait: number;             // Time to first byte
    receive: number;
  };
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: any;
  responseBody?: any;
}

export interface NetworkLogData {
  entries: NetworkLogEntry[];
  totalRequests: number;
  totalDuration: number;
  summary: {
    byStatus: Record<number, number>;   // e.g., { 200: 5, 400: 1 }
    byMethod: Record<string, number>;   // e.g., { GET: 3, POST: 2 }
    slowest: NetworkLogEntry | null;
    errors: NetworkLogEntry[];          // Status >= 400
  };
}

// ============================================================================
// Internal Types
// ============================================================================

export interface SuiteStats {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  slow: number;
  needsRetry: number;
  passRate: number;
  averageStability: number;
}
