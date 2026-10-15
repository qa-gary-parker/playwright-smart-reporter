import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { AttemptData, CIInfo, SmartReporterOptions, TestResultData } from '../types';
import { parseError } from '../utils/error-stack';

// https://github.com/ctrf-io/ctrf/blob/v0.1.0/spec/ctrf.md
export const CTRF_SPEC_VERSION = '0.1.0';

export type CtrfStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'other';

interface CtrfAttempt {
  attempt: number;
  status: CtrfStatus;
  duration: number;
  message?: string;
  trace?: string;
}

export interface CtrfTest {
  testId: string;
  name: string;
  status: CtrfStatus;
  rawStatus: string;
  duration: number;
  suite?: string[];
  message?: string;
  trace?: string;
  snippet?: string;
  ai?: string;
  line?: number;
  tags?: string[];
  filePath: string;
  retries: number;
  retryAttempts?: CtrfAttempt[];
  flaky?: boolean;
  browser?: string;
  extra?: { project: string };
}

export interface CtrfReport {
  reportFormat: 'CTRF';
  specVersion: string;
  reportId: string;
  timestamp: string;
  generatedBy: string;
  runId?: string;
  results: {
    tool: { name: 'playwright'; version?: string };
    summary: {
      tests: number;
      passed: number;
      failed: number;
      skipped: number;
      pending: number;
      other: number;
      flaky: number;
      start: number;
      stop: number;
      duration: number;
    };
    tests: CtrfTest[];
    environment?: { reportName?: string; branchName?: string; commit?: string; buildId?: string };
  };
}

export interface CtrfContext {
  reportId: string;
  startTime: number;
  stopTime: number;
  playwrightVersion?: string;
  runId?: string;
  projectName?: string;
  ciInfo?: CIInfo;
}

function attemptStatus(status: AttemptData['status']): CtrfStatus {
  if (status === 'passed') return 'passed';
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'other';
  return 'failed';
}

// Playwright's outcome is authoritative: flaky and expected failures (test.fail()) passed, unexpected ones failed.
export function ctrfStatus(r: Pick<TestResultData, 'status' | 'outcome'>): CtrfStatus {
  if (r.status === 'interrupted') return 'other';
  if (r.status === 'skipped' || r.outcome === 'skipped') return 'skipped';
  if (r.outcome === 'flaky' || r.outcome === 'expected') return 'passed';
  if (r.outcome === 'unexpected') return 'failed';
  return attemptStatus(r.status);
}

function errorFields(error: string | undefined): { message?: string; trace?: string } {
  if (!error) return {};
  return { message: parseError(error).message || undefined, trace: error };
}

function toCtrfTest(r: TestResultData): CtrfTest {
  const status = ctrfStatus(r);
  const previous = (r.attempts ?? []).filter((a) => a.retry < r.retry);
  const test: CtrfTest = {
    testId: r.testId,
    name: r.title || r.testId,
    status,
    rawStatus: r.status,
    duration: Math.round(r.duration),
    filePath: r.file,
    retries: previous.length,
  };
  if (r.suites?.length) test.suite = r.suites;
  Object.assign(test, errorFields(r.error));
  if (r.errorSnippet) test.snippet = r.errorSnippet;
  if (r.aiSuggestion) test.ai = r.aiSuggestion;
  if (r.line !== undefined) test.line = r.line;
  if (r.tags?.length) test.tags = r.tags;
  if (previous.length > 0) {
    test.retryAttempts = previous.map((a, i) => ({
      attempt: i + 1,
      status: attemptStatus(a.status),
      duration: Math.round(a.duration),
      ...errorFields(a.error),
    }));
  }
  if (r.outcome === 'flaky') test.flaky = true;
  if (r.browser) test.browser = r.browser;
  if (r.project) test.extra = { project: r.project };
  return test;
}

export function buildCtrfReport(results: TestResultData[], ctx: CtrfContext): CtrfReport {
  const tests = results.map(toCtrfTest);
  const count = (s: CtrfStatus) => tests.filter((t) => t.status === s).length;
  const environment: NonNullable<CtrfReport['results']['environment']> = {};
  if (ctx.projectName) environment.reportName = ctx.projectName;
  if (ctx.ciInfo?.branch) environment.branchName = ctx.ciInfo.branch;
  if (ctx.ciInfo?.commit) environment.commit = ctx.ciInfo.commit;
  if (ctx.ciInfo?.buildId) environment.buildId = ctx.ciInfo.buildId;

  const report: CtrfReport = {
    reportFormat: 'CTRF',
    specVersion: CTRF_SPEC_VERSION,
    reportId: ctx.reportId,
    timestamp: new Date(ctx.stopTime).toISOString(),
    generatedBy: 'playwright-smart-reporter',
    results: {
      tool: ctx.playwrightVersion ? { name: 'playwright', version: ctx.playwrightVersion } : { name: 'playwright' },
      summary: {
        tests: tests.length,
        passed: count('passed'),
        failed: count('failed'),
        skipped: count('skipped'),
        pending: count('pending'),
        other: count('other'),
        flaky: tests.filter((t) => t.flaky).length,
        start: Math.round(ctx.startTime),
        stop: Math.round(ctx.stopTime),
        duration: Math.round(ctx.stopTime - ctx.startTime),
      },
      tests,
    },
  };
  if (ctx.runId) report.runId = ctx.runId;
  if (Object.keys(environment).length > 0) report.results.environment = environment;
  return report;
}

export function exportCtrfReport(
  results: TestResultData[],
  startTime: number,
  options: SmartReporterOptions,
  outputDir: string,
  basename = 'smart-report',
  context: { playwrightVersion?: string; ciInfo?: CIInfo } = {},
): string {
  const report = buildCtrfReport(results, {
    reportId: randomUUID(),
    startTime,
    stopTime: Date.now(),
    runId: options.runId,
    projectName: options.projectName,
    ...context,
  });
  const outputPath = path.resolve(outputDir, `${basename}-ctrf.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  return outputPath;
}
