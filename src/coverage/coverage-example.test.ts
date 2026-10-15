// End-to-end acceptance for code coverage. Needs `npm run build` and Chromium; run with `npm run test:coverage-example`.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const EXAMPLE = path.join(ROOT, 'example/coverage');
const OUT = path.join(EXAMPLE, 'coverage-report');
const CONFIG = path.join(EXAMPLE, 'playwright.config.ts');
const PLAYWRIGHT = path.join(ROOT, 'node_modules/@playwright/test/cli.js');

// Line totals c8 reports for the same bundle replayed in Node (see run-in-node.mjs). esbuild emits no
// mapping for a closing brace, so V8-based tools count the `}` of the never-called multiply() and
// shout() as covered: 15 lines execute, 17 are reported, by this reporter and by c8 alike.
const EXPECTED_FILES = {
  'app/src/format.ts': { total: 6, covered: 4, pct: 66.66 },
  'app/src/main.ts': { total: 3, covered: 3, pct: 100 },
  'app/src/math.ts': { total: 12, covered: 10, pct: 83.33 },
};

function run(command: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

const playwright = (args: string[], env: Record<string, string>) => run(process.execPath, [PLAYWRIGHT, ...args], env);
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

interface Totals { total: number; covered: number; pct: number }
type Metrics = Record<'lines' | 'functions' | 'branches', Totals>;
type JsonCoverage = { summary: Metrics; files: Array<Metrics & { path: string }> };

describe('coverage example', () => {
  const runs: Record<string, { status: number | null; output: string; coverage?: JsonCoverage }> = {};
  let c8: Record<string, Metrics>;

  beforeAll(() => {
    fs.rmSync(OUT, { recursive: true, force: true });
    const single = (name: string, env: Record<string, string>) => {
      runs[name] = playwright(['test', '--config', CONFIG], { SMART_COVERAGE_OUT: name, ...env });
      const json = path.join(OUT, name, 'smart-report-data.json');
      if (fs.existsSync(json)) runs[name].coverage = readJson(json).coverage;
    };
    single('pass', { SMART_MIN_COVERAGE: '80' });
    single('block', { SMART_MIN_COVERAGE: '81' });

    for (const shard of ['1', '2']) {
      const blobDir = path.join(OUT, `blob-${shard}`);
      runs[`shard-${shard}`] = playwright(['test', '--config', CONFIG, `--shard=${shard}/2`, '--reporter=blob'], { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir });
      fs.mkdirSync(path.join(OUT, 'blobs'), { recursive: true });
      for (const zip of fs.readdirSync(blobDir)) fs.copyFileSync(path.join(blobDir, zip), path.join(OUT, 'blobs', zip));
    }
    // The reporter does not create its output folder, and merge-reports runs no tests that would.
    fs.mkdirSync(path.join(OUT, 'merged'), { recursive: true });
    runs.merged = playwright(['merge-reports', '--config', CONFIG, path.join(OUT, 'blobs')], { SMART_COVERAGE_OUT: 'merged' });
    runs.merged.coverage = readJson(path.join(OUT, 'merged', 'smart-report-data.json')).coverage;

    const c8Run = run(process.execPath, [
      path.join(ROOT, 'node_modules/c8/bin/c8.js'), '--reporter=json-summary', '--report-dir', path.join(OUT, 'c8'),
      '--temp-directory', path.join(OUT, 'c8-tmp'), '--include', 'example/coverage/app/**',
      process.execPath, path.join(EXAMPLE, 'run-in-node.mjs'),
    ]);
    expect(c8Run.status, c8Run.output).toBe(0);
    c8 = readJson(path.join(OUT, 'c8', 'coverage-summary.json'));
  }, 240_000);

  it('maps the one-line bundle back to its three sources with the known line totals', () => {
    expect(runs.pass.status, runs.pass.output).toBe(0);
    const files = Object.fromEntries(runs.pass.coverage!.files.map((f) => [f.path, f.lines]));
    expect(files).toEqual(EXPECTED_FILES);
    expect(runs.pass.coverage!.summary.lines).toEqual({ total: 21, covered: 17, pct: 80.95 });
    expect(runs.pass.coverage!.summary.functions).toEqual({ total: 5, covered: 3, pct: 60 });
  });

  // Stated tolerance: none. Lines, functions and branches must equal c8's, in total and per file.
  it('matches an independent c8 measurement of the same code', () => {
    const pick = (m: Metrics): Metrics => {
      const t = ({ total, covered, pct }: Totals) => ({ total, covered, pct });
      return { lines: t(m.lines), functions: t(m.functions), branches: t(m.branches) };
    };
    const ours = runs.pass.coverage!;
    expect(pick(ours.summary)).toEqual(pick(c8.total));
    for (const file of ours.files) {
      const key = Object.keys(c8).find((k) => k.split(path.sep).join('/').endsWith(`/example/coverage/${file.path}`));
      expect(key, `c8 has no entry for ${file.path}`).toBeDefined();
      expect(pick(file)).toEqual(pick(c8[key!]));
    }
  });

  it('blocks the run below minCoverage and passes it at the threshold, by exit code', () => {
    expect(runs.pass.status, runs.pass.output).toBe(0);
    expect(runs.pass.output).toContain('✓ Min line coverage    80.95% ≥ 80%');
    expect(runs.block.status, runs.block.output).toBe(1);
    expect(runs.block.output).toContain('✗ Min line coverage    80.95% ≥ 81%');
  });

  it('blocks and passes through both gate CLIs, by exit code', () => {
    const data = path.join(OUT, 'pass', 'smart-report-data.json');
    expect(run(process.execPath, [path.join(ROOT, 'dist/bin/gate.js'), '--input', data, '--min-coverage', '81']).status).toBe(1);
    expect(run(process.execPath, [path.join(ROOT, 'dist/bin/gate.js'), '--input', data, '--min-coverage', '80.95']).status).toBe(0);

    const config = path.join(OUT, 'gates.json');
    fs.writeFileSync(config, JSON.stringify({ minCoverage: 81 }));
    expect(run(process.execPath, [path.join(ROOT, 'dist/bin/cli.js'), 'gate', '--config', config, '--data', data]).status).toBe(1);
    fs.writeFileSync(config, JSON.stringify({ minCoverage: 80 }));
    expect(run(process.execPath, [path.join(ROOT, 'dist/bin/cli.js'), 'gate', '--config', config, '--data', data]).status).toBe(0);
  });

  it('merges coverage from two shards through merge-reports into the single-run result', () => {
    expect(runs['shard-1'].status, runs['shard-1'].output).toBe(0);
    expect(runs['shard-2'].status, runs['shard-2'].output).toBe(0);
    expect(runs.merged.status, runs.merged.output).toBe(0);
    expect(runs.merged.coverage).toEqual(runs.pass.coverage);
  });
});
