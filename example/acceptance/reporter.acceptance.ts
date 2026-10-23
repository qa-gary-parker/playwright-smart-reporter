import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { divergenceSummary } from '../../src/analyzers/attempt-compare';
import type { ReportData } from '../../src/report-data/schema';

// Runs example/acceptance through the built reporter (dist/) with the options under test.
// Needs `npm run build`; run with `npm run test:acceptance`.
const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'node_modules/@playwright/test/cli.js');
const CONFIG = path.join(__dirname, 'playwright.config.ts');

let tmp: string;

function runSuite(out: string, options: object, args: string[] = [], command: 'test' | 'merge-reports' = 'test', env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [CLI, command, `--config=${CONFIG}`, ...args], {
    cwd: ROOT,
    env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options), ...env },
    encoding: 'utf8',
  });
  if (run.error) throw run.error;
  return { status: run.status, output: `${run.stdout}\n${run.stderr}` };
}

function reportData(html: string): ReportData {
  const start = html.indexOf('window.__SMART_DATA__=') + 'window.__SMART_DATA__='.length;
  return JSON.parse(html.slice(start, html.indexOf(';</script>', start)));
}

beforeAll(() => {
  if (!fs.existsSync(path.join(ROOT, 'dist/smart-reporter.js'))) throw new Error('dist/ is missing: run `npm run build` first');
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-acceptance-'));
});

afterAll(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

describe('live results', () => {
  it('writes the live file into a folder that does not exist yet, and the report finds it relative to itself', () => {
    const out = path.join(tmp, 'live');
    const liveFile = path.join(tmp, 'live-results', 'nested', 'run.jsonl');
    const run = runSuite(out, { live: { enabled: true, outputFile: liveFile } }, ['--grep', 'passes$']);

    expect(run.output).not.toContain('Error in reporter');
    expect(run.status).toBe(0);
    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    expect(data.tests.map((t) => t.title)).toEqual(['passes']);
    expect(data.config.live?.jsonlFile).toBe('../live-results/nested/run.jsonl');
    const events = fs.readFileSync(path.resolve(out, data.config.live!.jsonlFile), 'utf8').trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(['start', 'test', 'complete']);
  });
});

describe('history', () => {
  it('saves history into a folder that does not exist yet, and a breached gate still fails the run', () => {
    const out = path.join(tmp, 'history');
    const historyFile = path.join(tmp, 'history-store', 'nested', 'history.json');
    const run = runSuite(out, { historyFile, qualityGates: { minPassRate: 101 } }, ['--grep', 'passes$']);

    expect(run.output).not.toContain('Error in reporter');
    expect(run.status).toBe(1);
    expect(Object.keys(JSON.parse(fs.readFileSync(historyFile, 'utf8')).tests)).toEqual(['suite.fixtures.ts::passes']);
  });

  // On a pull_request run GITHUB_SHA is the merge commit GitHub makes; the event payload has the head of the pull request.
  it('saves the CI info of a GitHub pull request run in history and the JSON export', () => {
    const out = path.join(tmp, 'ci-info');
    const event = path.join(tmp, 'pull-request-event.json');
    const head = 'feedc0de00112233445566778899aabbccddeeff';
    fs.writeFileSync(event, JSON.stringify({ pull_request: { number: 42, head: { sha: head } } }));
    const run = runSuite(out, { exportJson: true }, ['--grep', 'passes$'], 'test', {
      GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event, GITHUB_SHA: '1111111111111111111111111111111111111111',
      GITHUB_REF: 'refs/pull/42/merge', GITHUB_REF_NAME: '42/merge', GITHUB_HEAD_REF: 'feature/cart', GITHUB_BASE_REF: 'main',
      GITHUB_RUN_ID: '777', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop',
    });

    expect(run.status).toBe(0);
    const ci = { provider: 'github', branch: 'feature/cart', commit: 'feedc0de', buildId: '777', sha: head, repoUrl: 'https://github.com/acme/shop', prNumber: 42, targetBranch: 'main' };
    const [summary] = JSON.parse(fs.readFileSync(path.join(out, 'test-history.json'), 'utf8')).summaries;
    const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    expect({ history: summary.ciInfo, json: json.metadata.ci }).toEqual({ history: ci, json: ci });
  });
});

describe('quality gate rules', () => {
  it('stops the run before any test when a rule has an unknown key', () => {
    const out = path.join(tmp, 'gate-unknown-key');
    const run = runSuite(out, { qualityGates: { rules: [{ bogus: 1 }] } }, ['--grep', 'passes$']);

    expect(run.status).toBe(1);
    expect(run.output).toContain('unknown key "bogus" in quality gate rules[0].');
    expect(fs.existsSync(path.join(out, 'pw.json'))).toBe(false);
  });

  it('scopes a rule to a tag, and passes the run when only a warn rule is breached', () => {
    const out = path.join(tmp, 'gate-scoped');
    const qualityGates = { rules: [{ scope: { tag: '@smoke' }, maxFlakyRate: 0 }, { maxFlakyRate: 0, severity: 'warn' }] };
    const run = runSuite(out, { qualityGates }, ['--grep', 'passes on retry|@smoke']);

    expect(run.status).toBe(0);
    expect(run.output).toContain('Result: PASSED with 1 warning (1 of 2 rules passed)');
    expect(reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).gates).toEqual({
      passed: true,
      rules: [
        { rule: 'maxFlakyRate', passed: true, actual: '0%', threshold: '≤ 0%', scope: 'tag @smoke' },
        { rule: 'maxFlakyRate', passed: false, actual: '33.4%', threshold: '≤ 0%', severity: 'warn' },
      ],
    });
  });

  // History as the reporter saves it, one run per entry, the last run being the baseline.
  function seedHistory(out: string, title: string, entries: Array<{ passed: boolean; duration: number; retry: number }>) {
    const runs = entries.map((_, i) => ({ runId: `seed-${i}`, timestamp: `2026-10-0${i + 1}T00:00:00.000Z` }));
    const summaries = runs.map((run, i) => ({
      ...run, total: 1, passed: 1, failed: 0, skipped: 0, flaky: entries[i].retry > 0 ? 1 : 0, slow: 0, duration: entries[i].duration, passRate: 100,
    }));
    const tests = { [`suite.fixtures.ts::${title}`]: entries.map((e, i) => ({ ...e, skipped: false, ...runs[i] })) };
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'test-history.json'), JSON.stringify({ runs: [], tests, summaries }));
  }

  it('fails noNewFlaky for a test that passed on a retry now and on the first attempt in the baseline run', () => {
    const out = path.join(tmp, 'gate-new-flaky');
    seedHistory(out, 'passes on retry', [{ passed: true, duration: 5, retry: 0 }]);
    const run = runSuite(out, { exportJson: true, qualityGates: { noNewFlaky: true } }, ['--grep', 'passes on retry']);

    expect(run.status).toBe(1);
    const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    expect(json.comparison.changes.newFlaky.map((t: { testId: string }) => t.testId)).toEqual(['suite.fixtures.ts::passes on retry']);
    expect(json.qualityGates.rules).toEqual([{ rule: 'noNewFlaky', passed: false, actual: '1', threshold: '≤ 0' }]);
  });

  it('fails maxDurationRegression when a test runs longer than the median of its passing runs', () => {
    const out = path.join(tmp, 'gate-duration');
    seedHistory(out, 'takes a second', [600, 600, 600, 600].map((duration) => ({ passed: true, duration, retry: 0 })));
    const run = runSuite(out, { exportJson: true, qualityGates: { maxDurationRegression: 20 } }, ['--grep', 'takes a second']);

    expect(run.status).toBe(1);
    const [rule] = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8')).qualityGates.rules;
    expect(rule).toMatchObject({ rule: 'maxDurationRegression', passed: false, threshold: '≤ 20%' });
    // About 1000ms against a 600ms median: 66.7% slower, plus the timer's overshoot.
    expect(parseFloat(rule.actual)).toBeGreaterThanOrEqual(66.7);
    expect(parseFloat(rule.actual)).toBeLessThan(100);
  });
});

describe('quarantine', () => {
  it('writes the quarantine file into a folder that does not exist yet', () => {
    const out = path.join(tmp, 'quarantine');
    const outputFile = path.join(tmp, 'quarantine-store', 'nested', 'quarantine.json');
    const options = { quarantine: { enabled: true, threshold: 0.01, outputFile } };
    // Passing on a retry in two runs in a row makes the test flaky (score 0.99).
    runSuite(out, options, ['--grep', 'passes on retry']);
    runSuite(out, options, ['--grep', 'passes on retry']);

    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries.map((e: { testId: string }) => e.testId)).toEqual(['suite.fixtures.ts::passes on retry']);
  });

  it('keeps quarantinedAt across runs and the entry of a test left out of the run, adds manual entries, and reports expired ones', () => {
    const out = path.join(tmp, 'quarantine-lifecycle');
    const outputFile = path.join(out, 'quarantine.json');
    const manualFile = path.join(out, 'quarantine.manual.json');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(manualFile, JSON.stringify({
      entries: [{ testId: 'suite.fixtures.ts::fails', title: 'fails', file: 'suite.fixtures.ts', ticket: 'PAY-12', expiresAt: '2026-01-01T00:00:00.000Z' }],
    }));
    const options = { quarantine: { enabled: true, threshold: 0.01, outputFile, manualFile } };
    const entries = () => JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries
      .map((e: { testId: string; source: string; quarantinedAt: string }) => [e.testId, e.source, e.quarantinedAt]);

    runSuite(out, options, ['--grep', 'passes on retry']);
    runSuite(out, options, ['--grep', 'passes on retry']);
    const second = entries();
    runSuite(out, options, ['--grep', 'passes on retry']);
    const third = entries();
    const run = runSuite(out, options, ['--grep', 'passes$']);

    expect({ third, fourth: entries() }).toEqual({ third: second, fourth: second });
    expect(second.map(([id, source]: string[]) => [id, source])).toEqual([['suite.fixtures.ts::passes on retry', 'auto'], ['suite.fixtures.ts::fails', 'manual']]);
    expect(run.output).toContain('Quarantine expired 2026-01-01T00:00:00.000Z: "fails" in suite.fixtures.ts, PAY-12');
  });

  it('fails the run on an expired quarantine entry with the noExpiredQuarantine gate', () => {
    const out = path.join(tmp, 'quarantine-gate');
    const manualFile = path.join(out, 'quarantine.manual.json');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(manualFile, JSON.stringify({ entries: [{ testId: 'suite.fixtures.ts::fails', title: 'fails', file: 'suite.fixtures.ts', expiresAt: '2026-01-01T00:00:00.000Z' }] }));
    const run = runSuite(out, { quarantine: { enabled: true, manualFile }, qualityGates: { noExpiredQuarantine: true } }, ['--grep', 'passes$']);

    expect(run.status).toBe(1);
    expect(run.output).toContain('  ✗ No expired quarantine 1 ≤ 0\n');
  });

  it('gives the report an empty quarantine, not none, when quarantine is on and no test qualifies', () => {
    const out = path.join(tmp, 'quarantine-empty');
    runSuite(out, { quarantine: { enabled: true, threshold: 0.3 } }, ['--grep', 'passes$']);

    expect(reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).quarantine).toEqual({ threshold: 0.3, entries: [] });
  });

  it('quarantines a test tagged @quarantine(ticket) or annotated quarantine', () => {
    const out = path.join(tmp, 'quarantine-annotation');
    const outputFile = path.join(out, 'quarantine.json');
    runSuite(out, { quarantine: { enabled: true, outputFile } }, [], 'test', { ACCEPTANCE_MATCH: 'quarantine.fixtures.ts' });

    expect(JSON.parse(fs.readFileSync(outputFile, 'utf8')).entries.map((e: { testId: string; source: string; ticket: string }) => [e.testId, e.source, e.ticket])).toEqual([
      ['quarantine.fixtures.ts::pays by card', 'annotation', 'https://jira.example.com/browse/PAY-14'],
      ['quarantine.fixtures.ts::refunds', 'annotation', 'PAY-15'],
    ]);
  });
});

describe('network log options', () => {
  const urls = (options: object) => {
    const out = path.join(tmp, `network-${JSON.stringify(options).replace(/\W/g, '')}`);
    runSuite(out, options, [], 'test', { ACCEPTANCE_MATCH: 'network.fixtures.ts' });
    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    return data.tests[0].networkLogs?.entries.map((e) => new URL(e.url).pathname);
  };

  it('leaves out static assets by default', () => {
    expect(urls({})).toEqual(['/', '/api/a', '/api/b', '/api/c']);
  });

  it('applies networkLogExcludeAssets, networkLogMaxEntries and networkLogFilter', () => {
    expect(urls({ networkLogExcludeAssets: false })).toEqual(['/', '/logo.png', '/api/a', '/api/b', '/api/c']);
    expect(urls({ networkLogMaxEntries: 2 })).toEqual(['/', '/api/a']);
    expect(urls({ networkLogFilter: '/api/b' })).toEqual(['/api/b']);
  });
});

describe('analysis switches', () => {
  it('skips retry analysis, failure clustering and stability scores when they are turned off', () => {
    const analysed = (out: string, options: object) => {
      runSuite(out, options, ['--grep', 'fails$|passes on retry']);
      const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
      return {
        clusters: data.clusters.length,
        clustered: data.tests.filter((t) => t.clusterId).length,
        scored: data.tests.filter((t) => t.stabilityScore).length,
        retryInfo: data.tests.filter((t) => t.retryInfo).length,
      };
    };
    expect(analysed(path.join(tmp, 'analysis-on'), {})).toEqual({ clusters: 1, clustered: 1, scored: 2, retryInfo: 2 });
    expect(analysed(path.join(tmp, 'analysis-off'), { enableRetryAnalysis: false, enableFailureClustering: false, enableStabilityScore: false }))
      .toEqual({ clusters: 0, clustered: 0, scored: 0, retryInfo: 0 });
  });
});

describe('AI analysis', () => {
  // A stub OpenAI-compatible provider that records the prompt of every request.
  let server: Server;
  let baseUrl: string;
  let prompts: string[];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        prompts.push(JSON.parse(raw).messages[0].content);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'stub suggestion' } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  // The failing test's error carries a credential pair and the value of a *_TOKEN env var.
  const AI_ENV = {
    ANTHROPIC_API_KEY: '', GEMINI_API_KEY: '', CLAUDE_CODE_OAUTH_TOKEN: '', OLLAMA_HOST: '', OLLAMA_MODEL: '',
    OPENAI_API_KEY: 'stub-openai-key',
    MY_TOKEN: 'tokenvalue-12345678',
    ACCEPTANCE_FAIL: 'api_key=abcd1234efgh tokenvalue-12345678',
  };

  // spawnSync would block this process, so the stub could not answer while the suite runs.
  async function runFailing(out: string, options: object) {
    prompts = [];
    const run = spawn(process.execPath, [CLI, 'test', `--config=${CONFIG}`, '--grep', 'fails when asked'], {
      cwd: ROOT,
      env: { ...process.env, ACCEPTANCE_OUT: out, ACCEPTANCE_OPTIONS: JSON.stringify(options), ...AI_ENV },
      stdio: 'ignore',
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      run.on('error', reject);
      run.on('close', resolve);
    });
    return { status, data: reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')) };
  }

  it('sends nothing to the provider when only a key is set', async () => {
    const { status, data } = await runFailing(path.join(tmp, 'ai-default'), { ai: { baseUrl } });

    expect(status).toBe(1);
    expect(prompts).toEqual([]);
    expect(data.ai).toEqual({ analysisOff: true, summaryOff: true });
  }, 60_000);

  it('with enableAIRecommendations: true, sends the failure, cluster and suite health prompts with secrets redacted', async () => {
    const { status, data } = await runFailing(path.join(tmp, 'ai-on'), { enableAIRecommendations: true, ai: { baseUrl } });

    expect(status).toBe(1);
    expect(prompts.map((p) => p.includes('api_key=[REDACTED] [REDACTED]'))).toEqual([true, true, false]);
    expect(prompts.filter((p) => /abcd1234efgh|tokenvalue-12345678/.test(p))).toEqual([]);
    expect(data.ai).toEqual({ suiteHealthSummary: 'stub suggestion', provider: 'openai', model: 'gpt-4o-mini' });
  }, 60_000);

  it('lists every attempt of the failure in its prompt, with the step they failed at', async () => {
    await runFailing(path.join(tmp, 'ai-attempts'), { enableAIRecommendations: true, ai: { baseUrl } });

    expect(prompts[0]).toMatch(
      /\n# Attempts\n\n- Attempt 1 \(failed, \d+ms\): Error: expect\(received\)\.toBeUndefined\(\)\n- Attempt 2 \(failed, \d+ms\): Error: expect\(received\)\.toBeUndefined\(\)\n\nEvery attempt failed at step 'Expect "toBeUndefined"'\n/,
    );
  }, 60_000);
});

describe('failure clustering', () => {
  it('splits timeouts by locator, merges failures that differ only in numbers, and keeps ids across runs', () => {
    const clusters = (out: string) => {
      runSuite(out, {}, ['--retries=0'], 'test', { ACCEPTANCE_MATCH: 'cluster.fixtures.ts' });
      return reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).clusters;
    };
    const first = clusters(path.join(tmp, 'clusters-1'));
    const second = clusters(path.join(tmp, 'clusters-2'));

    expect(first.map((c) => [c.errorType, c.testIds])).toEqual([
      ["TimeoutError: locator.click: Timeout <n>ms exceeded. on locator('#save') at cluster.fixtures.ts:5", ['cluster.fixtures.ts::clicks the missing save button']],
      ["TimeoutError: locator.click: Timeout <n>ms exceeded. on locator('#cancel') at cluster.fixtures.ts:5", ['cluster.fixtures.ts::clicks the missing cancel button']],
      ['cart <n> holds <n> items at cluster.fixtures.ts:19', ['cluster.fixtures.ts::cart 1041 is empty', 'cluster.fixtures.ts::cart 2087 is empty']],
    ]);
    expect(first.map((c) => c.id)).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), expect.stringMatching(/^[0-9a-f]{16}$/), expect.stringMatching(/^[0-9a-f]{16}$/)]);
    expect(new Set(first.map((c) => c.id)).size).toBe(3);
    // Each run has its own history, so only the start of the run in tracking differs
    const untracked = (clusters: ReportData['clusters']) => clusters.map(({ tracking: _tracking, ...c }) => c);
    expect(untracked(second)).toEqual(untracked(first));
  }, 60_000);

  it('labels a cluster seen in run 1, gone in run 2 and back in run 3 Regressed, and lists the cluster that went away as resolved', () => {
    const out = path.join(tmp, 'cluster-tracking');
    const run = (broken: string, sha: string) => {
      const { status } = runSuite(out, { exportJson: true }, ['--retries=0', '--grep', 'draft'], 'test', {
        ACCEPTANCE_MATCH: 'cluster.fixtures.ts', BROKEN_DRAFTS: broken, GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '', GITHUB_SHA: sha.repeat(40),
        GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop',
      });
      expect(status).toBe(1);
      const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
      const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
      return { data, json, start: new Date(data.meta.startTime).toISOString() };
    };
    const notesTest = 'cluster.fixtures.ts::keeps the notes draft';
    const titleTest = 'cluster.fixtures.ts::keeps the title draft';
    const at = (c: string) => ({ commit: c.repeat(8), sha: c.repeat(40) });
    const failedAtA = { firstFailed: at('a'), url: `https://github.com/acme/shop/commit/${'a'.repeat(40)}` };
    // notes passed in run 2 and failed again in run 3
    const run2To3 = { lastPassed: at('b'), firstFailed: at('c'), url: `https://github.com/acme/shop/compare/${'b'.repeat(40)}...${'c'.repeat(40)}` };

    const first = run('notes,title', 'a');
    const second = run('title', 'b');
    const third = run('notes', 'c');
    const [notes, title] = first.data.clusters.map((c) => c.id);

    // The first run has no history to compare with
    expect(first.data.clusters.map((c) => [c.testIds, c.tracking])).toEqual([[[notesTest], undefined], [[titleTest], undefined]]);
    expect(second.data.clusters.map((c) => [c.id, c.tracking])).toEqual([[title, { status: 'recurring', runs: 2, since: first.start, sinceCommit: 'aaaaaaaa', trend: [1, 1], commits: failedAtA }]]);
    expect(third.data.clusters.map((c) => [c.id, c.tracking])).toEqual([[notes, { status: 'regressed', runs: 1, since: third.start, sinceCommit: 'cccccccc', trend: [1, 0, 1], commits: run2To3 }]]);
    expect(third.json.tests.find((t: { testId: string }) => t.testId === notesTest).commits).toEqual(run2To3);
    expect(third.data.resolvedClusters).toEqual([{ id: title, testIds: [titleTest] }]);
    expect([third.json.failureClusters.map((c: { tracking: unknown }) => c.tracking), third.json.resolvedClusters]).toEqual([
      third.data.clusters.map((c) => c.tracking),
      third.data.resolvedClusters,
    ]);
    const saved = JSON.parse(fs.readFileSync(path.join(out, 'test-history.json'), 'utf8')).tests;
    expect([saved[notesTest].map((e: { clusterId?: string }) => e.clusterId), saved[titleTest].map((e: { clusterId?: string }) => e.clusterId)]).toEqual([
      [notes, undefined, notes],
      [title, title, undefined],
    ]);
  });

  it('noNewClusters fails only on a cluster that no run in history had, and is skipped with no cluster history', () => {
    const out = path.join(tmp, 'no-new-clusters');
    const gate = (broken: string) => {
      runSuite(out, { qualityGates: { noNewClusters: true } }, ['--retries=0', '--grep', 'draft'], 'test', { ACCEPTANCE_MATCH: 'cluster.fixtures.ts', BROKEN_DRAFTS: broken });
      return reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).gates?.rules;
    };
    const rule = (passed: boolean, actual: string) => [{ rule: 'noNewClusters', passed, actual, threshold: '≤ 0' }];

    expect(gate('notes')).toEqual([{ rule: 'noNewClusters', passed: true, actual: 'N/A', threshold: '≤ 0', skipped: true, skipReason: 'no cluster history' }]);
    expect(gate('')).toEqual(rule(true, '0'));
    expect(gate('title')).toEqual(rule(false, '1'));
    // notes came back (regressed) and title failed again (recurring): neither is new
    expect(gate('notes,title')).toEqual(rule(true, '0'));
  });
});

describe('tags and suites', () => {
  it('reads tags from the title without taking the domain of an email address as a tag', () => {
    const out = path.join(tmp, 'tags');
    runSuite(out, {}, ['--grep', 'login as']);

    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    // Playwright's own test.tags gives '@example.com'.
    expect(data.tests.map((t) => t.tags)).toEqual([['@example.com', '@smoke']]);
  });

  it('keeps a dotted title tag as Playwright gives it, without a second, shorter tag', () => {
    const out = path.join(tmp, 'tags-dotted');
    runSuite(out, {}, ['--grep', 'logs out']);

    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    expect(data.tests.map((t) => t.tags)).toEqual([['@smoke.fast']]);
  });

  it('reads tags from the title when Playwright gives no test.tags, as before 1.42', () => {
    const out = path.join(tmp, 'tags-without-test-tags');
    const run = runSuite(out, {}, ['--grep', 'login as'], 'test', { ACCEPTANCE_WITHOUT_TAGS: '1' });

    expect(run.status).toBe(0);
    const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    expect(data.tests.map((t) => t.tags)).toEqual([['@smoke']]);
  });

  it('starts the suite path with the file for an unnamed project, the same as for a named one', () => {
    for (const projects of ['', 'chromium']) {
      const out = path.join(tmp, `suites-${projects || 'unnamed'}`);
      runSuite(out, {}, ['--grep', 'login as|passes$'], 'test', { ACCEPTANCE_PROJECTS: projects });

      const data = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
      expect(data.tests.map((t) => [t.project, t.title, t.suites, t.suite])).toEqual([
        [projects || undefined, 'passes', ['suite.fixtures.ts'], 'suite.fixtures.ts'],
        [projects || undefined, 'login as user@example.com @smoke', ['suite.fixtures.ts', 'sign in'], 'sign in'],
      ]);
    }
  });
});

describe('report write failure', () => {
  it('says the report could not be written, and does not print its path as if it was', () => {
    const out = path.join(tmp, 'blocked');
    fs.mkdirSync(out, { recursive: true });
    // A file where the report folder should be makes the write fail.
    fs.writeFileSync(path.join(out, 'not-a-folder'), '');
    const run = runSuite(out, { outputFile: path.join(out, 'not-a-folder', 'smart-report.html'), exportJson: true }, ['--grep', 'passes$']);

    expect(run.output).toContain('Smart Reporter could not write the HTML report');
    expect(run.output).not.toContain('📊 Smart Report:');
  });
});

describe('failed attempts', () => {
  const TRACE = 'attempts.fixtures.ts____fails once with a screenshot-attempt-1-trace-0.zip';
  const run = (name: string, options: object, grep: string) => {
    const out = path.join(tmp, name);
    runSuite(out, options, ['--grep', grep], 'test', { ACCEPTANCE_MATCH: 'attempts.fixtures.ts' });
    return out;
  };
  const cspSafeData = (out: string): ReportData => {
    const js = fs.readFileSync(path.join(out, 'smart-report-data.js'), 'utf8');
    return JSON.parse(js.slice('window.__SMART_DATA__='.length, js.lastIndexOf(';')));
  };
  const outputFiles = (out: string) =>
    (fs.readdirSync(out, { recursive: true }) as string[])
      .filter((f) => !f.startsWith('test-results') && fs.statSync(path.join(out, f)).isFile())
      .map((f) => f.split(path.sep).join('/'))
      .sort();
  // The run's own history file (#67)
  const HISTORY_RUN_FILE = expect.stringMatching(/^test-history\.runs\/run-\d+\.json$/);

  it('keeps the screenshot and trace of an attempt that failed before the retry passed', () => {
    const out = run('attempts', {}, 'fails once');
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect(test.attempts?.map((a) => a.attachments)).toEqual([
      { screenshots: ['data:image/png;base64,iVBORw0KGgo='], videos: [], traces: [`./traces/${TRACE}`] },
      undefined,
    ]);
    expect(test.attempts?.[0].tracePath).toBe(path.join(out, 'test-results/attempts.fixtures.ts-fails-once-with-a-screenshot/trace.zip'));
    expect(test.attachments).toEqual({ screenshots: [], videos: [], traces: [], custom: [] });
    expect(fs.readdirSync(path.join(out, 'traces'))).toEqual([TRACE]);
  });

  it('with cspSafe, leaves no screenshot file in the output folder that the report does not link to', () => {
    const out = run('attempts-csp', { cspSafe: true }, 'fails once');
    const linked = cspSafeData(out).tests
      .flatMap((t) => [t.attachments, ...(t.attempts ?? []).map((a) => a.attachments)])
      .flatMap((a) => (a ? [...a.screenshots, ...a.videos, ...a.traces] : []))
      .map((p) => path.posix.normalize(p));
    const files = outputFiles(out);

    expect(files.filter((f) => !linked.includes(f))).toEqual(['pw-junit.xml', 'pw.json', 'smart-report-data.js', 'smart-report.css', 'smart-report.html', 'smart-report.js', 'test-history.json', HISTORY_RUN_FILE]);
    expect(files.filter((f) => linked.includes(f))).toEqual(['smart-report-screenshot-1.png', `traces/${TRACE}`]);
  });

  it('records the parent and depth of nested steps, so a retry that ran one more step still lines up', () => {
    const out = run('attempts-steps', {}, 'second try');
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect(test.attempts?.map((a) => a.steps.map((s) => [s.title, s.parent, s.depth, s.failed]))).toEqual([
      [['checkout', undefined, undefined, true], ['pay', 0, 1, true]],
      [['checkout', undefined, undefined, undefined], ['accept cookies', 0, 1, undefined], ['pay', 0, 1, undefined]],
    ]);
    expect(divergenceSummary(test.attempts!)).toMatch(/^Attempt 1 failed at step 'checkout › pay' after \d+ms; attempt 2 passed it in \d+ms$/);
  });

  it("with trace: 'on', lists the requests and console errors that differ between the failed and the passing attempt", () => {
    const out = path.join(tmp, 'attempts-trace-on');
    runSuite(out, {}, [], 'test', { ACCEPTANCE_MATCH: 'attempt-trace.fixtures.ts' });
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect(test.outcome).toBe('flaky');
    expect(test.attemptDiff).toEqual({
      failed: 0,
      passed: 1,
      network: [
        { method: 'GET', url: 'http://cart.test/api/cart', failed: 500, passed: 200 },
        { method: 'GET', url: 'http://cart.test/api/promo', passed: 200 },
      ],
      console: [
        { level: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' },
        { level: 'error', text: 'cart failed: 500' },
      ],
    });
  });

  it('with redact, masks the request URLs and console text of the comparison', () => {
    const out = path.join(tmp, 'attempts-trace-redact');
    runSuite(out, { redact: { patterns: ['promo', 'cart failed'] } }, [], 'test', { ACCEPTANCE_MATCH: 'attempt-trace.fixtures.ts' });
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect([test.attemptDiff?.network, test.attemptDiff?.console?.[1]]).toEqual([
      [
        { method: 'GET', url: 'http://cart.test/api/cart', failed: 500, passed: 200 },
        { method: 'GET', url: 'http://cart.test/api/[REDACTED]', passed: 200 },
      ],
      { level: 'error', text: '[REDACTED]: 500' },
    ]);
  });

  it("with trace: 'retain-on-failure', names the passing attempt as the one without a trace", () => {
    const out = run('attempts-retain', {}, 'fails once');
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect(test.attemptDiff).toEqual({ failed: 0, passed: 1, missingTrace: [1] });
  });

  it('for test.fail(), compares the attempt that passed with the attempt that failed as expected', () => {
    const out = run('attempts-test-fail', {}, 'expected to fail and passes once');
    const [test] = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8')).tests;

    expect([test.outcome, test.attemptDiff]).toEqual(['flaky', { failed: 0, passed: 1, missingTrace: [1] }]);
    expect(test.aiPrompt).toMatch(/^Attempt 1 passed after \d+ms; attempt 2 failed in \d+ms$/m);
  });

  it('keeps no evidence on earlier attempts of a test that failed every time, and writes no files for them', () => {
    const out = run('attempts-all-failed', { cspSafe: true }, 'fails every time');
    const [test] = cspSafeData(out).tests;

    expect(test.attempts?.map((a) => a.attachments)).toEqual([undefined, undefined]);
    expect(test.attempts?.map((a) => a.tracePath)).toEqual([undefined, undefined]);
    expect(test.attachments?.screenshots).toEqual(['smart-report-screenshot-1.png']);
    expect(outputFiles(out)).toEqual([
      'pw-junit.xml',
      'pw.json',
      'smart-report-data.js',
      'smart-report-screenshot-1.png',
      'smart-report.css',
      'smart-report.html',
      'smart-report.js',
      'test-history.json',
      HISTORY_RUN_FILE,
      'traces/attempts.fixtures.ts____fails every time with a screenshot-trace-0.zip',
    ]);
  });
});

describe('merge-reports', () => {
  it('reports the duration of the tests, not of the merge', () => {
    const blobs = path.join(tmp, 'blobs');
    const out = path.join(tmp, 'merged');
    runSuite(path.join(tmp, 'shard'), {}, ['--reporter=blob', '--grep', 'takes a second'], 'test', { PLAYWRIGHT_BLOB_OUTPUT_DIR: blobs });
    const merge = runSuite(out, { exportJson: true }, [blobs], 'merge-reports');

    expect(merge.status).toBe(0);
    const { summary } = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    expect(summary.total).toBe(1);
    expect(summary.duration).toBeGreaterThanOrEqual(1000);
  });

  it('saves the duration, start and id of the sharded run in history, not of the merge', () => {
    const blobs = path.join(tmp, 'shard-blobs');
    const out = path.join(tmp, 'merged-shards');
    fs.mkdirSync(blobs, { recursive: true });
    for (const n of [1, 2]) {
      const shardBlobs = path.join(tmp, `shard-${n}-blob`);
      runSuite(path.join(tmp, `shard-${n}`), {}, ['--reporter=blob', '--grep', 'takes a second|passes$', '--fully-parallel', `--shard=${n}/2`], 'test', { PLAYWRIGHT_BLOB_OUTPUT_DIR: shardBlobs });
      for (const zip of fs.readdirSync(shardBlobs)) fs.copyFileSync(path.join(shardBlobs, zip), path.join(blobs, zip));
    }
    const merge = runSuite(out, { exportJson: true }, [blobs], 'merge-reports');

    expect(merge.status).toBe(0);
    const json = JSON.parse(fs.readFileSync(path.join(out, 'smart-report-data.json'), 'utf8'));
    const { meta } = reportData(fs.readFileSync(path.join(out, 'smart-report.html'), 'utf8'));
    const [summary] = JSON.parse(fs.readFileSync(path.join(out, 'test-history.json'), 'utf8')).summaries;
    expect(json.summary.total).toBe(2);
    expect(json.summary.duration).toBeGreaterThanOrEqual(1000);
    expect(Math.abs(summary.duration - json.summary.duration)).toBeLessThan(100);
    expect({ runId: summary.runId, timestamp: summary.timestamp }).toEqual({ runId: `run-${meta.startTime}`, timestamp: new Date(meta.startTime).toISOString() });
    expect(meta.runId).toBe(summary.runId);
  });
});

describe('redact', () => {
  const TOKEN = 'tok-acceptance-7f3a9c21';
  const EMAIL = 'qa.user@example.com';
  const CONTROL = 'control text kept';

  // What each output file of one failed test contains.
  const outputs = (name: string, redact?: object | boolean) => {
    const out = path.join(tmp, name);
    const options = {
      exportJson: true, exportJunit: true, exportCtrf: true, enableHistoryDrilldown: true,
      live: { enabled: true, outputFile: path.join(out, 'live.jsonl') },
      ...(redact === undefined ? {} : { redact }),
    };
    runSuite(out, options, [], 'test', { ACCEPTANCE_MATCH: 'redact.fixtures.ts', MY_API_TOKEN: TOKEN });
    const read = (file: string) => fs.readFileSync(path.join(out, file), 'utf8');
    const html = read('smart-report.html');
    const runs = fs.readdirSync(path.join(out, 'history-runs'));
    expect(runs).toHaveLength(1);
    const files = {
      'report data': html.slice(html.indexOf('window.__SMART_DATA__='), html.indexOf(';</script>', html.indexOf('window.__SMART_DATA__='))),
      aiPrompt: reportData(html).tests[0].aiPrompt ?? '',
      'smart-report-data.json': read('smart-report-data.json'),
      'smart-report-junit.xml': read('smart-report-junit.xml'),
      'smart-report-ctrf.json': read('smart-report-ctrf.json'),
      'history-runs/<id>.json': read(path.join('history-runs', runs[0])),
      'live.jsonl': read('live.jsonl'),
    };
    return Object.fromEntries(Object.entries(files).map(([file, text]) => [file, {
      token: text.includes(TOKEN), redacted: text.includes('[REDACTED]'), email: text.includes(EMAIL), control: text.includes(CONTROL),
    }]));
  };
  const everyFile = (found: object) => Object.fromEntries(
    ['report data', 'aiPrompt', 'smart-report-data.json', 'smart-report-junit.xml', 'smart-report-ctrf.json', 'history-runs/<id>.json', 'live.jsonl'].map((f) => [f, found]),
  );

  it('leaves the token in every file when redact is not set', () => {
    expect(outputs('redact-unset')).toEqual(everyFile({ token: true, redacted: false, email: true, control: true }));
  });

  it('with redact: true, masks the token in every file and keeps text that is not secret', () => {
    expect(outputs('redact-on', true)).toEqual(everyFile({ token: false, redacted: true, email: true, control: true }));
  });

  it('with redact.patterns, also masks what the patterns match', () => {
    expect(outputs('redact-patterns', { patterns: ['[\\w.]+@example\\.com'] })).toEqual(everyFile({ token: false, redacted: true, email: false, control: true }));
  });

  it('stops the run before any test when a pattern matches an empty string', () => {
    const out = path.join(tmp, 'redact-empty-pattern');
    const run = runSuite(out, { redact: { patterns: [''] } }, ['--grep', 'passes$']);

    expect(run.status).toBe(1);
    expect(run.output).toContain('redact.patterns[0] "" matches an empty string');
    expect(fs.existsSync(path.join(out, 'pw.json'))).toBe(false);
  });
});
