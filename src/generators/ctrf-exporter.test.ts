import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildCtrfReport, exportCtrfReport } from './ctrf-exporter';
import type { TestResultData } from '../types';

// Official schema, vendored unmodified; source and licence in __fixtures__/ctrf/LICENSE.
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__/ctrf/ctrf.schema.json'), 'utf-8'));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function schemaErrors(doc: unknown): string[] {
  return validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const SPEC_ERROR = 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1\n    at /work/tests/cart.spec.ts:6:17';

function result(overrides: Partial<TestResultData>): TestResultData {
  return { testId: 'id', title: 'title', file: 'cart.spec.ts', status: 'passed', duration: 10, retry: 0, steps: [], history: [], ...overrides };
}

const results: TestResultData[] = [
  result({
    testId: 'cart-total', title: 'cart total @smoke', line: 4, column: 5, status: 'failed', outcome: 'unexpected', retry: 1, duration: 120.6,
    error: SPEC_ERROR, errorSnippet: '> 6 |   expect(value).toBe(2);', suites: ['Cart'], tags: ['@smoke'], browser: 'chromium', project: 'Desktop Chrome',
    attempts: [
      { retry: 0, status: 'failed', duration: 100.4, error: SPEC_ERROR, steps: [] },
      { retry: 1, status: 'failed', duration: 120.6, error: SPEC_ERROR, steps: [] },
    ],
  }),
  result({
    testId: 'flaky-login', title: 'login', status: 'passed', outcome: 'flaky', retry: 1, duration: 30,
    attempts: [
      { retry: 0, status: 'timedOut', duration: 2000, error: 'Test timeout of 2000ms exceeded.', steps: [] },
      { retry: 1, status: 'passed', duration: 30, steps: [] },
    ],
  }),
  result({ testId: 'slow', title: 'times out', status: 'timedOut', outcome: 'unexpected', duration: 2000, error: 'Test timeout of 2000ms exceeded.' }),
  result({ testId: 'cut-off', title: 'interrupted', status: 'interrupted', outcome: 'unexpected', duration: 5 }),
  result({ testId: 'later', title: 'skipped', status: 'skipped', outcome: 'skipped', duration: 0 }),
  result({ testId: 'known-bug', title: 'expected to fail', status: 'failed', outcome: 'expected', duration: 7, error: 'Error: known' }),
];

const ctx = {
  reportId: '7d4f6c1e-2b8a-4c3d-9e5f-0a1b2c3d4e5f',
  startTime: 1_760_000_000_000,
  stopTime: 1_760_000_004_321,
  playwrightVersion: '1.57.0',
  runId: 'gh-123',
  projectName: 'shop',
  ciInfo: { provider: 'github', branch: 'feat/cart', commit: 'abc12345', buildId: '987' },
};

describe('buildCtrfReport', () => {
  it('maps Playwright results to CTRF with exact statuses, retries and summary', () => {
    expect(buildCtrfReport(results, ctx)).toEqual({
      reportFormat: 'CTRF',
      specVersion: '0.1.0',
      reportId: '7d4f6c1e-2b8a-4c3d-9e5f-0a1b2c3d4e5f',
      timestamp: '2025-10-09T08:53:24.321Z',
      generatedBy: 'playwright-smart-reporter',
      runId: 'gh-123',
      results: {
        tool: { name: 'playwright', version: '1.57.0' },
        summary: { tests: 6, passed: 2, failed: 2, skipped: 1, pending: 0, other: 1, flaky: 1, start: 1_760_000_000_000, stop: 1_760_000_004_321, duration: 4321 },
        tests: [
          {
            testId: 'cart-total', name: 'cart total @smoke', status: 'failed', rawStatus: 'failed', duration: 121, filePath: 'cart.spec.ts',
            retries: 1, suite: ['Cart'],
            message: 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1',
            trace: SPEC_ERROR, snippet: '> 6 |   expect(value).toBe(2);', line: 4, tags: ['@smoke'],
            retryAttempts: [{
              attempt: 1, status: 'failed', duration: 100,
              message: 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1', trace: SPEC_ERROR,
            }],
            browser: 'chromium', extra: { project: 'Desktop Chrome' },
          },
          {
            testId: 'flaky-login', name: 'login', status: 'passed', rawStatus: 'passed', duration: 30, filePath: 'cart.spec.ts', retries: 1,
            retryAttempts: [{ attempt: 1, status: 'failed', duration: 2000, message: 'Test timeout of 2000ms exceeded.', trace: 'Test timeout of 2000ms exceeded.' }],
            flaky: true,
          },
          {
            testId: 'slow', name: 'times out', status: 'failed', rawStatus: 'timedOut', duration: 2000, filePath: 'cart.spec.ts', retries: 0,
            message: 'Test timeout of 2000ms exceeded.', trace: 'Test timeout of 2000ms exceeded.',
          },
          { testId: 'cut-off', name: 'interrupted', status: 'other', rawStatus: 'interrupted', duration: 5, filePath: 'cart.spec.ts', retries: 0 },
          { testId: 'later', name: 'skipped', status: 'skipped', rawStatus: 'skipped', duration: 0, filePath: 'cart.spec.ts', retries: 0 },
          {
            testId: 'known-bug', name: 'expected to fail', status: 'passed', rawStatus: 'failed', duration: 7, filePath: 'cart.spec.ts', retries: 0,
            message: 'Error: known', trace: 'Error: known',
          },
        ],
        environment: { reportName: 'shop', branchName: 'feat/cart', commit: 'abc12345', buildId: '987' },
      },
    });
  });

  it('produces a document the official CTRF schema accepts', () => {
    expect(schemaErrors(buildCtrfReport(results, ctx))).toEqual([]);
  });

  it('omits optional blocks when there is no CI, run id or Playwright version', () => {
    const report = buildCtrfReport([result({ testId: 'a', title: 'a' })], { reportId: ctx.reportId, startTime: 0, stopTime: 5 });
    expect(report.runId).toBeUndefined();
    expect(report.results.environment).toBeUndefined();
    expect(report.results.tool).toEqual({ name: 'playwright' });
    expect(schemaErrors(report)).toEqual([]);
  });

  it('is checked by a schema validator that rejects non-CTRF statuses', () => {
    const report = buildCtrfReport(results, ctx);
    const broken = { ...report, results: { ...report.results, tests: [{ ...report.results.tests[2], status: 'timedOut' }] } };
    expect(schemaErrors(broken)).toEqual(['/results/tests/0/status must be equal to one of the allowed values']);
  });
});

describe('exportCtrfReport', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes <basename>-ctrf.json next to the report with a fresh UUID reportId', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrf-'));
    const written = exportCtrfReport(results, Date.now() - 1000, { runId: 'r1' }, dir, 'smart-report', { playwrightVersion: '1.57.0' });

    expect(written).toBe(path.join(dir, 'smart-report-ctrf.json'));
    const doc = JSON.parse(fs.readFileSync(written, 'utf-8'));
    expect(schemaErrors(doc)).toEqual([]);
    expect(doc.reportId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(doc.runId).toBe('r1');
    expect(doc.results.summary.failed).toBe(2);
  });
});
