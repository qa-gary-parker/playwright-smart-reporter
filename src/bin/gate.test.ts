import { spawnSync } from 'child_process';
import { buildSync } from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJsonData } from '../generators/json-exporter';
import type { A11yImpact, TestResultData } from '../types';

// Runs the real CLIs as child processes so the assertions are on the process exit code.
let dir: string;
const bundle = (name: string) => path.join(dir, `${name}.js`);

function run(name: 'gate' | 'cli', args: string[]) {
  const res = spawnSync(process.execPath, [bundle(name), ...args], { cwd: dir, encoding: 'utf-8' });
  return { status: res.status, stdout: res.stdout };
}

function scannedTest(testId: string, ...impacts: A11yImpact[]): TestResultData {
  return {
    testId, title: testId, file: 'a.spec.ts', status: 'passed', duration: 1, retry: 0, steps: [], history: [], outcome: 'expected',
    a11y: {
      violations: impacts.map((impact, i) => ({ id: `rule-${i}`, impact, description: '', helpUrl: '', wcagTags: [], nodes: [] })),
      passes: 1, incomplete: 0, inapplicable: 0, timestamp: '', standard: 'WCAG2AA',
    },
  };
}

function writeJson(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-gate-'));
  for (const name of ['gate', 'cli']) {
    buildSync({ entryPoints: [path.join(__dirname, `${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle(name), logLevel: 'silent' });
  }
  // 4 violations: 1 critical, 2 serious, 1 minor
  const results = [scannedTest('t1', 'critical', 'serious'), scannedTest('t2', 'serious', 'minor')];
  exportJsonData(results, { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'scanned');
  const unscanned = results.map(({ a11y: _a11y, ...r }) => r);
  exportJsonData(unscanned, { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'unscanned');
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('gate CLI (src/bin/gate.ts) accessibility', () => {
  it('exits 1 when violations exceed --max-a11y-violations', () => {
    const { status, stdout } = run('gate', ['--input', 'scanned-data.json', '--max-a11y-violations', '3']);
    expect(status).toBe(1);
    expect(stdout).toContain('✗ Max a11y violations  4 ≤ 3');
  });

  it('exits 0 at the threshold', () => {
    const { status, stdout } = run('gate', ['--input', 'scanned-data.json', '--max-a11y-violations', '4']);
    expect(status).toBe(0);
    expect(stdout).toContain('✓ Max a11y violations  4 ≤ 4');
  });

  it('accepts a config file with only impact gates', () => {
    const config = writeJson('impact-gates.json', { maxA11yCritical: 0, maxA11ySerious: 2 });
    const { status, stdout } = run('gate', ['--input', 'scanned-data.json', '--config', config]);
    expect(status).toBe(1);
    expect(stdout).toContain('✗ Max a11y critical    1 ≤ 0');
    expect(stdout).toContain('✓ Max a11y serious     2 ≤ 2');
  });

  it('skips the rule and exits 0 when no test was scanned', () => {
    const { status, stdout } = run('gate', ['--input', 'unscanned-data.json', '--max-a11y-violations', '0']);
    expect(status).toBe(0);
    expect(stdout).toContain('Max a11y violations  (skipped — no accessibility scans)');
  });
});

describe('playwright-smart-reporter gate (src/bin/cli.ts) accessibility', () => {
  it('exits 1 above maxA11yViolations and 0 at it', () => {
    const over = writeJson('over.json', { maxA11yViolations: 3 });
    const at = writeJson('at.json', { maxA11yViolations: 4 });
    expect(run('cli', ['gate', '--config', over, '--data', 'scanned-data.json']).status).toBe(1);
    expect(run('cli', ['gate', '--config', at, '--data', 'scanned-data.json']).status).toBe(0);
  });
});

describe('playwright-smart-reporter gate (src/bin/cli.ts) input checks', () => {
  function runCli(args: string[]) {
    const res = spawnSync(process.execPath, [bundle('cli'), ...args], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, stderr: res.stderr.trim() };
  }

  it('exits 1 when the data file is not a JSON export, such as the failure bundle', () => {
    const config = writeJson('rate.json', { minPassRate: 95 });
    const bundleFile = writeJson('smart-report-failures.json', { format: 'playwright-smart-reporter/failures', failures: [{ id: 'a' }] });
    expect(runCli(['gate', '--config', config, '--data', bundleFile])).toEqual({
      status: 1,
      stderr: `Error: ${bundleFile} is not a Smart Reporter JSON export (it has no tests and summary). Pass the file written by exportJson: true.`,
    });
  });

  it('failures names the data file when it is not valid JSON', () => {
    const file = path.join(dir, 'truncated-failures.json');
    fs.writeFileSync(file, '{"tests": [');
    expect(runCli(['failures', '--data', file])).toEqual({
      status: 1,
      stderr: `Error: ${file} is not valid JSON: Unexpected end of JSON input`,
    });
  });

  it('exits 1 when the config has a rule name it does not know, so a typo cannot pass the gate', () => {
    const config = writeJson('typo.json', { minPassrate: 95 });
    const res = runCli(['gate', '--config', config, '--data', 'scanned-data.json']);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe(
      'Error: unknown quality gate rule "minPassrate". Known rules: maxFailures, minPassRate, maxFlakyRate, minStabilityGrade, noNewFailures, maxA11yViolations, maxA11yCritical, maxA11ySerious, minCoverage.',
    );
  });
});

