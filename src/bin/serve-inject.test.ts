import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
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

function serve(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [bundle, path.join(dir, 'smart-report.html'), '--no-open', '--port', '0', ...args], { cwd: dir });
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
