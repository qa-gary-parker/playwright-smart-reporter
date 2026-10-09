import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ReportData } from '../report-data/schema';
import { buildFailureBundle, writeFailureBundle } from './failure-bundle';

const REPO = path.resolve(__dirname, '../..');
const fixture: ReportData = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'report-data.json'), 'utf8'));
const OPTS = { rootDir: '/repo', env: {} };
const LOGIN_ID = '[chromium] tests/auth/login.spec.ts::shows the dashboard after login';

const textOf = (result: unknown) => {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  expect(content).toHaveLength(1);
  return JSON.parse(content[0].text);
};

describe('MCP server over stdio (end to end)', () => {
  let dir: string;
  let cli: string;
  let bundlePath: string;
  let client: Client;
  const clients: Client[] = [];

  const connect = async (dataPath: string) => {
    const c = new Client({ name: 'smart-reporter-e2e', version: '1.0.0' });
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cli, 'mcp', '--data', dataPath],
        env: { ...getDefaultEnvironment(), NODE_PATH: path.join(REPO, 'node_modules') },
        stderr: 'pipe',
      }),
    );
    clients.push(c);
    return c;
  };

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-reporter-mcp-'));
    cli = path.join(dir, 'cli.js');
    // Bundle the real CLI so the test drives the shipped entry point without a prior `npm run build`.
    await build({
      entryPoints: [path.join(REPO, 'src/bin/cli.ts')],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      outfile: cli,
      logLevel: 'silent',
    });
    bundlePath = writeFailureBundle(fixture, { ...OPTS, outputDir: dir });
    client = await connect(bundlePath);
  }, 30_000);

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('identifies itself and lists exactly the three failure tools', async () => {
    expect(client.getServerVersion()?.name).toBe('playwright-smart-reporter');
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_failures', 'get_failure', 'get_trace_context']);
    expect(tools[1].inputSchema).toEqual({
      type: 'object',
      properties: { id: { type: 'string', description: 'Failure id from list_failures' } },
      required: ['id'],
      additionalProperties: false,
    });
  });

  it('list_failures returns one summary per failure', async () => {
    expect(textOf(await client.callTool({ name: 'list_failures', arguments: {} }))).toEqual({
      run: {
        runId: 'run-fixture',
        generatedAt: '2026-10-08T12:00:00.000Z',
        reporterVersion: '3.0.0',
        projectName: 'web',
        ci: { provider: 'github', branch: 'main', commit: 'abc1234', buildId: '42' },
        total: 5,
        failed: 2,
      },
      failures: [
        {
          id: LOGIN_ID,
          title: 'shows the dashboard after login',
          location: 'tests/auth/login.spec.ts:10',
          project: 'chromium',
          status: 'failed',
          error: 'Error: expect(locator).toBeVisible() failed',
          anomaly: 'POST /api/session returned 500',
        },
        {
          id: 'tests/export.spec.ts::exports a CSV',
          title: 'exports a CSV',
          location: 'tests/export.spec.ts:6',
          status: 'timedOut',
          error: 'Error: locator.click: Test timeout of 30000ms exceeded.',
        },
      ],
    });
  });

  it('get_failure returns the specific failure with its context and without the trace lanes', async () => {
    const failure = textOf(await client.callTool({ name: 'get_failure', arguments: { id: LOGIN_ID } }));
    const { trace: _trace, ...expected } = buildFailureBundle(fixture, OPTS).failures[0];
    expect(failure).toStrictEqual(expected);
    expect(failure.error.location).toEqual({
      relative: 'tests/auth/login.spec.ts',
      absolute: '/repo/tests/auth/login.spec.ts',
      line: 14,
      column: 61,
    });
    expect(failure.callLog).toEqual(['- Expect "toBeVisible" with timeout 5000ms', "- waiting for getByRole('heading', { name: 'Dashboard' })"]);
    expect(failure.failingStep).toEqual({ title: 'Expect "toBeVisible"', category: 'expect', start: 1100, end: 6150 });
    expect(failure.network.failed[0].requestHeaders).toEqual({ Authorization: '[REDACTED]', 'Content-Type': 'application/json' });
    expect(failure.anomaly.summary).toBe('POST /api/session returned 500');
  });

  it('get_trace_context returns the steps, network, and console lanes for one failure', async () => {
    const context = textOf(await client.callTool({ name: 'get_trace_context', arguments: { id: LOGIN_ID } }));
    expect(Object.keys(context)).toEqual(['id', 'steps', 'network', 'console']);
    expect(context.id).toBe(LOGIN_ID);
    expect(context.steps.map((s: { title: string }) => s.title)).toEqual(['Navigate to "/login"', 'Sign in', 'Expect "toBeVisible"']);
    expect(context.network.map((n: { method: string; status: number }) => `${n.method} ${n.status}`)).toEqual(['GET 200', 'POST 500']);
    expect(context.console).toEqual([
      { at: 50, level: 'log', text: 'app booted' },
      { at: 1105, level: 'error', text: 'Failed to load resource: the server responded with a status of 500 ()' },
    ]);
  });

  it('returns a tool error for an unknown id', async () => {
    expect(await client.callTool({ name: 'get_failure', arguments: { id: 'nope' } })).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'No failure with id "nope". Call list_failures for valid ids.' }],
    });
  });

  it('starts before the first test run and serves the bundle once it is written', async () => {
    const later = path.join(dir, 'later', 'smart-report-failures.json');
    const early = await connect(later);
    expect(await early.callTool({ name: 'list_failures', arguments: {} })).toEqual({
      isError: true,
      content: [
        { type: 'text', text: `No failure data at ${later}. Run your tests with exportFailures: true, then call the tool again.` },
      ],
    });
    writeFailureBundle(fixture, { ...OPTS, outputDir: path.dirname(later) });
    expect(textOf(await early.callTool({ name: 'list_failures', arguments: {} })).failures).toHaveLength(2);
  });

  it('names the data file when it is not valid JSON', async () => {
    const truncated = path.join(dir, 'truncated-failures.json');
    fs.writeFileSync(truncated, '{"tests": [');
    expect(await (await connect(truncated)).callTool({ name: 'list_failures', arguments: {} })).toEqual({
      isError: true,
      content: [{ type: 'text', text: `${truncated} is not valid JSON: Unexpected end of JSON input` }],
    });
  });

  it('serves the latest bundle after the tests run again', async () => {
    const rerun = { ...fixture, tests: fixture.tests.filter((t) => t.testId !== 'tests/export.spec.ts::exports a CSV') };
    writeFailureBundle(rerun, { ...OPTS, outputDir: dir });
    const { failures } = textOf(await client.callTool({ name: 'list_failures', arguments: {} }));
    expect(failures.map((f: { id: string }) => f.id)).toEqual([LOGIN_ID]);
  });
});
