import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportJsonData } from '../generators/json-exporter';
import type { ReportData } from '../report-data/schema';
import type { TestResultData } from '../types';
import {
  assertFailureBundle,
  buildFailureBundle,
  loadFailureBundle,
  parseError,
  writeFailureBundle,
  type AgentFailure,
  type FailureBundle,
} from './failure-bundle';

const FIXTURE_PATH = path.join(__dirname, '__fixtures__', 'report-data.json');
const loadFixture = (): ReportData => JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
const OPTS = { rootDir: '/repo', env: {} };

const LOGIN_POST: AgentFailure['trace']['network'][number] = {
  method: 'POST',
  url: 'https://app.example.test/api/session',
  status: 500,
  statusText: 'Internal Server Error',
  duration: 400,
  timestamp: '2026-10-08T11:59:00.400Z',
  contentType: 'application/json',
  requestHeaders: { Authorization: '[REDACTED]', 'Content-Type': 'application/json' },
  responseHeaders: { 'Set-Cookie': '[REDACTED]', 'Content-Type': 'application/json' },
};

const LOGIN_FAILURE: AgentFailure = {
  id: '[chromium] tests/auth/login.spec.ts::shows the dashboard after login',
  title: 'shows the dashboard after login',
  titlePath: ['Auth', 'Login', 'shows the dashboard after login'],
  file: 'tests/auth/login.spec.ts',
  line: 10,
  column: 5,
  project: 'chromium',
  browser: 'chromium',
  status: 'failed',
  tags: ['@smoke'],
  source: { relative: 'tests/auth/login.spec.ts', absolute: '/repo/tests/auth/login.spec.ts' },
  error: {
    message:
      "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('heading', { name: 'Dashboard' })\nExpected: visible\nTimeout: 5000ms\nError: element(s) not found",
    location: { relative: 'tests/auth/login.spec.ts', absolute: '/repo/tests/auth/login.spec.ts', line: 14, column: 61 },
    stack: ['at /ci/workspace/tests/auth/login.spec.ts:14:61'],
  },
  codeFrame:
    "  12 |   await page.getByLabel('Password').fill(process.env.PASSWORD!);\n  13 |   await page.getByRole('button', { name: 'Sign in' }).click();\n> 14 |   await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();\n     |                                                             ^\n  15 | });",
  callLog: ['- Expect "toBeVisible" with timeout 5000ms', "- waiting for getByRole('heading', { name: 'Dashboard' })"],
  failingStep: { title: 'Expect "toBeVisible"', category: 'expect', start: 1100, end: 6150 },
  attempts: [
    { retry: 0, status: 'failed', duration: 6100, error: 'Error: expect(locator).toBeVisible() failed' },
    { retry: 1, status: 'failed', duration: 6200, error: 'Error: expect(locator).toBeVisible() failed' },
  ],
  network: { totalRequests: 2, failed: [LOGIN_POST] },
  console: [{ at: 1105, level: 'error', text: 'Failed to load resource: the server responded with a status of 500 ()' }],
  anomaly: { kind: 'network-error', at: 700, summary: 'POST /api/session returned 500', ref: { lane: 'network', index: 1 } },
  history: {
    runs: 3,
    passed: 1,
    failed: 1,
    skipped: 1,
    recent: ['passed', 'failed', 'skipped'],
    signals: ['new-failure'],
    flakinessScore: 0.33,
    stabilityGrade: 'C',
    averageDuration: 5200,
  },
  trace: {
    steps: [
      { title: 'Navigate to "/login"', category: 'pw:api', duration: 300, start: 0, end: 300 },
      { title: 'Sign in', category: 'test.step', duration: 5900, start: 300, end: 6200, failed: true },
      { title: 'Expect "toBeVisible"', category: 'expect', duration: 5050, start: 1100, end: 6150, failed: true },
    ],
    network: [
      {
        method: 'GET',
        url: 'https://app.example.test/login',
        status: 200,
        statusText: 'OK',
        duration: 120,
        timestamp: '2026-10-08T11:59:00.100Z',
        contentType: 'text/html',
      },
      LOGIN_POST,
    ],
    console: [
      { at: 50, level: 'log', text: 'app booted' },
      { at: 1105, level: 'error', text: 'Failed to load resource: the server responded with a status of 500 ()' },
    ],
  },
};

const EXPORT_ERROR = {
  message: 'Error: locator.click: Test timeout of 30000ms exceeded.',
  location: { relative: 'tests/pages/export-page.ts', absolute: '/repo/tests/pages/export-page.ts', line: 22, column: 15 },
  stack: [
    'at Locator.click (/repo/node_modules/playwright-core/lib/client/locator.js:107:12)',
    'at ExportPage.download (/repo/tests/pages/export-page.ts:22:15)',
    'at /repo/tests/export.spec.ts:8:3',
  ],
};

const EXPORT_FAILURE: AgentFailure = {
  id: 'tests/export.spec.ts::exports a CSV',
  title: 'exports a CSV',
  titlePath: ['exports a CSV'],
  file: 'tests/export.spec.ts',
  line: 6,
  column: 1,
  status: 'timedOut',
  source: { relative: 'tests/export.spec.ts', absolute: '/repo/tests/export.spec.ts' },
  error: EXPORT_ERROR,
  callLog: ["- waiting for locator('#export')"],
  attempts: [{ retry: 0, status: 'timedOut', duration: 30000, error: 'Error: locator.click: Test timeout of 30000ms exceeded.' }],
  history: { runs: 0, passed: 0, failed: 0, skipped: 0, recent: [], signals: [] },
  trace: { steps: [{ title: "Click locator('#export')", category: 'pw:api', duration: 30000 }], network: [], console: [] },
};

describe('buildFailureBundle', () => {
  it('builds a versioned bundle of exactly the unexpected failures, without bodies or the AI prompt', () => {
    expect(buildFailureBundle(loadFixture(), OPTS)).toStrictEqual({
      format: 'playwright-smart-reporter/failures',
      schemaVersion: 1,
      run: {
        runId: 'run-fixture',
        generatedAt: '2026-10-08T12:00:00.000Z',
        reporterVersion: '3.0.0',
        projectName: 'web',
        ci: { provider: 'github', branch: 'main', commit: 'abc1234', buildId: '42' },
        total: 5,
        failed: 2,
      },
      failures: [LOGIN_FAILURE, EXPORT_FAILURE],
    });
  });

  it('redacts secrets seeded into every text field the bundle copies', () => {
    const t = (...parts: string[]) => parts.join('');
    const secrets = {
      title: t('ghp', '_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'),
      error: t('sk-', 'ant-', 'api03-', 'A'.repeat(24)),
      env: 'env-only-secret-value-42',
      snippet: t('AKIA', 'IOSFODNN7EXAMPLE'),
      attempt: t('xox', 'b-', '1234567890-abcdefghij'),
      url: 'tok-in-url-123',
      header: 'opaque-api-key-value',
      jwt: t('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxIn0', '.', 'c2lnbmF0dXJl'),
      console: t('github', '_pat_', '11ABCDEFG0123456789_abcdefghijklmnop'),
      anomaly: 'anomaly-password-value',
      step: t('sk-', 'proj-', 'B'.repeat(24)),
      branch: 'branch-password-value',
    };
    const data = loadFixture();
    const test = data.tests[0] as ReportData['tests'][number] & { timeline: { lanes: { console: Array<{ text: string }>; steps: Array<{ title: string }> }; firstAnomaly: { summary: string } } };
    test.title = `login as ${secrets.title}`;
    test.suites = ['Auth', `token=${secrets.title}`];
    test.error = `Error: key ${secrets.error} rejected (env ${secrets.env})\n\n    at /repo/tests/auth/login.spec.ts:14:61`;
    test.errorSnippet = `> 14 |   const key = '${secrets.snippet}';`;
    test.attempts![0].error = `Error: slack ${secrets.attempt}`;
    const post = test.networkLogs!.entries[1];
    post.url = `https://app.example.test/api/session?access_token=${secrets.url}`;
    post.requestHeaders = { 'X-Api-Key': secrets.header, 'X-Debug': secrets.jwt };
    test.timeline.lanes.console[1].text = `leaked ${secrets.console}`;
    test.timeline.lanes.steps[1].title = `Sign in with ${secrets.step}`;
    test.timeline.firstAnomaly.summary = `POST failed: password=${secrets.anomaly}`;
    data.meta.ci!.branch = `password=${secrets.branch}`;

    const bundle = buildFailureBundle(data, { rootDir: '/repo', env: { MY_SERVICE_TOKEN: secrets.env } });
    const serialized = JSON.stringify(bundle);
    for (const [field, secret] of Object.entries(secrets)) {
      expect(serialized.includes(secret), `${field} secret leaked`).toBe(false);
    }

    const f = bundle.failures[0];
    expect(f.title).toBe('login as [REDACTED]');
    expect(f.titlePath).toEqual(['Auth', 'token=[REDACTED]', 'login as [REDACTED]']);
    expect(f.error.message).toBe('Error: key [REDACTED] rejected (env [REDACTED])');
    expect(f.codeFrame).toBe("> 14 |   const key = '[REDACTED]';");
    expect(f.attempts[0].error).toBe('Error: slack [REDACTED]');
    expect(f.network!.failed[0]).toStrictEqual({
      ...LOGIN_POST,
      url: 'https://app.example.test/api/session?access_token=[REDACTED]',
      requestHeaders: { 'X-Api-Key': '[REDACTED]', 'X-Debug': '[REDACTED]' },
    });
    expect(f.trace.console[1].text).toBe('leaked [REDACTED]');
    expect(f.trace.steps[1].title).toBe('Sign in with [REDACTED]');
    expect(f.anomaly!.summary).toBe('POST failed: password=[REDACTED]');
    expect(bundle.run.ci!.branch).toBe('password=[REDACTED]');
  });
});

describe('parseError', () => {
  it('returns the whole text as the message when there is no call log or stack', () => {
    expect(parseError('Test timeout of 30000ms exceeded.')).toStrictEqual({
      message: 'Test timeout of 30000ms exceeded.',
      callLog: [],
      stack: [],
      frame: undefined,
    });
  });
});

describe('assertFailureBundle', () => {
  const valid = (): FailureBundle => JSON.parse(JSON.stringify(buildFailureBundle(loadFixture(), OPTS)));

  it('accepts a serialized bundle', () => {
    const bundle = valid();
    expect(assertFailureBundle(bundle)).toBe(bundle);
  });

  it('rejects other formats, other schema versions, and failures missing required fields', () => {
    expect(() => assertFailureBundle({ ...valid(), format: 'ctrf' })).toThrow(
      'Not a failure bundle: format must be "playwright-smart-reporter/failures"',
    );
    expect(() => assertFailureBundle({ ...valid(), schemaVersion: 2 })).toThrow(
      'Unsupported failure bundle schemaVersion 2 (expected 1)',
    );
    const missingId = valid() as unknown as { failures: Array<Record<string, unknown>> };
    delete missingId.failures[1].id;
    expect(() => assertFailureBundle(missingId)).toThrow('Invalid failure bundle: failures[1] is missing required fields');
  });
});

describe('loadFailureBundle and writeFailureBundle', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-bundle-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes <outputBasename>-failures.json and reads it back unchanged', () => {
    const written = writeFailureBundle(loadFixture(), { ...OPTS, outputDir: dir });
    expect(written).toBe(path.join(dir, 'smart-report-failures.json'));
    expect(loadFailureBundle(written, { rootDir: '/elsewhere' }).failures).toStrictEqual([LOGIN_FAILURE, EXPORT_FAILURE]);
  });

  it('builds the bundle from report data JSON and from the external <name>-data.js script', () => {
    const jsFile = path.join(dir, 'smart-report-data.js');
    fs.writeFileSync(jsFile, `window.__SMART_DATA__=${fs.readFileSync(FIXTURE_PATH, 'utf8')};\n`);
    expect(loadFailureBundle(FIXTURE_PATH, OPTS).failures).toStrictEqual([LOGIN_FAILURE, EXPORT_FAILURE]);
    expect(loadFailureBundle(jsFile, OPTS).failures).toStrictEqual([LOGIN_FAILURE, EXPORT_FAILURE]);
  });

  it('builds the bundle from the exportJson output, which carries no steps, lines, or history', () => {
    const jsonFile = exportJsonData(loadFixture().tests as TestResultData[], { runs: [], tests: {} }, 0, {}, undefined, undefined, dir);
    const bundle = loadFailureBundle(jsonFile, OPTS);
    expect(bundle.failures.map((f) => f.id)).toEqual([LOGIN_FAILURE.id, EXPORT_FAILURE.id]);
    expect(bundle.failures[1]).toStrictEqual({
      id: 'tests/export.spec.ts::exports a CSV',
      title: 'exports a CSV',
      titlePath: ['exports a CSV'],
      file: 'tests/export.spec.ts',
      status: 'timedOut',
      source: { relative: 'tests/export.spec.ts', absolute: '/repo/tests/export.spec.ts' },
      error: EXPORT_ERROR,
      callLog: ["- waiting for locator('#export')"],
      attempts: [{ retry: 0, status: 'timedOut', duration: 30000, error: 'Error: locator.click: Test timeout of 30000ms exceeded.' }],
      history: { runs: 0, passed: 0, failed: 0, skipped: 0, recent: [], signals: [] },
      trace: { steps: [], network: [], console: [] },
    });
  });

  it('rejects JSON that is none of the supported inputs', () => {
    const other = path.join(dir, 'other.json');
    fs.writeFileSync(other, '{"hello":"world"}');
    expect(() => loadFailureBundle(other, OPTS)).toThrow(`${other} is not a failure bundle, report data, or JSON export`);
  });
});
