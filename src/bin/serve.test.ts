import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';

// Runs the real serve CLI (bundled from source) against a v3-style report.
const bundle = path.join(os.tmpdir(), `serve-under-test-${process.pid}.cjs`);
buildSync({ entryPoints: [path.resolve(__dirname, 'serve.ts')], bundle: true, platform: 'node', outfile: bundle, logLevel: 'silent' });

const V3_REPORT = '<!doctype html><html><head><meta name="smart-live-sse" content="__SSE_URL__"><meta name="smart-live-run" content="__RUN_ENABLED__"></head><body></body></html>';

let child: ChildProcess | undefined;
afterEach(() => child?.kill());

function serve(dir: string, args: string[], report = path.join(dir, 'smart-report.html')): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [bundle, report, '--no-open', '--port', '0', ...args], { cwd: dir });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`serve exited ${code}: ${out}`)));
  });
}

describe('serve placeholder injection for v3 reports', () => {
  it('points the v3 report at /sse and enables Run when --live and --run-command are given', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-v3-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    const base = await serve(dir, ['--live', '--run-command', 'npx playwright test']);
    const html = await (await fetch(`${base}/smart-report.html`)).text();
    expect(html).toContain('<meta name="smart-live-sse" content="/sse">');
    expect(html).toContain('<meta name="smart-live-run" content="true">');
  });

  it('leaves the placeholders when served without --live', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-v3-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    const base = await serve(dir, []);
    const html = await (await fetch(`${base}/smart-report.html`)).text();
    expect(html).toBe(V3_REPORT);
  });
});

// A raw request, so the Host header can be set (fetch does not allow it).
function rawGet(base: string, pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}${pathname}`, { headers }, (res) => {
      res.destroy();
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
    });
    req.on('error', reject);
  });
}

describe('serve /run', () => {
  // The run command records the arguments it receives, so the test sees exactly what reached the process.
  function runDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    fs.writeFileSync(path.join(dir, 'record.cjs'), "require('fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)))");
    return dir;
  }
  const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.replace('127.0.0.1', 'localhost'), ...headers }, body: JSON.stringify(body) });
  const finished = async (base: string) => {
    await expect.poll(async () => (await (await fetch(`${base}/run`)).json()).lastExitCode, { timeout: 10_000 }).not.toBeNull();
  };

  it('passes filter values to the run command as plain arguments, so quotes and redirects cannot run anything', async () => {
    const dir = runDir();
    const base = await serve(dir, ['--live', '--run-command', 'node record.cjs']);
    const files = ['x" >pwned "', "it's.spec.ts"];
    const grep = '@smoke|@regression$(touch pwned2)`touch pwned3`';

    const res = await post(base, { files, grep });
    expect(res.status).toBe(200);
    await finished(base);

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'))).toEqual(['./x" >pwned "', "./it's.spec.ts", '--grep', grep]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('pwned'))).toEqual([]);
  });

  it('runs one test run at a time, reports its state, and cancels it', async () => {
    const dir = runDir();
    fs.writeFileSync(path.join(dir, 'wait.cjs'), 'setTimeout(() => {}, 30_000)');
    const base = await serve(dir, ['--live', '--run-command', 'node wait.cjs']);

    expect((await post(base, {})).status).toBe(200);
    expect((await post(base, {})).status).toBe(409);
    expect(await (await fetch(`${base}/run`)).json()).toEqual({ running: true, command: 'node wait.cjs', lastExitCode: null });
    const cancel = await fetch(`${base}/run`, { method: 'DELETE' });
    expect(await cancel.json()).toEqual({ status: 'cancelled' });
    await finished(base);
    expect(await (await fetch(`${base}/run`)).json()).toEqual({ running: false, command: 'node wait.cjs', lastExitCode: -1 });
    expect((await fetch(`${base}/run`, { method: 'DELETE' })).status).toBe(409);
  });

  it('refuses a run requested by another website, or sent as anything but JSON', async () => {
    const dir = runDir();
    const base = await serve(dir, ['--live', '--run-command', 'node record.cjs']);

    expect((await post(base, {}, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(base, {}, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect(await (await fetch(`${base}/run`)).json()).toMatchObject({ running: false, lastExitCode: null });
    expect(fs.existsSync(path.join(dir, 'argv.json'))).toBe(false);
  });
});

describe('serve request handling', () => {
  it('answers only requests addressed to localhost, so a rebound domain cannot read the report', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-host-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    const base = await serve(dir, []);
    const port = new URL(base).port;

    expect((await rawGet(base, '/smart-report.html', { Host: 'attacker.example' })).status).toBe(403);
    expect((await rawGet(base, '/smart-report.html', { Host: `localhost:${port}` })).status).toBe(200);
  });

  it('does not serve project files outside the report folder, only trace and media files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-cwd-'));
    fs.mkdirSync(path.join(dir, 'report'));
    fs.writeFileSync(path.join(dir, 'report', 'smart-report.html'), V3_REPORT);
    fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=secret');
    fs.mkdirSync(path.join(dir, 'test-results'));
    fs.writeFileSync(path.join(dir, 'test-results', 'trace.zip'), 'zip');
    const base = await serve(dir, [], path.join(dir, 'report', 'smart-report.html'));

    expect((await fetch(`${base}/.env`)).status).toBe(404);
    expect((await fetch(`${base}/test-results/trace.zip`)).status).toBe(200);
  });

  it('answers a malformed URL with 400 and keeps serving', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-url-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    const base = await serve(dir, []);

    expect((await rawGet(base, '/%E0%A4%A')).status).toBe(400);
    expect((await fetch(`${base}/smart-report.html`)).status).toBe(200);
  });

  it('does not let other websites read the live stream', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-sse-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    const base = await serve(dir, ['--live']);

    const res = await rawGet(base, '/sse', { Origin: 'https://evil.example' });
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('serve arguments', () => {
  it('rejects a port that is not a number from 0 to 65535 with a message, not a stack trace', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-port-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    for (const port of ['abc', '99999']) {
      const res = spawnSync(process.execPath, [bundle, path.join(dir, 'smart-report.html'), '--no-open', '--port', port], { encoding: 'utf8', timeout: 10_000 });
      expect(res.status).toBe(1);
      expect(res.stderr.trim()).toBe(`Error: --port must be a whole number from 0 to 65535 (got "${port}").`);
    }
  });
});
