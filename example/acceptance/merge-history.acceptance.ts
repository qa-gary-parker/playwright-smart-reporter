import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunSummary, TestHistory } from '../../src/types';

// The README "Sharded Runs" flow on real runs: two runs build a history, each shard restores it and runs with
// the same runId, then the built merge-history bin (dist/) merges the shards. Needs `npm run build`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');
const MERGE_HISTORY = path.join(ROOT, 'dist/bin/merge-history.js');
const GREP = 'passes$|fails$|passes on retry|is skipped';
const THREE_RUNS = {
  'suite.fixtures.ts::passes': 3,
  'suite.fixtures.ts::fails': 3,
  'suite.fixtures.ts::passes on retry': 3,
  'suite.fixtures.ts::is skipped': 3,
};

let tmp: string;
let shards: string[];

function runSuite(out: string, options: object, args: string[] = []) {
  const run = spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options) },
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function mergeHistory(name: string, args: string[]): TestHistory {
  const output = path.join(tmp, name);
  // A copy outside this repo, so it cannot load packages that a real install does not have (such as glob)
  const bin = path.join(tmp, 'merge-history.js');
  fs.copyFileSync(MERGE_HISTORY, bin);
  const run = spawnSync(process.execPath, [bin, ...args, '-o', output], { cwd: tmp, encoding: 'utf8' });
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  return JSON.parse(fs.readFileSync(output, 'utf8'));
}

const entriesPerTest = (history: TestHistory) =>
  Object.fromEntries(Object.entries(history.tests).map(([testId, entries]) => [testId, entries.length]));

const shardSummaries = () =>
  shards.map((file) => (JSON.parse(fs.readFileSync(file, 'utf8')) as TestHistory).summaries!.find((s) => s.runId === 'run-ci-3')!);

beforeAll(() => {
  if (!fs.existsSync(MERGE_HISTORY)) throw new Error('dist/ is missing: run `npm run build` first');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-merge-history-'));
  const restored = path.join(tmp, 'restored.json');
  for (const runId of ['ci-1', 'ci-2']) runSuite(path.join(tmp, runId), { historyFile: restored, runId }, ['--grep', GREP]);
  shards = [1, 2].map((n) => {
    const historyFile = path.join(tmp, `shard${n}`, 'test-history.json');
    fs.mkdirSync(path.dirname(historyFile), { recursive: true });
    fs.copyFileSync(restored, historyFile);
    runSuite(path.join(tmp, `shard${n}`), { historyFile, runId: 'ci-3' }, ['--grep', GREP, '--fully-parallel', `--shard=${n}/2`]);
    return historyFile;
  });
}, 120_000);

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('merge-history on sharded runs', () => {
  it('combines the shard summaries of one run, and keeps a run restored into both shards once', () => {
    const counts = (s: RunSummary) => [s.runId, s.total, s.passed, s.failed, s.skipped, s.flaky, s.passRate];
    expect(shardSummaries().map((s) => s.total)).toEqual([2, 2]);

    const merged = mergeHistory('merged.json', shards);

    expect(merged.summaries!.map(counts)).toEqual([
      ['run-ci-1', 4, 2, 1, 1, 1, 50],
      ['run-ci-2', 4, 2, 1, 1, 1, 50],
      ['run-ci-3', 4, 2, 1, 1, 1, 50],
    ]);
    const [shard1, shard2] = shardSummaries();
    expect(merged.summaries![2].duration).toBe(Math.max(shard1.duration, shard2.duration));
    expect(merged.summaries![2].timestamp).toBe([shard1.timestamp, shard2.timestamp].sort()[0]);
  });

  it('keeps one entry per test for each run', () => {
    const merged = mergeHistory('merged.json', shards);

    expect(entriesPerTest(merged)).toEqual(THREE_RUNS);
  });

  it('expands quoted *, ? and ** patterns without the glob package', () => {
    expect(entriesPerTest(mergeHistory('star.json', ['shard*/test-history.json']))).toEqual(THREE_RUNS);
    expect(entriesPerTest(mergeHistory('question.json', ['shard?/test-history.json']))).toEqual(THREE_RUNS);
    expect(entriesPerTest(mergeHistory('globstar.json', ['**/test-history.json']))).toEqual(THREE_RUNS);
  });

  it('--max-runs trims the per-test entries when runs[] is empty', () => {
    const merged = mergeHistory('limited.json', [...shards, '--max-runs', '2']);

    expect(merged.runs).toEqual([]);
    expect(merged.summaries!.map((s) => s.runId)).toEqual(['run-ci-2', 'run-ci-3']);
    expect(entriesPerTest(merged)).toEqual({
      'suite.fixtures.ts::passes': 2,
      'suite.fixtures.ts::fails': 2,
      'suite.fixtures.ts::passes on retry': 2,
      'suite.fixtures.ts::is skipped': 2,
    });
  });
});
