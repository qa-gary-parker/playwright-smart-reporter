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
const workers: number[] = [];
afterEach(() => {
  child?.kill();
  for (const pid of workers.splice(0)) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
});

interface ServeSpawn { report?: string; open?: boolean; env?: NodeJS.ProcessEnv; detached?: boolean }

function serve(dir: string, args: string[], { report = path.join(dir, 'smart-report.html'), open = false, env = {}, detached = false }: ServeSpawn = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [bundle, report, ...(open ? [] : ['--no-open']), '--port', '0', ...args], { cwd: dir, env: { ...process.env, ...env }, detached });
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
  // record.cjs records the arguments it receives, so the test sees exactly what reached the process.
  // wait.cjs starts a worker, as the Playwright runner does, and the worker records its pid.
  function runDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-run-'));
    fs.writeFileSync(path.join(dir, 'smart-report.html'), V3_REPORT);
    fs.writeFileSync(path.join(dir, 'record.cjs'), "require('fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)))");
    fs.writeFileSync(path.join(dir, 'wait.cjs'), "require('child_process').spawn(process.execPath, ['worker.cjs'], { stdio: 'inherit' }); setTimeout(() => {}, 30_000)");
    fs.writeFileSync(path.join(dir, 'worker.cjs'), "const fs = require('fs'); fs.writeFileSync('worker.tmp', String(process.pid)); fs.renameSync('worker.tmp', 'worker.pid'); setTimeout(() => {}, 30_000)");
    return dir;
  }
  const post = (base: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base.replace('127.0.0.1', 'localhost'), ...headers }, body: JSON.stringify(body) });
  const finished = async (base: string) => {
    await expect.poll(async () => ((await (await fetch(`${base}/run`)).json()) as { lastExitCode: number | null }).lastExitCode, { timeout: 10_000 }).not.toBeNull();
  };
  async function workerPid(dir: string): Promise<number> {
    const file = path.join(dir, 'worker.pid');
    await expect.poll(() => fs.existsSync(file), { timeout: 10_000 }).toBe(true);
    const pid = Number(fs.readFileSync(file, 'utf8'));
    workers.push(pid);
    return pid;
  }
  // 'alive' while the process runs, then the error code process.kill(pid, 0) fails with: ESRCH once it is gone.
  function probe(pid: number): string | undefined {
    try {
      process.kill(pid, 0);
      return 'alive';
    } catch (err) {
      return (err as NodeJS.ErrnoException).code;
    }
  }

  // Windows cmd cannot quote " safely, so these values are refused there; the Windows test below covers cmd.
  it.skipIf(process.platform === 'win32')('passes filter values to the run command as plain arguments, so quotes and redirects cannot run anything', async () => {
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

  it.runIf(process.platform === 'win32')('passes filter values through cmd as plain arguments, and refuses the characters cmd would act on inside quotes', async () => {
    const dir = runDir();
    const base = await serve(dir, ['--live', '--run-command', 'node record.cjs']);
    const files = ['x & echo pwned>pwned', 'a|b<c>d'];
    const grep = '@smoke|@regression';

    expect((await post(base, { files, grep })).status).toBe(200);
    await finished(base);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'argv.json'), 'utf8'))).toEqual(['./x & echo pwned>pwned', './a|b<c>d', '--grep', grep]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('pwned'))).toEqual([]);

    const refused = await post(base, { files: ['x" & echo pwned>pwned "'] });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'A filter value cannot be passed to the run command safely' });
  }, 20_000);

  it('runs one test run at a time, reports its state, and cancels it with the workers it started', async () => {
    const dir = runDir();
    const base = await serve(dir, ['--live', '--run-command', 'node wait.cjs']);

    expect((await post(base, {})).status).toBe(200);
    const pid = await workerPid(dir);
    expect((await post(base, {})).status).toBe(409);
    expect(await (await fetch(`${base}/run`)).json()).toEqual({ running: true, command: 'node wait.cjs', lastExitCode: null });
    const cancel = await fetch(`${base}/run`, { method: 'DELETE' });
    expect(await cancel.json()).toEqual({ status: 'cancelled' });
    await expect.poll(() => probe(pid), { timeout: 5_000 }).toBe('ESRCH');
    await finished(base);
    expect(await (await fetch(`${base}/run`)).json()).toEqual({ running: false, command: 'node wait.cjs', lastExitCode: -1 });
    expect((await fetch(`${base}/run`, { method: 'DELETE' })).status).toBe(409);
  }, 30_000);

  // Ctrl+C reaches the terminal's foreground process group. Windows has no process groups to signal from a test.
  it.skipIf(process.platform === 'win32')('stops the test run and the workers it started when Ctrl+C stops serve', async () => {
    const dir = runDir();
    const base = await serve(dir, ['--live', '--run-command', 'node wait.cjs'], { detached: true });
    const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child!.on('exit', (code, signal) => resolve({ code, signal })));

    expect((await post(base, {})).status).toBe(200);
    const pid = await workerPid(dir);
    process.kill(-child!.pid!, 'SIGINT');

    await expect.poll(() => probe(pid), { timeout: 5_000 }).toBe('ESRCH');
    expect(await exited).toEqual({ code: 130, signal: null });
  }, 20_000);

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
    const base = await serve(dir, [], { report: path.join(dir, 'report', 'smart-report.html') });

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

describe('serve opening the browser', () => {
  // A stand-in open and xdg-open on PATH record the arguments serve passes. Windows has its own unit test.
  it.skipIf(process.platform === 'win32')('passes the report URL to the system opener as one argument, so a file name cannot run a shell command', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-open-'));
    const report = path.join(dir, 'smart-report $(touch pwned).html');
    fs.writeFileSync(report, V3_REPORT);
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    const opened = path.join(dir, 'opened.json');
    for (const name of ['open', 'xdg-open']) {
      fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(opened)}, JSON.stringify(process.argv.slice(2)))\n`, { mode: 0o755 });
    }
    const base = await serve(dir, [], { report, open: true, env: { PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
    const readOpened = () => (fs.existsSync(opened) ? JSON.parse(fs.readFileSync(opened, 'utf8')) : undefined);

    await expect.poll(readOpened, { timeout: 5_000 }).toEqual([`${base.replace('127.0.0.1', 'localhost')}/smart-report%20%24(touch%20pwned).html`]);
    expect(fs.existsSync(path.join(dir, 'pwned'))).toBe(false);
  }, 15_000);
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
