import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { buildMetrics, exportMetrics, pushMetrics, toOtlp, toPrometheus } from './metrics-exporter';
import type { TestResultData } from '../types';

function result(overrides: Partial<TestResultData>): TestResultData {
  return { testId: 'id', title: 'title', file: 'cart.spec.ts', status: 'passed', duration: 10, retry: 0, steps: [], history: [], ...overrides };
}

const attempt = (retry: number, status: TestResultData['status'], duration: number) => ({ retry, status, duration, steps: [] });

// Three suites: chromium/cart.spec.ts has every verdict, chromium/search.spec.ts ran nothing, and an
// unnamed project's file has a Windows path.
const results: TestResultData[] = [
  result({ testId: '[chromium] cart.spec.ts::adds item', project: 'chromium', status: 'passed', outcome: 'expected', duration: 1200, attempts: [attempt(0, 'passed', 1200)] }),
  result({
    testId: '[chromium] cart.spec.ts::login', project: 'chromium', status: 'passed', outcome: 'flaky', retry: 1, duration: 300,
    attempts: [attempt(0, 'timedOut', 2000), attempt(1, 'passed', 300)],
  }),
  result({ testId: '[chromium] cart.spec.ts::known bug', project: 'chromium', status: 'failed', outcome: 'expected', duration: 7, attempts: [attempt(0, 'failed', 7)] }),
  result({
    testId: '[chromium] cart.spec.ts::checkout › says "hi" C:\\temp\nline 2', project: 'chromium', status: 'failed', outcome: 'unexpected', retry: 1, duration: 450,
    attempts: [attempt(0, 'failed', 500), attempt(1, 'failed', 450)],
  }),
  result({ testId: '[chromium] cart.spec.ts::later', project: 'chromium', status: 'skipped', outcome: 'skipped', duration: 0, attempts: [attempt(0, 'skipped', 0)] }),
  result({ testId: '[chromium] search.spec.ts::filters', project: 'chromium', file: 'search.spec.ts', status: 'skipped', outcome: 'skipped', duration: 0 }),
  result({ testId: 'api/users.spec.ts::lists users', file: 'api\\users.spec.ts', status: 'passed', outcome: 'expected', duration: 80.4, attempts: [attempt(0, 'passed', 80.4)] }),
  result({ testId: 'api/users.spec.ts::deletes user', file: 'api\\users.spec.ts', status: 'failed', outcome: 'unexpected', duration: 95, attempts: [attempt(0, 'failed', 95)] }),
];

const ctx = { duration: 65_432, branch: 'feature/cart' };
const golden = () => fs.readFileSync(path.join(__dirname, '__fixtures__/metrics/run.prom'), 'utf8');

describe('toPrometheus', () => {
  it('writes the run in the Prometheus text format, the same as the golden file', () => {
    expect(toPrometheus(buildMetrics(results, ctx))).toBe(golden());
  });
});

describe('toOtlp', () => {
  it('writes the same metrics as an OTLP JSON gauge per metric, with 64-bit integers as strings', () => {
    const one = [results[0]];
    const at = [
      { key: 'project', value: { stringValue: 'chromium' } },
      { key: 'suite', value: { stringValue: 'cart.spec.ts' } },
    ];
    const timeUnixNano = '1760000004321000000';
    const gauge = (name: string, description: string, unit: string, point: object) => ({ name, description, unit, gauge: { dataPoints: [{ timeUnixNano, ...point }] } });

    expect(toOtlp(buildMetrics(one, { duration: 1500 }), 1_760_000_004_321)).toEqual({
      resourceMetrics: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'playwright-smart-reporter' } }] },
        scopeMetrics: [{
          scope: { name: 'playwright-smart-reporter' },
          metrics: [
            gauge('smart_reporter_tests', 'Tests in the run.', '{test}', { attributes: at, asInt: '1' }),
            gauge('smart_reporter_tests_passed', 'Tests that passed, passed on a retry, or failed as test.fail() expected.', '{test}', { attributes: at, asInt: '1' }),
            gauge('smart_reporter_tests_failed', 'Tests that failed, including a test.fail() test that passed.', '{test}', { attributes: at, asInt: '0' }),
            gauge('smart_reporter_tests_flaky', 'Tests that passed on a retry.', '{test}', { attributes: at, asInt: '0' }),
            gauge('smart_reporter_tests_skipped', 'Tests that did not run: skipped, never started, or interrupted.', '{test}', { attributes: at, asInt: '0' }),
            gauge('smart_reporter_pass_ratio', 'Passed tests out of the tests that ran. No sample for a suite where no test ran.', '1', { attributes: at, asDouble: 1 }),
            gauge('smart_reporter_retry_waste_seconds', 'Time in the attempts that Playwright retried.', 's', { attributes: at, asDouble: 0 }),
            gauge('smart_reporter_run_duration_seconds', 'Duration of the run.', 's', { attributes: [], asDouble: 1.5 }),
            gauge('smart_reporter_test_duration_seconds', 'Duration of the last attempt of each test that ran.', 's', {
              attributes: [...at, { key: 'test_id', value: { stringValue: '[chromium] cart.spec.ts::adds item' } }], asDouble: 1.2,
            }),
          ],
        }],
      }],
    });
  });
});

describe('exportMetrics', () => {
  let dir: string;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes <name>-metrics.prom and <name>-metrics.otlp.json beside the report', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
    const written = exportMetrics(results, { ...ctx, time: 1_760_000_004_321 }, dir, 'nightly');

    expect(fs.readdirSync(dir).sort()).toEqual(['nightly-metrics.otlp.json', 'nightly-metrics.prom']);
    expect(written.files).toEqual([path.join(dir, 'nightly-metrics.prom'), path.join(dir, 'nightly-metrics.otlp.json')]);
    expect(fs.readFileSync(path.join(dir, 'nightly-metrics.prom'), 'utf8')).toBe(golden());
    const otlp = JSON.parse(fs.readFileSync(path.join(dir, 'nightly-metrics.otlp.json'), 'utf8'));
    expect(otlp.resourceMetrics[0].scopeMetrics[0].metrics.map((m: { name: string }) => m.name)).toEqual([
      'smart_reporter_tests', 'smart_reporter_tests_passed', 'smart_reporter_tests_failed', 'smart_reporter_tests_flaky',
      'smart_reporter_tests_skipped', 'smart_reporter_pass_ratio', 'smart_reporter_retry_waste_seconds',
      'smart_reporter_run_duration_seconds', 'smart_reporter_test_duration_seconds',
    ]);
  });
});

describe('pushMetrics', () => {
  let server: Server;
  let baseUrl: string;
  let requests: Array<{ method?: string; url?: string; contentType?: string; authorization?: string; body: string }>;
  let reply: (res: import('http').ServerResponse) => void;
  const bodies = { prometheus: 'smart_reporter_tests 1\n', otlp: '{"resourceMetrics":[]}' };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, contentType: req.headers['content-type'], authorization: req.headers.authorization, body });
        reply(res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const warnings = () => {
    requests = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs the Prometheus text to a Pushgateway with its content type and the configured headers', async () => {
    const warn = warnings();
    reply = (res) => { res.writeHead(200); res.end(); };
    await pushMetrics({ url: `${baseUrl}/metrics/job/playwright`, headers: { Authorization: 'Basic dTpw' } }, bodies);

    expect(requests).toEqual([{ method: 'POST', url: '/metrics/job/playwright', contentType: 'text/plain; version=0.0.4', authorization: 'Basic dTpw', body: 'smart_reporter_tests 1\n' }]);
    expect(warn.mock.calls).toEqual([]);
  });

  it("POSTs the OTLP JSON with format: 'otlp'", async () => {
    warnings();
    reply = (res) => { res.writeHead(200); res.end(); };
    await pushMetrics({ url: `${baseUrl}/v1/metrics`, format: 'otlp' }, bodies);

    expect(requests).toEqual([{ method: 'POST', url: '/v1/metrics', contentType: 'application/json', authorization: undefined, body: '{"resourceMetrics":[]}' }]);
  });

  it('logs an error status and does not throw', async () => {
    const warn = warnings();
    reply = (res) => { res.writeHead(400); res.end('text format parsing error'); };
    await pushMetrics({ url: `${baseUrl}/metrics/job/playwright` }, bodies);

    expect(warn.mock.calls).toEqual([['⚠️  Metrics push failed: HTTP 400']]);
  });

  it('gives up after the timeout, logs it and does not throw', async () => {
    const warn = warnings();
    reply = () => {};
    await pushMetrics({ url: `${baseUrl}/metrics/job/playwright` }, bodies, 100);

    expect(warn.mock.calls).toEqual([['⚠️  Metrics push failed: The operation was aborted due to timeout']]);
  });

  it('logs a refused connection and does not throw', async () => {
    const warn = warnings();
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    await pushMetrics({ url: `http://127.0.0.1:${port}/metrics/job/playwright` }, bodies);

    expect(warn.mock.calls).toEqual([[`⚠️  Metrics push failed: connect ECONNREFUSED 127.0.0.1:${port}`]]);
  });
});
