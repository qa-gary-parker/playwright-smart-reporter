import type { TestCase, TestResult } from '@playwright/test/reporter';

// ============================================================================
// Report Customisation
// ============================================================================

// Issue #42: custom TTF/OTF fonts so non-Latin scripts (Arabic, CJK, ...) render
// instead of tofu. pdfkit's built-in Helvetica only covers Latin glyphs.
export interface PdfFontConfig {
  regular: string;      // path to a .ttf/.otf file (or .ttc with `family`)
  bold?: string;        // optional bold variant; falls back to regular
  family?: string;      // font name inside a .ttc/.dfont collection
  boldFamily?: string;  // bold font name inside a .ttc/.dfont collection
}

export interface ThemeConfig {
  preset?: 'default' | 'dark' | 'light' | 'high-contrast' | 'ocean' | 'sunset' | 'dracula' | 'cyberpunk' | 'forest' | 'rose';
  primary?: string;
  background?: string;
  surface?: string;
  text?: string;
  accent?: string;
  success?: string;
  error?: string;
  warning?: string;
}

export interface BrandingConfig {
  logo?: string;
  title?: string;
  footer?: string;
  hidePoweredBy?: boolean;
}

export interface NotificationCondition {
  minFailures?: number;
  maxPassRate?: number;
  tags?: string[];
  stabilityGradeDrop?: boolean;
  newClusters?: boolean;  // a failed test is in a cluster that no run in history had
}

export interface NotificationConfig {
  channel: 'slack' | 'teams' | 'pagerduty' | 'email' | 'webhook';
  config: Record<string, string>;
  conditions?: NotificationCondition;
  template?: string;
  // Phase 9: Ownership and routing
  // Fire only for failures owned by one of these owners (CODEOWNERS handles or git author emails)
  owners?: string[];
  // Slack and Teams only: also send quarantine changes, scoped by owners
  quarantineEvents?: boolean;
}

// ============================================================================
// Configuration
// ============================================================================

export interface ThresholdConfig {
  // Flakiness status thresholds on instability, 0-1: changes between pass and fail after the first,
  // plus passes on a retry, per run
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

  // NEW: Feature flags (default to true unless noted)
  enableRetryAnalysis?: boolean;
  enableFailureClustering?: boolean;
  enableStabilityScore?: boolean;
  enableGalleryView?: boolean;
  enableComparison?: boolean;
  enableAIRecommendations?: boolean; // Default: false (sends failure data to the AI provider)
  enableAISuiteHealth?: boolean;   // Default: true, needs enableAIRecommendations (AI health summary in Insights, uses AI quota)
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
  // Issue #78: compare with the latest run on a branch. 'target' is the branch a pull request merges into.
  // filterHistory: flakiness and performance use only that branch's runs too (default: false)
  baseline?: { branch: string; filterHistory?: boolean };

  // CSP Compliance - Use system fonts and avoid base64 data URIs
  cspSafe?: boolean;               // Default: false (for backwards compatibility)

  // NEW: Network Logging (extracted from trace files)
  enableNetworkLogs?: boolean;     // Default: true (when traces exist)
  networkLogFilter?: string;       // Only show URLs containing this string
  networkLogExcludeAssets?: boolean; // Exclude static assets (default: true)
  networkLogMaxEntries?: number;   // Max entries per test (default: 50)

  // Issue #22: Step filtering - hide verbose pw:api steps
  filterPwApiSteps?: boolean;      // Default: false (show all steps for backwards compatibility)

  // Issue #41: Include standalone expect() assertion steps in the step timeline
  showExpectSteps?: boolean;       // Default: true (kept even when filterPwApiSteps is true)

  // Issue #20: Path resolution relative to current working directory
  // When true, outputFile and historyFile are resolved relative to process.cwd()
  // When false (default), paths are resolved relative to Playwright's rootDir
  relativeToCwd?: boolean;         // Default: false (backwards compatible)

  // Issue #21: Project-based history separation
  // Set this to isolate history per project (e.g., 'api', 'ui', 'regression')
  // Supports {project} placeholder in historyFile path
  projectName?: string;            // e.g., 'api-tests' or 'ui-regression'

  // Report size optimization
  /** @deprecated No effect since 3.0.0: traces are always copied next to the report and never embedded. */
  maxEmbeddedSize?: number;
  // Where report data lives: inline in the HTML, in a companion <name>-data.js, or chosen by size (default: 'auto')
  assetMode?: 'inline' | 'external' | 'auto';

  // Issue #26: External run ID for consistent IDs across CI shards
  runId?: string;                  // Unique identifier for this test run (e.g. GITHUB_RUN_ID)

  // Export options
  exportJson?: boolean;            // Write smart-report-data.json alongside HTML
  exportPdf?: boolean;             // Generate PDF executive summary

  // Issue #42: custom TTF/OTF fonts for the executive PDF so non-Latin scripts
  // (Arabic, CJK, ...) render instead of tofu.
  pdfFont?: PdfFontConfig;
  exportJunit?: boolean;           // Generate JUnit XML output

  // Custom themes
  theme?: ThemeConfig;

  // Advanced notifications
  notifications?: NotificationConfig[];

  // Report branding
  branding?: BrandingConfig;

  // Quality gates - CI pipeline pass/fail rules
  qualityGates?: QualityGateConfig;

  // Flakiness quarantine - auto-quarantine flaky tests
  quarantine?: QuarantineConfig;

  // Live reporting: stream results during execution
  live?: LiveConfig;

  // Full PDF report (legacy HTML-to-PDF, replaces default executive PDF)
  exportPdfFull?: boolean;

  // Phase 0.5: Local model support (Ollama)
  ai?: AIConfig;
  // Phase 7: Flake forecasting. Advisory only; never feeds quarantine.
  forecast?: ForecastConfig;
  // Phase 9: Ownership and routing
  // enabled defaults to true when a CODEOWNERS file is found or source is 'git'
  ownership?: { enabled?: boolean; source?: 'codeowners' | 'git' | 'auto'; codeownersPath?: string };
  // Phase 10: Accessibility
  // Read by withAccessibility() and injected into `use.smartReporterA11y`
  accessibility?: AccessibilityConfig;
  // Phase 4: Causal failure timeline
  enableCausalTimeline?: boolean;  // Default: true (timeline + first-anomaly suggestion on failed tests)
  // Phase 8: agent-ready output
  exportFailures?: boolean;        // Write redacted <name>-failures.json for coding agents (default: false)
  // Phase 5: CI surface integrations
  exportCtrf?: boolean;            // Write <name>-ctrf.json (Common Test Report Format) alongside HTML
  // Mask secrets in test text before any report file is written (default: false). patterns adds regular expressions.
  redact?: boolean | { patterns?: Array<string | RegExp> };
  // Phase 31: CI price per minute; with it, the efficiency panel prices the retry waste (default: off)
  ciCostPerMinute?: number;
  // Phase 36: write <name>-metrics.prom (Prometheus text) and <name>-metrics.otlp.json (OTLP JSON) (default: false).
  // push also sends one of them to an endpoint.
  exportMetrics?: boolean | { push?: MetricsPushConfig };
  // #73: list the files changed between the last pass and the first failure, from git in the local clone (default: false)
  suspects?: boolean;
}

export interface MetricsPushConfig {
  url: string;                      // e.g. a Pushgateway's /metrics/job/<job>, or an OTLP/HTTP receiver's /v1/metrics
  format?: 'prometheus' | 'otlp';   // Default: 'prometheus'
  headers?: Record<string, string>; // e.g. Authorization
}

export type AIProviderName = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openai-compatible';

export interface AIConfig {
  provider?: AIProviderName;  // Default: detected from env (see resolveAIProvider). Set to skip detection.
  baseUrl?: string;           // OpenAI-compatible providers only (openai, ollama, openai-compatible)
  model?: string;             // Overrides the selected provider's default model
  timeoutMs?: number;         // Per-call timeout (default: 60000)
  maxTotalMs?: number;        // Cap on total AI analysis time per run (default: 300000)
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

  // Phase 4: Causal failure timeline
  stepDurations?: Record<string, number>;  // test.step title -> duration (ms), the slow-step baseline
  clusterId?: string;  // the failure cluster of a failed test
  retryWaste?: number;  // ms spent in the attempts Playwright retried; absent when it retried none
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
  // Passed out of the tests that ran; null when every test was skipped.
  passRate: number | null;
  ciInfo?: CIInfo;  // NEW: CI metadata
  stabilityGrade?: StabilityScore['grade'];
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
  // Phase 7: runId -> testId -> forecast risk recorded that run (risk 0 omitted), pruned to maxHistoryRuns
  forecasts?: Record<string, Record<string, number>>;
}

// One run, or one shard of it, in `<history base>.runs/`. Written once; the history index is rebuilt from these.
export interface HistoryRunFile {
  version: 1;
  summary: RunSummary;
  tests: Record<string, TestHistoryEntry>;
  forecasts?: Record<string, number>; // testId -> forecast risk
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
  commit?: string;  // short form of sha, for display
  buildId?: string;
  sha?: string;  // the full commit; for a pull request, its head where CI names it
  repoUrl?: string;
  prNumber?: number;
  targetBranch?: string;  // the branch a pull request merges into
}

// ============================================================================
// Test Results & Analysis
// ============================================================================

export interface StepData {
  title: string;
  duration: number;
  category: string;
  isSlowest?: boolean;

  // Phase 4: Causal failure timeline
  startTime?: number;  // ms offset from the attempt's start
  failed?: boolean;

  // Steps are in pre-order. Both are absent on a top-level step.
  parent?: number;     // index in the same list of the nearest enclosing step that is kept
  depth?: number;      // number of kept steps that enclose this one
}

// A test.step that ran slower than the median of its passing runs in history
export interface StepTrend {
  title: string;
  median: number;   // ms
  current: number;  // ms, this run
  ratio: number;    // current / median, 1 decimal
}

// Test annotation (beyond tags) - captures @slow, @fixme, custom annotations
export interface TestAnnotation {
  type: string;              // e.g., 'slow', 'fixme', 'skip', 'issue', custom types
  description?: string;      // Optional description/reason
}

export interface AttemptData {
  retry: number;
  status: TestResultData['status'];
  duration: number;
  error?: string;
  steps: StepData[];
  // Where and when the attempt ran (Playwright's TestResult); absent for a test that never started
  workerIndex?: number;
  parallelIndex?: number;
  startTime?: number;  // epoch ms
  // Set on attempts before the final one of a flaky test; the final attempt's evidence is on the test itself.
  attachments?: Pick<AttachmentData, 'screenshots' | 'videos' | 'traces'>;
  tracePath?: string;
}

// Phase 34: what differs between the traces of a flaky test's failed attempt and its passing attempt
export interface AttemptDiff {
  failed: number;                   // retry of the first attempt that missed the expected status and has a trace (for test.fail(), one that passed)
  passed: number;                   // retry of the last attempt that got the expected status
  missingTrace?: number[];          // retries without a trace; network and console are then absent
  network?: AttemptRequestDiff[];   // absent with enableNetworkLogs: false
  console?: Array<{ level: string; text: string }>; // errors and warnings only the failed attempt logged
}

export interface AttemptRequestDiff {
  method: string;
  url: string;
  failed?: number;                  // status in the failed attempt, -1 for no response; absent when that attempt did not send it
  passed?: number;                  // status in the passing attempt; absent when that attempt did not send it
}

export type FlakinessStatus = 'stable' | 'unstable' | 'flaky' | 'failing' | 'insufficient-history';

export interface TestResultData {
  testId: string;
  title: string;
  file: string;
  line?: number;
  column?: number;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: string;
  errorSnippet?: string;     // Playwright's source snippet around the failing line
  errorLocation?: { file: string; line: number; column: number };
  retry: number;
  // Playwright outcome and expected status for proper handling of retries and test.fail()
  outcome?: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  expectedStatus?: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  aiPrompt?: string;         // NEW: Playwright-style prompt sent to AI (no binaries)
  flakinessScore?: number;
  flakinessIndicator?: string;
  flakinessStatus?: FlakinessStatus;
  flakinessRuns?: number;    // Non-skipped runs behind the score and status, this run included
  flakinessInterval?: [number, number]; // 95% Wilson interval of flakinessScore
  performanceTrend?: string;
  averageDuration?: number;
  stepTrends?: StepTrend[];
  aiSuggestion?: string;
  steps: StepData[];
  screenshot?: string;
  videoPath?: string;
  tracePath?: string;      // NEW: Trace file path
  /** @deprecated Not set since 3.0.0. */
  traceData?: string;
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
  attempts?: AttemptData[];            // Every attempt in retry order, final attempt last
  attemptDiff?: AttemptDiff;           // Flaky tests only

  // Phase 9: Ownership and routing
  owners?: string[];
  ownerSource?: 'codeowners' | 'git';
  // Phase 10: Accessibility
  a11y?: A11yResult;
  // Phase 4: Causal failure timeline
  timeline?: CausalTimeline;           // Failed attempts only
  commits?: CommitRange;               // #73: new failures only
}

// #73: where a failure started, from the CI info history saved: the newest run before it that passed, and its first failed run
export interface CommitRange {
  lastPassed?: CommitRef;     // absent when no run in history passed, or that run had no commit
  firstFailed: CommitRef;
  url?: string;               // GitHub or GitLab page of the range, or of the first failed commit
  suspects?: string[];        // files changed in the range, with suspects: true; absent for a range of one commit, or when git could not tell
}

export interface CommitRef {
  commit: string;             // short, for display
  sha?: string;
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
  tracking?: ClusterTracking;
}

// How a cluster of this run relates to the runs in history. A cluster went away in a run when one of its tests passed and none failed with it.
export interface ClusterTracking {
  status: 'new' | 'recurring' | 'regressed'; // regressed: it went away in a run after it was last seen
  runs: number;               // runs it failed in since it last went away, this run included; 1 unless recurring
  since: string;              // start of the first of those runs
  sinceCommit?: string;       // short commit of that run, when CI gave one
  trend: number[];            // tests in the cluster per run in history, oldest first, this run last
  commits?: CommitRange;      // absent when the first of those runs has no commit
}

// A cluster of the baseline run that went away this run
export interface ResolvedCluster {
  id: string;
  testIds: string[];          // its tests in the baseline run that passed this run
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
  notInBaseline: TestResultData[]; // Has history, but did not run in the baseline run
  newFlaky: TestResultData[];      // Passed on a retry now, and on the first attempt in the baseline run
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
  requestBody?: unknown;
  responseBody?: unknown;
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
// Phase 31: CI efficiency (all times in ms)
// ============================================================================

export interface RunEfficiency {
  retryWaste: number;                                         // time in the attempts Playwright retried
  retryWasteByTest: Array<{ testId: string; waste: number }>; // most first
  retryWasteTrend: Array<{ runId: string; retryWaste: number | null }>; // null: history cannot tell
  testTime: number;                                           // every attempt of every test
  // The slowest percent of the tests that ran, by their time over every attempt, and their share of testTime
  longTail: Array<{ percent: number; tests: number; time: number; share: number; testIds: string[] }>;
  setupGap?: number;                                          // run start to the first attempt start
  shard?: { current: number; total: number; wallTime: number };
  // Worker slots (parallelIndex) from the first attempt start to the last attempt end
  workers?: { span: number; utilisation: number; slots: Array<{ slot: number; attempts: number; busy: number; idle: number }> };
  merged?: true;                                              // merge-reports: shard and workers are unknown
  cost?: { perMinute: number; retryWaste: number };           // ciCostPerMinute × minutes of retry waste
}

// Phase 32: a failure pattern that points at a project, browser or worker slot
export interface EnvironmentInsight {
  dimension: 'project' | 'browser' | 'worker';
  value: string;
  testIds: string[];  // the failed results
  text: string;       // e.g. "1 test fails on firefox only"
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
  passRate: number | null;
  averageStability: number;
}

// ============================================================================
// Quality Gates
// ============================================================================

export interface QualityGateConfig {
  maxFailures?: number;
  minPassRate?: number;
  maxFlakyRate?: number;
  minStabilityGrade?: 'A' | 'B' | 'C' | 'D';
  noNewFailures?: boolean;

  // Phase 10: Accessibility (each rule is skipped when no test was scanned)
  maxA11yViolations?: number;
  maxA11yCritical?: number;
  maxA11ySerious?: number;
  // Phase 6: Code coverage (minimum line coverage percentage)
  minCoverage?: number;
  // #70: max % the tests run longer than the median of their passing runs, summed over the tests that have one
  maxDurationRegression?: number;
  // #70: fail on a test that passed on a retry now and on the first attempt in the baseline run
  noNewFlaky?: boolean;
  // #74: fail on a failure cluster that no run in history had
  noNewClusters?: boolean;
  // #77: fail on a quarantine entry past its expiresAt when the quarantine file was written
  noExpiredQuarantine?: boolean;

  // #70: rules with a scope or a severity, evaluated after the rules above
  rules?: QualityGateRule[];
}

/** One rule key per entry. A test is in scope when it matches every scope key, and any value of a key. */
export type QualityGateRule = Omit<QualityGateConfig, 'rules'> & {
  id?: string;                  // Names the rule in the output; unique
  scope?: QualityGateScope;
  severity?: 'fail' | 'warn';   // Default: 'fail'. A breached 'warn' rule is reported but passes the gate.
};

export interface QualityGateScope {
  tag?: string | string[];
  project?: string | string[];
  file?: string | string[];     // CODEOWNERS-style pattern on the test file path, e.g. 'checkout/**'
  owner?: string | string[];
}

export interface QualityGateRuleResult {
  rule: string;
  passed: boolean;
  actual: string;
  threshold: string;
  skipped?: boolean;
  skipReason?: string;
  // Set from a `rules` entry
  id?: string;
  scope?: string;
  severity?: 'warn';
}

export interface QualityGateResult {
  passed: boolean;
  rules: QualityGateRuleResult[];
}

// ============================================================================
// Quarantine
// ============================================================================

export interface QuarantineConfig {
  enabled: boolean;
  threshold?: number;
  maxQuarantined?: number;
  outputFile?: string;
  manualFile?: string;        // Default: .smart-quarantine.manual.json, resolved like outputFile
  expiresAfterDays?: number;  // Sets expiresAt this many days after quarantinedAt, unless the manual file gives one
}

export interface QuarantineEntry {
  testId: string;
  title: string;
  file: string;
  flakinessScore?: number;  // Missing for a manual or annotation entry of a test without a score
  runs?: number;            // Runs behind flakinessScore; missing in files written before 4.0.0
  quarantinedAt: string;    // When the test entered quarantine; kept while it stays
  // The fields below are missing in files written before 4.0.0
  source?: 'auto' | 'manual' | 'annotation';
  owners?: string[];
  ticket?: string;
  reason?: string;
  expiresAt?: string;
}

export interface QuarantineEvent {
  kind: 'quarantined' | 'expired' | 'released';
  entry: QuarantineEntry;
}

export interface QuarantineFile {
  generatedAt: string;
  threshold: number;
  entries: QuarantineEntry[];
}

// ============================================================================
// Live Reporting
// ============================================================================

export interface LiveConfig {
  enabled: boolean;
  outputFile?: string;        // Default: .smart-live-results.jsonl
  dashboard?: boolean;        // Generate smart-live.html alongside report (default: true)
  notifyOnFirstFailure?: boolean; // Send Slack/Teams on first failure
}

export interface LiveEvent {
  event: 'start' | 'test' | 'complete';
  timestamp: string;
}

export interface LiveStartEvent extends LiveEvent {
  event: 'start';
  totalExpected: number;
  ciInfo?: CIInfo;
}

export interface LiveTestEvent extends LiveEvent {
  event: 'test';
  testId: string;
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;
  error?: string;
  retry: number;
  counters: LiveCounters;
}

export interface LiveCompleteEvent extends LiveEvent {
  event: 'complete';
  duration: number;
  counters: LiveCounters;
}

export interface LiveCounters {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  completed: number;
  totalExpected: number;
}

// ============================================================================
// AI Health Digest
// ============================================================================

export interface DigestOptions {
  period: 'daily' | 'weekly' | 'monthly';
  historyFile: string;
  output?: string;
  ai?: boolean;
  format?: 'markdown' | 'text';
}

// ============================================================================
// Phase 7: Flake forecasting
// ============================================================================

export interface ForecastConfig {
  enabled?: boolean;    // Default: true
  minRuns?: number;     // Default: 5; values below 3 are raised to 3
  threshold?: number;   // Default: 0.5; risk at or above this lists the test as at risk
}

export type ForecastSignal = 'duration-drift' | 'duration-variance' | 'retry-trend' | 'outcome-instability';

export interface ForecastReason {
  signal: ForecastSignal;
  detail: string;
  weight: number;       // this signal's contribution to risk, 0-1
}

export type FlakeForecast =
  | { state: 'insufficient-history'; runs: number; minRuns: number }
  | { state: 'scored'; risk: number; reasons: ForecastReason[] };

export interface ForecastSummary {
  atRisk: string[];     // testIds, highest risk first
  threshold: number;
  minRuns: number;
}

// ============================================================================
// Phase 10: Accessibility
// ============================================================================

export interface AccessibilityConfig {
  enabled: boolean;
  standard?: 'WCAG2A' | 'WCAG2AA' | 'WCAG2AAA';
  failOnSeverity?: A11yImpact;
  include?: string[];
  exclude?: string[];
  selector?: string;
}

export type A11yImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface A11yNode {
  target: string[];
  html: string;
  failureSummary: string;
}

export interface A11yViolation {
  id: string;
  impact: A11yImpact;
  description: string;
  helpUrl: string;
  wcagTags: string[];
  nodes: A11yNode[];
}

export interface A11yResult {
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
  inapplicable: number;
  timestamp: string;
  standard: string;
  url?: string;
}

export interface A11yRuleSummary {
  id: string;
  impact: A11yImpact;
  description: string;
  helpUrl: string;
  wcagTags: string[];
  tests: number;
  nodes: number;
  testIds: string[];
}

export interface A11ySummary {
  testsScanned: number;
  testsWithViolations: number;
  pagesScanned: number;
  totalViolations: number;
  byImpact: Record<A11yImpact, number>;
  byRule: A11yRuleSummary[];        // most-hit rule first
  rating: 'excellent' | 'good' | 'fair' | 'poor';
}

// ============================================================================
// Phase 4: Causal failure timeline
// ============================================================================

// All times are ms offsets from the failed attempt's start (TestResult.startTime).

export interface TimelineStep {
  title: string;
  start: number;
  end: number;
  category: string;
  failed?: boolean;
}

export interface TimelineRequest {
  start: number;
  end: number;               // equals start for failed requests; the timeline end for requests still in flight
  method: string;
  url: string;
  status: number;            // -1 when no response arrived
  failure?: string;          // e.g. 'net::ERR_CONNECTION_REFUSED'
}

export interface TimelineConsoleEvent {
  at: number;
  level: string;             // console message type; uncaught page errors are 'error' with an "Uncaught " prefix
  text: string;
}

/**
 * Heuristic suggestion, not a diagnosis: the earliest unusual event before the failure.
 */
export interface TimelineAnomaly {
  kind: 'network-error' | 'console-error' | 'slow-step';
  at: number;
  summary: string;
  ref: { lane: 'network' | 'console' | 'steps'; index: number };
}

export interface CausalTimeline {
  duration: number;
  lanes: {
    steps: TimelineStep[];
    network: TimelineRequest[];
    console: TimelineConsoleEvent[];
  };
  /** Suggestion only (heuristic). Absent when nothing unusual happened before the failure. */
  firstAnomaly?: TimelineAnomaly;
}
