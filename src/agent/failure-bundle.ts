import * as fs from 'fs';
import * as path from 'path';
import type { JsonExportData } from '../generators/json-exporter';
import { SCHEMA_VERSION, type ReportData, type ReportTest, type Signal } from '../report-data/schema';
import type { AttemptData, CIInfo, NetworkLogEntry } from '../types';
import { divergenceSummary } from '../analyzers/attempt-compare';
import { createRedactor } from './redact';

export const FAILURE_BUNDLE_FORMAT = 'playwright-smart-reporter/failures';
export const FAILURE_BUNDLE_SCHEMA_VERSION = 1;

// Phase 4 adds ReportTest.timeline; read it structurally so the bundle works with or without it.
interface TimelineData {
  duration: number;
  lanes: {
    steps: Array<{ title: string; start: number; end: number; category: string; failed?: boolean }>;
    network: Array<{ start: number; end: number; method: string; url: string; status: number }>;
    console: Array<{ at: number; level: string; text: string }>;
  };
  firstAnomaly?: {
    kind: 'network-error' | 'console-error' | 'slow-step';
    at: number;
    summary: string;
    ref: { lane: 'network' | 'console' | 'steps'; index: number };
  };
}

type SourceTest = ReportTest & { timeline?: TimelineData };

export interface FailureBundleSource {
  meta: Pick<ReportData['meta'], 'generatedAt' | 'reporterVersion' | 'projectName' | 'ci'> & { runId?: string };
  tests: SourceTest[];
}

export interface SourcePath {
  relative: string;
  absolute: string;
}

export interface AgentNetworkEntry {
  method: string;
  url: string;
  status: number;
  statusText: string;
  duration: number;
  timestamp?: string;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface AgentConsoleEntry {
  at: number;
  level: string;
  text: string;
}

export interface AgentStep {
  title: string;
  category: string;
  duration: number;
  start?: number;
  end?: number;
  failed?: boolean;
}

export interface AgentAttempt {
  retry: number;
  status: string;
  duration: number;
  error?: string;
}

export interface AgentHistory {
  runs: number;
  passed: number;
  failed: number;
  skipped: number;
  recent: Array<'passed' | 'failed' | 'skipped'>;
  signals: Signal[];
  flakinessScore?: number;
  stabilityGrade?: string;
  averageDuration?: number;
}

export interface AgentFailure {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  line?: number;
  column?: number;
  project?: string;
  browser?: string;
  status: string;
  tags?: string[];
  source: SourcePath;
  error: {
    message: string;
    location?: SourcePath & { line: number; column: number };
    stack: string[];
  };
  codeFrame?: string;
  callLog: string[];
  failingStep?: { title: string; category: string; start: number; end: number };
  attempts: AgentAttempt[];
  divergence?: string;
  network?: { totalRequests: number; failed: AgentNetworkEntry[] };
  console?: AgentConsoleEntry[];
  anomaly?: TimelineData['firstAnomaly'];
  history: AgentHistory;
  trace: { steps: AgentStep[]; network: AgentNetworkEntry[]; console: AgentConsoleEntry[] };
}

export interface FailureBundle {
  format: typeof FAILURE_BUNDLE_FORMAT;
  schemaVersion: typeof FAILURE_BUNDLE_SCHEMA_VERSION;
  run: {
    runId?: string;
    generatedAt: string;
    reporterVersion?: string;
    projectName?: string;
    ci?: CIInfo;
    total: number;
    failed: number;
  };
  failures: AgentFailure[];
}

export interface FailureBundleOptions {
  // Directory test files are relative to (Playwright rootDir, or cwd with relativeToCwd).
  rootDir: string;
  env?: NodeJS.ProcessEnv;
}

const RECENT_RUNS = 10;
const STACK_FRAME = /^\s*at (?:.*? \()?(.+?):(\d+):(\d+)\)?$/;

export function isFailure(t: Pick<ReportTest, 'status' | 'outcome'>): boolean {
  const failed = t.status === 'failed' || t.status === 'timedOut';
  return t.outcome ? t.outcome === 'unexpected' && failed : failed;
}

export function parseError(raw: string): {
  message: string;
  callLog: string[];
  stack: string[];
  frame?: { file: string; line: number; column: number };
} {
  const lines = raw.split(/\r?\n/);
  const isFrame = (l: string) => /^\s+at /.test(l);
  const callLogAt = lines.findIndex((l) => /^\s*Call log:\s*$/.test(l));
  const firstFrame = lines.findIndex(isFrame);
  const messageEnd = Math.min(...[callLogAt, firstFrame, lines.length].filter((i) => i >= 0));

  const callLog: string[] = [];
  if (callLogAt >= 0) {
    for (const l of lines.slice(callLogAt + 1)) {
      if (isFrame(l)) break;
      if (l.trim()) callLog.push(l.replace(/^ {2}/, '').trimEnd());
    }
  }

  const stack = lines.filter(isFrame).map((l) => l.trim());
  let frame: { file: string; line: number; column: number } | undefined;
  for (const l of stack) {
    const m = STACK_FRAME.exec(l);
    if (m && !m[1].includes('node_modules') && !m[1].startsWith('node:') && !m[1].startsWith('internal/')) {
      frame = { file: m[1], line: Number(m[2]), column: Number(m[3]) };
      break;
    }
  }

  return { message: lines.slice(0, messageEnd).join('\n').trim(), callLog, stack, frame };
}

function sourcePath(rootDir: string, file: string): SourcePath {
  const absolute = path.resolve(rootDir, file);
  return { relative: path.relative(rootDir, absolute).split(path.sep).join('/'), absolute };
}

function toNetworkEntry(e: NetworkLogEntry): AgentNetworkEntry {
  // Bodies are dropped, not redacted: they are the likeliest place for secrets and PII.
  return {
    method: e.method,
    url: e.url,
    status: e.status,
    statusText: e.statusText,
    duration: e.duration,
    ...(e.timestamp !== undefined && { timestamp: e.timestamp }),
    ...(e.contentType !== undefined && { contentType: e.contentType }),
    ...(e.requestHeaders && { requestHeaders: e.requestHeaders }),
    ...(e.responseHeaders && { responseHeaders: e.responseHeaders }),
  };
}

// The leaf that failed ends first; its ancestors end with or after it.
function failingStep(t: SourceTest): AgentFailure['failingStep'] {
  let best: TimelineData['lanes']['steps'][number] | undefined;
  for (const s of t.timeline?.lanes.steps ?? []) {
    if (!s.failed) continue;
    if (!best || s.end < best.end || (s.end === best.end && s.start >= best.start)) best = s;
  }
  return best && { title: best.title, category: best.category, start: best.start, end: best.end };
}

function toFailure(t: SourceTest, rootDir: string): AgentFailure {
  const parsed = parseError(t.error ?? '');
  const location = t.errorLocation ?? parsed.frame;
  const entries = (t.networkLogs?.entries ?? []).map(toNetworkEntry);
  const consoleEntries = t.timeline?.lanes.console ?? [];
  const history = t.history ?? [];
  const outcomeOf = (h: (typeof history)[number]) => (h.skipped ? 'skipped' : h.passed ? 'passed' : 'failed');
  const recent = history.slice(-RECENT_RUNS).map(outcomeOf);
  const attempts: AttemptData[] = t.attempts?.length
    ? t.attempts
    : [{ retry: t.retry, status: t.status, duration: t.duration, error: t.error, steps: [] }];
  const step = failingStep(t);
  const divergence = divergenceSummary(attempts);

  return {
    id: t.testId,
    title: t.title,
    titlePath: [...(t.suites ?? []), t.title],
    file: t.file,
    ...(t.line !== undefined && { line: t.line }),
    ...(t.column !== undefined && { column: t.column }),
    ...(t.project && { project: t.project }),
    ...(t.browser && { browser: t.browser }),
    status: t.status,
    ...(t.tags?.length && { tags: t.tags }),
    source: sourcePath(rootDir, t.file),
    error: {
      message: parsed.message,
      ...(location && { location: { ...sourcePath(rootDir, location.file), line: location.line, column: location.column } }),
      stack: parsed.stack,
    },
    ...(t.errorSnippet && { codeFrame: t.errorSnippet }),
    callLog: parsed.callLog,
    ...(step && { failingStep: step }),
    attempts: attempts.map((a) => ({
      retry: a.retry,
      status: a.status,
      duration: a.duration,
      ...(a.error && { error: parseError(a.error).message }),
    })),
    ...(divergence && { divergence }),
    ...(t.networkLogs && {
      network: { totalRequests: t.networkLogs.totalRequests, failed: entries.filter((e) => e.status >= 400 || e.status <= 0) },
    }),
    ...(t.timeline && { console: consoleEntries.filter((c) => /^(error|warn)/i.test(c.level)) }),
    ...(t.timeline?.firstAnomaly && { anomaly: t.timeline.firstAnomaly }),
    history: {
      runs: history.length,
      passed: history.filter((h) => outcomeOf(h) === 'passed').length,
      failed: history.filter((h) => outcomeOf(h) === 'failed').length,
      skipped: history.filter((h) => outcomeOf(h) === 'skipped').length,
      recent,
      signals: t.signals ?? [],
      ...(t.flakinessScore !== undefined && { flakinessScore: t.flakinessScore }),
      ...(t.stabilityScore?.grade && { stabilityGrade: t.stabilityScore.grade }),
      ...(t.averageDuration !== undefined && { averageDuration: t.averageDuration }),
    },
    trace: {
      steps: t.timeline
        ? t.timeline.lanes.steps.map((s) => ({
            title: s.title,
            category: s.category,
            duration: s.end - s.start,
            start: s.start,
            end: s.end,
            ...(s.failed && { failed: true }),
          }))
        : t.steps.map((s) => ({ title: s.title, category: s.category, duration: s.duration })),
      network: entries,
      console: consoleEntries,
    },
  };
}

export function buildFailureBundle(source: FailureBundleSource, opts: FailureBundleOptions): FailureBundle {
  const redact = createRedactor(opts.env);
  const failures = source.tests.filter(isFailure).map((t) => toFailure(t, opts.rootDir));
  const { meta } = source;
  // One redaction pass over the finished bundle, so no field can be missed. Ids and paths stay exact:
  // they are how a failure is looked up, and they come from the code, not from the run.
  const bundle = redact.deep<FailureBundle>({
    format: FAILURE_BUNDLE_FORMAT,
    schemaVersion: FAILURE_BUNDLE_SCHEMA_VERSION,
    run: {
      ...(meta.runId && { runId: meta.runId }),
      generatedAt: meta.generatedAt,
      ...(meta.reporterVersion && { reporterVersion: meta.reporterVersion }),
      ...(meta.projectName && { projectName: meta.projectName }),
      ...(meta.ci && { ci: meta.ci }),
      total: source.tests.length,
      failed: failures.length,
    },
    failures,
  });
  bundle.failures = bundle.failures.map((f, i) => ({ ...f, id: failures[i].id, file: failures[i].file, source: failures[i].source }));
  return bundle;
}

export function assertFailureBundle(value: unknown): FailureBundle {
  const b = value as Partial<FailureBundle> | null;
  if (!b || b.format !== FAILURE_BUNDLE_FORMAT) {
    throw new Error(`Not a failure bundle: format must be "${FAILURE_BUNDLE_FORMAT}"`);
  }
  if (b.schemaVersion !== FAILURE_BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported failure bundle schemaVersion ${String(b.schemaVersion)} (expected ${FAILURE_BUNDLE_SCHEMA_VERSION})`);
  }
  if (!b.run || typeof b.run.generatedAt !== 'string' || !Array.isArray(b.failures)) {
    throw new Error('Invalid failure bundle: run.generatedAt and failures[] are required');
  }
  b.failures.forEach((f, i) => {
    const ok =
      f &&
      typeof f.id === 'string' &&
      typeof f.title === 'string' &&
      typeof f.file === 'string' &&
      typeof f.error?.message === 'string' &&
      Array.isArray(f.callLog) &&
      Array.isArray(f.attempts) &&
      Array.isArray(f.trace?.steps) &&
      Array.isArray(f.trace?.network) &&
      Array.isArray(f.trace?.console);
    if (!ok) throw new Error(`Invalid failure bundle: failures[${i}] is missing required fields`);
  });
  return b as FailureBundle;
}

function fromJsonExport(data: JsonExportData): FailureBundleSource {
  return {
    meta: {
      generatedAt: data.metadata.generatedAt,
      reporterVersion: data.metadata.reporterVersion,
      projectName: data.metadata.projectName,
    },
    tests: data.tests.map(({ stabilityScore, ...t }) => ({
      ...(t as unknown as ReportTest),
      suites: t.suite ? [t.suite] : undefined,
      stabilityScore: stabilityScore && ({ grade: stabilityScore.grade } as ReportTest['stabilityScore']),
      steps: [],
      history: [],
      signals: [],
    })),
  };
}

// Accepts a failure bundle, a ReportData payload (JSON or the external <name>-data.js), or the exportJson output.
export function loadFailureBundle(file: string, opts: FailureBundleOptions): FailureBundle {
  let text = fs.readFileSync(file, 'utf8');
  const assignment = /^\s*window\.__SMART_DATA__\s*=/.exec(text);
  if (assignment) text = text.slice(assignment[0].length).replace(/;\s*$/, '');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (data?.format === FAILURE_BUNDLE_FORMAT) return assertFailureBundle(data);
  // 3.x report data (schemaVersion 3) has the same tests and meta, the only fields the bundle reads.
  if ([3, SCHEMA_VERSION].includes(data?.schemaVersion) && data.meta && Array.isArray(data.tests)) return buildFailureBundle(data, opts);
  if (data?.metadata && Array.isArray(data.tests)) return buildFailureBundle(fromJsonExport(data), opts);
  throw new Error(`${file} is not a failure bundle, report data, or JSON export`);
}

export function writeFailureBundle(data: ReportData, opts: FailureBundleOptions & { outputDir: string }): string {
  const outputPath = path.join(opts.outputDir, `${data.meta.outputBasename}-failures.json`);
  fs.mkdirSync(opts.outputDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(buildFailureBundle(data, opts), null, 2));
  return outputPath;
}

export function summarizeFailure(f: AgentFailure) {
  return {
    id: f.id,
    title: f.title,
    location: `${f.file}${f.line !== undefined ? `:${f.line}` : ''}`,
    ...(f.project && { project: f.project }),
    status: f.status,
    error: f.error.message.split('\n')[0],
    ...(f.anomaly && { anomaly: f.anomaly.summary }),
  };
}

const indent = (text: string, by: string) => text.split('\n').map((l) => (l ? by + l : l));

export function formatFailureText(f: AgentFailure): string {
  const out = [f.id, `  ${[`${f.file}${f.line !== undefined ? `:${f.line}` : ''}`, f.project, f.status].filter(Boolean).join(' · ')}`];
  out.push(...indent(f.error.message, '  '));
  if (f.error.location) out.push(`  at ${f.error.location.relative}:${f.error.location.line}:${f.error.location.column}`);
  if (f.codeFrame) out.push(...indent(f.codeFrame, '  '));
  if (f.failingStep) out.push(`  Failing step: ${f.failingStep.title} at ${f.failingStep.start}ms for ${f.failingStep.end - f.failingStep.start}ms`);
  if (f.callLog.length > 0) out.push('  Call log:', ...f.callLog.map((l) => `    ${l}`));
  if (f.anomaly) out.push(`  Possible first anomaly: ${f.anomaly.summary} at ${f.anomaly.at}ms`);
  if (f.network && f.network.failed.length > 0) {
    out.push(`  Failed requests (${f.network.failed.length} of ${f.network.totalRequests}):`);
    out.push(...f.network.failed.map((n) => `    ${n.method} ${n.url} ${n.status} ${n.statusText}`.trimEnd()));
  }
  if (f.console && f.console.length > 0) out.push('  Console:', ...f.console.map((c) => `    ${c.level} at ${c.at}ms: ${c.text}`));
  if (f.attempts.length > 1) out.push(`  Attempts: ${f.attempts.map((a) => `${a.status} in ${a.duration}ms`).join(', ')}`);
  if (f.divergence) out.push(`    ${f.divergence}`);
  const signals = f.history.signals.length > 0 ? ` · signals: ${f.history.signals.join(', ')}` : '';
  out.push(f.history.recent.length > 0 ? `  History (last ${f.history.recent.length} runs): ${f.history.recent.join(', ')}${signals}` : `  History: no earlier runs${signals}`);
  return out.join('\n');
}
