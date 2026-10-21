import { spawnSync } from 'child_process';
import { buildSync } from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJsonData } from '../generators/json-exporter';
import type { A11yImpact, ClusterTracking, TestResultData } from '../types';

// Runs the real CLIs as child processes so the assertions are on the process exit code.
let dir: string;
const bundle = (name: string) => path.join(dir, `${name}.js`);

function run(name: 'gate' | 'cli' | 'view-trace', args: string[]) {
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

// The quarantine file the reporter writes next to the JSON export, with one entry past its expiresAt
function writeExpiredQuarantine(): void {
  writeJson('.smart-quarantine.json', {
    generatedAt: '2026-10-21T00:00:00.000Z',
    threshold: 0.3,
    entries: [{ testId: 'a', title: 'a', file: 'a.spec.ts', quarantinedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-10-20T00:00:00.000Z' }],
  });
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-gate-'));
  for (const name of ['gate', 'cli', 'view-trace']) {
    buildSync({ entryPoints: [path.join(__dirname, `${name}.ts`)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle(name), logLevel: 'silent' });
  }
  // 4 violations: 1 critical, 2 serious, 1 minor
  const results = [scannedTest('t1', 'critical', 'serious'), scannedTest('t2', 'serious', 'minor')];
  exportJsonData(results, { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'scanned');
  const unscanned = results.map(({ a11y: _a11y, ...r }) => r);
  exportJsonData(unscanned, { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'unscanned');
  const test = (testId: string, file: string, outcome: 'expected' | 'unexpected' | 'flaky', more: Partial<TestResultData>): TestResultData => ({
    testId, title: testId, file, status: outcome === 'unexpected' ? 'failed' : 'passed', outcome, duration: 1, retry: outcome === 'flaky' ? 1 : 0, steps: [], history: [], ...more,
  });
  exportJsonData([
    test('pay', 'checkout/pay.spec.ts', 'unexpected', { tags: ['@critical'], project: 'chromium', owners: ['@shop'] }),
    test('home', 'home.spec.ts', 'flaky', { project: 'firefox' }),
    test('about', 'about.spec.ts', 'expected', { project: 'firefox' }),
  ], { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'scoped');
  const performanceMetrics = { averageDuration: 1000, currentDuration: 1300, percentChange: 30, absoluteChange: 300, threshold: 0.2, isRegression: true, isImprovement: false, severity: 'medium' } as const;
  exportJsonData([test('slow', 'slow.spec.ts', 'expected', { duration: 1300, performanceMetrics })], { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'timed');
  const [pay, cart] = [test('pay', 'pay.spec.ts', 'unexpected', {}), test('cart', 'cart.spec.ts', 'unexpected', {})];
  const tracking = (status: ClusterTracking['status']) => ({ status, runs: 1, since: '2026-10-21T00:00:00.000Z', trend: [1] });
  exportJsonData([pay, cart], { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, [
    { id: 'c1', errorType: 'x', count: 1, tests: [pay], tracking: tracking('new') },
    { id: 'c2', errorType: 'y', count: 1, tests: [cart], tracking: tracking('recurring') },
  ], dir, 'clustered');
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
      'Error: unknown quality gate rule "minPassrate". Known rules: maxFailures, minPassRate, maxFlakyRate, minStabilityGrade, noNewFailures, maxA11yViolations, maxA11yCritical, maxA11ySerious, minCoverage, maxDurationRegression, noNewFlaky, noNewClusters, noExpiredQuarantine.',
    );
  });
});

describe('playwright-smart-reporter gate (src/bin/cli.ts) scoped rules', () => {
  function runCli(args: string[]) {
    const res = spawnSync(process.execPath, [bundle('cli'), ...args], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr.trim() };
  }

  it('scopes rules by the tags, project, owners and file in the JSON export, and a warn rule does not fail the gate', () => {
    const config = writeJson('scoped-gates.json', { rules: [
      { id: 'critical', scope: { tag: '@critical' }, maxFailures: 0 },
      { scope: { project: 'firefox' }, maxFlakyRate: 0, severity: 'warn' },
      { scope: { owner: '@shop', file: 'checkout/**' }, minPassRate: 100 },
    ] });
    const { status, stdout } = runCli(['gate', '--config', config, '--data', 'scoped-data.json']);
    expect(status).toBe(1);
    expect(stdout.split('\n').slice(3, 7)).toEqual([
      '  ✗ critical             1 ≤ 0',
      '  ! Max flaky rate (project firefox) 50% ≤ 0% (warning)',
      '  ✗ Min pass rate (file checkout/**, owner @shop) 0% ≥ 100%',
      '  ─────────────────────────────────────────────',
    ]);
    expect(stdout).toContain('Result: FAILED (2 of 3 rules breached, 1 warning)');
  });

  it('exits 0 when only a warn rule is breached', () => {
    const config = writeJson('warn-gates.json', { rules: [{ scope: { project: 'firefox' }, maxFlakyRate: 0, severity: 'warn' }] });
    const { status, stdout } = runCli(['gate', '--config', config, '--data', 'scoped-data.json']);
    expect(status).toBe(0);
    expect(stdout).toContain('Result: PASSED with 1 warning (0 of 1 rules passed)');
  });

  it('evaluates noExpiredQuarantine from the quarantine file next to --data, or the one --quarantine-file names', () => {
    writeExpiredQuarantine();
    const config = writeJson('quarantine-gates.json', { noExpiredQuarantine: true });
    expect(runCli(['gate', '--config', config, '--data', 'scanned-data.json'])).toMatchObject({ status: 1, stdout: expect.stringContaining('  ✗ No expired quarantine 1 ≤ 0\n') });
    expect(runCli(['gate', '--config', config, '--data', 'scanned-data.json', '--quarantine-file', 'missing.json']))
      .toMatchObject({ status: 0, stdout: expect.stringContaining('  ○ No expired quarantine (skipped — no quarantine data)\n') });
  });

  it('exits 1 on an unknown key in a rule, in both CLIs', () => {
    const config = writeJson('bogus-gates.json', { rules: [{ bogus: 1 }] });
    const message = 'Error: unknown key "bogus" in quality gate rules[0]. Known keys: id, scope, severity, maxFailures, minPassRate, maxFlakyRate, minStabilityGrade, noNewFailures, maxA11yViolations, maxA11yCritical, maxA11ySerious, minCoverage, maxDurationRegression, noNewFlaky, noNewClusters, noExpiredQuarantine.';
    expect(runCli(['gate', '--config', config, '--data', 'scoped-data.json'])).toMatchObject({ status: 1, stderr: message });
    const res = spawnSync(process.execPath, [bundle('gate'), '--input', 'scoped-data.json', '--config', config], { cwd: dir, encoding: 'utf-8' });
    expect([res.status, res.stderr.trim()]).toEqual([1, message]);
  });
});

describe('gate CLI (src/bin/gate.ts) flags', () => {
  function runGate(args: string[]) {
    const res = spawnSync(process.execPath, [bundle('gate'), ...args], { cwd: dir, encoding: 'utf-8' });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr.trim() };
  }

  it('evaluates pass rate, failures, flaky rate and grade given as flags', () => {
    const { status, stdout } = runGate(['--input', 'scanned-data.json', '--min-pass-rate', '100', '--max-failures', '0', '--max-flaky-rate', '0']);
    expect(status).toBe(0);
    expect(stdout).toContain('✓ Min pass rate        100% ≥ 100%');
    expect(stdout).toContain('✓ Max failures         0 ≤ 0');
    expect(stdout).toContain('✓ Max flaky rate       0% ≤ 0%');
  });

  it('shows --min-pass-rate and --max-flaky-rate as skipped, not passed, when every test was skipped', () => {
    const skipped = ['s1', 's2'].map((testId): TestResultData => ({ testId, title: testId, file: 'a.spec.ts', status: 'skipped', outcome: 'skipped', duration: 0, retry: 0, steps: [], history: [] }));
    exportJsonData(skipped, { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, dir, 'all-skipped');

    const { status, stdout } = runGate(['--input', 'all-skipped-data.json', '--min-pass-rate', '90', '--max-flaky-rate', '5']);
    expect(status).toBe(0);
    expect(stdout).toContain('○ Min pass rate        (skipped — no test ran)');
    expect(stdout).toContain('○ Max flaky rate       (skipped — no test ran)');
  });

  it('evaluates --max-duration-regression from the duration baseline in the JSON export, and --no-new-flaky', () => {
    const { status, stdout } = runGate(['--input', 'timed-data.json', '--max-duration-regression', '20', '--no-new-flaky']);
    expect(status).toBe(1);
    expect(stdout).toContain('✗ Max duration regression 30% ≤ 20%');
    expect(stdout).toContain('○ No new flaky tests   (skipped — no comparison data)');
  });

  it('evaluates noNewClusters from the cluster tracking in the JSON export, in both CLIs, and skips it without clusters', () => {
    const failed = '✗ No new clusters      1 ≤ 0';
    expect(runGate(['--input', 'clustered-data.json', '--no-new-clusters'])).toMatchObject({ status: 1, stdout: expect.stringContaining(failed) });
    const config = writeJson('cluster-gates.json', { noNewClusters: true });
    const res = spawnSync(process.execPath, [bundle('cli'), 'gate', '--config', config, '--data', 'clustered-data.json'], { cwd: dir, encoding: 'utf-8' });
    expect([res.status, res.stdout.includes(failed)]).toEqual([1, true]);
    expect(runGate(['--input', 'scanned-data.json', '--no-new-clusters'])).toMatchObject({ status: 0, stdout: expect.stringContaining('○ No new clusters      (skipped — clustering off)') });
  });

  it('evaluates --no-expired-quarantine from the quarantine file next to --input, or the one --quarantine-file names', () => {
    writeExpiredQuarantine();
    const none = writeJson('no-expired-quarantine.json', { generatedAt: '2026-10-21T00:00:00.000Z', threshold: 0.3, entries: [] });
    const truncated = path.join(dir, 'truncated-quarantine.json');
    fs.writeFileSync(truncated, '{"entries": [');

    expect(runGate(['--input', 'scanned-data.json', '--no-expired-quarantine'])).toMatchObject({ status: 1, stdout: expect.stringContaining('  ✗ No expired quarantine 1 ≤ 0\n') });
    expect(runGate(['--input', 'scanned-data.json', '--no-expired-quarantine', '--quarantine-file', none]))
      .toMatchObject({ status: 0, stdout: expect.stringContaining('  ✓ No expired quarantine 0 ≤ 0\n') });
    expect(runGate(['--input', 'scanned-data.json', '--no-expired-quarantine', '--quarantine-file', 'missing.json']))
      .toMatchObject({ status: 0, stdout: expect.stringContaining('  ○ No expired quarantine (skipped — no quarantine data)\n') });
    expect(runGate(['--input', 'scanned-data.json', '--no-expired-quarantine', '--quarantine-file', truncated]))
      .toMatchObject({ status: 1, stderr: `Error: ${truncated} is not valid JSON: Unexpected end of JSON input` });
  });

  it('says why --min-stability-grade is skipped when no test has a grade', () => {
    const { status, stdout } = runGate(['--input', 'scoped-data.json', '--min-stability-grade', 'B']);
    expect(status).toBe(0);
    expect(stdout).toContain('○ Min stability grade  (skipped — no stability grades)');
  });

  it('rejects a flag with a missing or invalid value with a message instead of a crash or a silent pass', () => {
    expect(runGate(['--input'])).toMatchObject({ status: 1, stderr: 'Error: --input needs a value.' });
    expect(runGate(['--input', 'scanned-data.json', '--min-pass-rate', 'abc'])).toMatchObject({ status: 1, stderr: 'Error: --min-pass-rate needs a number (got "abc").' });
    expect(runGate(['--input', 'scanned-data.json', '--min-stability-grade', 'Z'])).toMatchObject({ status: 1, stderr: 'Error: --min-stability-grade must be A, B, C or D (got "Z").' });
  });

  it('shows usage examples that run this script, not the playwright-smart-reporter gate command', () => {
    const { stdout } = runGate(['--help']);
    expect(stdout).toContain('node node_modules/playwright-smart-reporter/dist/bin/gate.js --max-failures 5 --min-pass-rate 90');
    expect(stdout).not.toContain('playwright-smart-reporter gate --max-failures');
  });
});

describe('playwright-smart-reporter failures (src/bin/cli.ts)', () => {
  function runIn(cwd: string, args: string[]) {
    const res = spawnSync(process.execPath, [bundle('cli'), ...args], { cwd, encoding: 'utf-8' });
    return { status: res.status, stdout: res.stdout, stderr: res.stderr.trim() };
  }
  const failing: TestResultData = {
    testId: '[chromium] cart.spec.ts::checkout', title: 'checkout', file: 'cart.spec.ts', line: 3, status: 'failed', outcome: 'unexpected',
    duration: 1200, retry: 0, steps: [], history: [], error: 'Error: expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1',
  };

  it('finds smart-report-data.json in the working directory and prints each failure', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-failures-'));
    exportJsonData([failing], { runs: [], tests: {}, summaries: [] }, Date.now(), {}, undefined, undefined, cwd, 'smart-report');
    const { status, stdout } = runIn(cwd, ['failures']);
    expect(status).toBe(0);
    expect(stdout.split('\n').slice(0, 5)).toEqual([
      '1 failure(s) of 1 test(s)',
      '',
      '[chromium] cart.spec.ts::checkout',
      '  cart.spec.ts:3 · failed',
      '  Error: expect(received).toBe(expected)',
    ]);
    expect(JSON.parse(runIn(cwd, ['failures', '--json']).stdout).failures.map((f: { id: string }) => f.id)).toEqual(['[chromium] cart.spec.ts::checkout']);
  });

  it('exits 1 with a hint when there is no data file', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-failures-empty-'));
    const { status, stderr } = runIn(empty, ['failures']);
    expect(status).toBe(1);
    expect(stderr).toBe('Error: Data file not found: smart-report-failures.json or smart-report-data.json\nRun your tests with exportFailures: true (or exportJson: true) to generate it.');
  });
});

describe('other commands reject bad input with a message', () => {
  it('digest exits 1 on a format it cannot write', () => {
    const res = spawnSync(process.execPath, [bundle('cli'), 'digest', '--format', 'html'], { cwd: dir, encoding: 'utf-8' });
    expect([res.status, res.stderr.trim()]).toEqual([1, 'Error: Invalid format "html". Use markdown or text.']);
  });

  it('view-trace exits 1 with a message when playwright show-trace cannot start', () => {
    const trace = path.join(dir, 'trace.zip');
    fs.writeFileSync(trace, 'zip');
    // An empty PATH means npx cannot be found, so show-trace never starts (and never opens a window).
    const res = spawnSync(process.execPath, [bundle('view-trace'), trace], { cwd: dir, encoding: 'utf-8', env: { PATH: '' } });
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toMatch(/^Error: Could not run playwright show-trace: spawn npx\S* ENOENT$/);
  });
});

