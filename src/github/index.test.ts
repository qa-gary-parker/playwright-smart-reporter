import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGithubCommand } from './index';
import { renderSummary } from './summary';
import type { GhResult, GhRunner } from './pr-comment';
import type { JsonExportData } from '../generators/json-exporter';

const WORKSPACE = '/home/runner/work/shop/shop';

const data: JsonExportData = {
  metadata: { generatedAt: '2026-10-08T10:00:00.000Z', reporterVersion: '3.0.0', rootDir: `${WORKSPACE}/e2e` },
  summary: { total: 1, passed: 0, failed: 1, skipped: 0, flaky: 0, duration: 1200, passRate: 0 },
  tests: [{
    testId: 'a', title: 'checkout', file: 'cart.spec.ts', line: 3, column: 5, status: 'failed', outcome: 'unexpected', retry: 0, duration: 1200,
    error: 'Error: boom', errorLocation: { file: 'cart.spec.ts', line: 8, column: 11 },
  }],
};
const ANNOTATION = '::error file=e2e/cart.spec.ts,line=8,col=11,title=checkout::Error: boom';

describe('runGithubCommand', () => {
  let dir: string;
  let logs: string[];
  let ghCalls: string[][];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-cmd-'));
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify(data));
    logs = [];
    ghCalls = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function run(env: NodeJS.ProcessEnv, responses: GhResult[] = []): number {
    const gh: GhRunner = (args) => {
      ghCalls.push(args);
      const next = responses.shift();
      if (!next) throw new Error(`unexpected gh call: ${args.join(' ')}`);
      return next;
    };
    return runGithubCommand(
      { dataPath: path.join(dir, 'data.json'), reportUrl: 'https://example.test/report' },
      { env: { GITHUB_WORKSPACE: WORKSPACE, ...env }, cwd: '/elsewhere', gh, log: (l) => logs.push(l) },
    );
  }

  function event(payload: unknown): string {
    const file = path.join(dir, 'event.json');
    fs.writeFileSync(file, JSON.stringify(payload));
    return file;
  }

  it('degrades a fork pull request to summary and annotations without calling gh or failing', () => {
    const summaryFile = path.join(dir, 'summary.md');
    fs.writeFileSync(summaryFile, 'earlier step\n');
    const code = run({
      GITHUB_STEP_SUMMARY: summaryFile,
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_EVENT_PATH: event({ pull_request: { number: 5, head: { repo: { full_name: 'someone/shop' } }, base: { repo: { full_name: 'acme/shop' } } } }),
    });

    expect(code).toBe(0);
    expect(fs.readFileSync(summaryFile, 'utf-8'))
      .toBe(`earlier step\n${renderSummary(data, { reportUrl: 'https://example.test/report#/q/failures', workspace: WORKSPACE })}\n`);
    expect(logs).toEqual([
      ANNOTATION,
      'Pull request comment skipped: pull request comes from a fork (someone/shop), so the token cannot write comments.',
    ]);
    expect(ghCalls).toEqual([]);
  });

  it('keeps the step green with a warning when the comment write returns 403', () => {
    const code = run({
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_EVENT_PATH: event({ pull_request: { number: 5, head: { repo: { full_name: 'acme/shop' } }, base: { repo: { full_name: 'acme/shop' } } } }),
    }, [
      { status: 0, stdout: '', stderr: '' },
      { status: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' },
    ]);

    expect(code).toBe(0);
    expect(logs).toEqual([
      ANNOTATION,
      '::warning::Pull request comment skipped: the token lacks pull-requests: write (HTTP 403). The job summary and annotations were still published.',
    ]);
    expect(ghCalls.map((args) => args.slice(0, 3))).toEqual([
      ['api', '--paginate', 'repos/acme/shop/issues/5/comments'],
      ['api', '--method', 'POST'],
    ]);
  });

  it('keeps the step green with a warning when gh returns output it cannot parse', () => {
    const code = run({
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_REPOSITORY: 'acme/shop',
      GITHUB_EVENT_PATH: event({ pull_request: { number: 5, head: { repo: { full_name: 'acme/shop' } }, base: { repo: { full_name: 'acme/shop' } } } }),
    }, [{ status: 0, stdout: 'A new release of gh is available\n', stderr: '' }]);

    expect(code).toBe(0);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toBe(ANNOTATION);
    // JSON.parse wording differs between Node versions.
    expect(logs[1]).toMatch(/^::warning::Pull request comment failed: Unexpected token .*JSON/);
  });

  it('links the report of a failed run straight to its failures, but not a passing run or a URL with its own fragment', () => {
    const linkFor = (reportUrl: string, tests: JsonExportData['tests']) => {
      fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ ...data, tests }));
      const out: string[] = [];
      runGithubCommand({ dataPath: path.join(dir, 'data.json'), reportUrl }, { env: {}, cwd: WORKSPACE, gh: () => { throw new Error('gh must not run'); }, log: (l) => out.push(l) });
      return out[0].split('\n').find((l) => l.startsWith('[Open the full report]'));
    };
    const passed = [{ ...data.tests[0], status: 'passed', outcome: 'expected', error: undefined, errorLocation: undefined }];

    expect(linkFor('https://example.test/report.html', data.tests)).toBe('[Open the full report](https://example.test/report.html#/q/failures)');
    expect(linkFor('https://example.test/report.html', passed)).toBe('[Open the full report](https://example.test/report.html)');
    expect(linkFor('https://example.test/report.html#/insights', data.tests)).toBe('[Open the full report](https://example.test/report.html#/insights)');
  });

  it('redacts secrets from the annotation messages', () => {
    const secret = 'super-secret-env-value-123';
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ ...data, tests: [{ ...data.tests[0], error: `Error: login failed with token ${secret}` }] }));
    const out: string[] = [];
    runGithubCommand({ dataPath: path.join(dir, 'data.json') }, { env: { API_TOKEN: secret }, cwd: WORKSPACE, gh: () => { throw new Error('gh must not run'); }, log: (l) => out.push(l) });
    expect(out[1]).toBe('::error file=e2e/cart.spec.ts,line=8,col=11,title=checkout::Error: login failed with token [REDACTED]');
  });

  it('fails with an error annotation when the data file is not a JSON export', () => {
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ format: 'playwright-smart-reporter/failures', failures: [] }));
    const out: string[] = [];
    const code = runGithubCommand({ dataPath: path.join(dir, 'data.json') }, { env: {}, cwd: WORKSPACE, gh: () => { throw new Error('gh must not run'); }, log: (l) => out.push(l) });
    expect(code).toBe(1);
    expect(out).toEqual([`::error::${path.join(dir, 'data.json')} is not a Smart Reporter JSON export (it has no tests and summary). Pass the file written by exportJson: true.`]);
  });

  it('prints the summary to stdout outside GitHub Actions and links the run when no report URL is given', () => {
    const code = runGithubCommand(
      { dataPath: path.join(dir, 'data.json') },
      {
        env: { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop', GITHUB_RUN_ID: '99' },
        cwd: WORKSPACE,
        gh: () => { throw new Error('gh must not run'); },
        log: (l) => logs.push(l),
      },
    );

    expect(code).toBe(0);
    expect(logs).toEqual([
      renderSummary(data, { reportUrl: 'https://github.com/acme/shop/actions/runs/99', workspace: WORKSPACE }),
      ANNOTATION,
      'Pull request comment skipped: not a pull request event (none).',
    ]);
  });

  it('fails with an error annotation when the data file is missing', () => {
    const code = runGithubCommand(
      { dataPath: path.join(dir, 'missing.json') },
      { env: {}, cwd: dir, gh: () => { throw new Error('gh must not run'); }, log: (l) => logs.push(l) },
    );

    expect(code).toBe(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^::error::Cannot read Smart Reporter data at .*missing\.json: ENOENT.*Run the tests with exportJson: true\.$/);
  });
});

describe('runGithubCommand --issues', () => {
  const SECRET = 'super-secret-env-value-123';
  const ID = '0123456789abcdef';
  const MARKER = `<!-- playwright-smart-reporter cluster:${ID} -->`;
  const COMPARE = 'https://github.com/acme/shop/compare/aaa...bbb';
  const LIST = ['api', '--paginate', 'repos/acme/shop/issues?state=open&per_page=100', '--jq', '.[] | select(.body // "" | contains("<!-- playwright-smart-reporter cluster:")) | {number, body}'];
  const CREATE = ['api', '--method', 'POST', 'repos/acme/shop/issues', '--input', '-', '--jq', '.number'];
  const BODY = [
    `**New failure cluster:** \`login failed with token [REDACTED] at cart.spec.ts:8\``,
    '',
    `1 test in cluster \`${ID}\`:`,
    '',
    '| Test | Location |',
    '|---|---|',
    '| `checkout` | `e2e/cart.spec.ts:8` |',
    '',
    '```',
    'Error: login failed with token [REDACTED]',
    '```',
    '',
    `**Commits:**<br>Last passed at \`aaaaaaaa\`, first failed at \`bbbbbbbb\` ([compare](${COMPARE}))<br>Changed: \`src/cart.ts\``,
    '',
    '[Open the full report](https://example.test/report#/q/failures)',
    '',
  ].join('\n');

  type Status = 'new' | 'recurring' | 'regressed';
  // null: history could not tell, so the cluster has no tracking
  const cluster = (id: string, count = 1, status: Status | null = 'new') => ({
    id,
    errorType: `login failed with token ${SECRET} at cart.spec.ts:8`,
    count,
    testIds: ['a'],
    tracking: status === null ? undefined : {
      status, runs: 1, since: '2026-10-08T10:00:00.000Z', trend: [0, count],
      commits: { lastPassed: { commit: 'aaaaaaaa' }, firstFailed: { commit: 'bbbbbbbb' }, url: COMPARE, suspects: ['src/cart.ts'] },
    },
  });
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });

  let dir: string;
  let logs: string[];
  let calls: { args: string[]; body?: unknown }[];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-issues-'));
    logs = [];
    calls = [];
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function run(clusters: unknown[], responses: GhResult[] = [], issues = true): number {
    const tests = [{ ...data.tests[0], error: `Error: login failed with token ${SECRET}` }];
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({ ...data, tests, failureClusters: clusters }));
    const gh: GhRunner = (args, stdin) => {
      calls.push({ args, body: stdin === undefined ? undefined : JSON.parse(stdin) });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected gh call: ${args.join(' ')}`);
      return next;
    };
    return runGithubCommand(
      { dataPath: path.join(dir, 'data.json'), reportUrl: 'https://example.test/report', issues },
      {
        env: { GITHUB_WORKSPACE: WORKSPACE, GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'), GITHUB_REPOSITORY: 'acme/shop', API_TOKEN: SECRET },
        cwd: '/elsewhere',
        gh,
        log: (l) => logs.push(l),
      },
    );
  }

  it('creates one issue for a new cluster, with the marker and the redacted error', () => {
    const code = run([cluster(ID)], [ok(), ok('12\n')]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { args: LIST, body: undefined },
      { args: CREATE, body: { title: 'New failure cluster: login failed with token [REDACTED] at cart.spec.ts:8', body: `${MARKER}\n${BODY}` } },
    ]);
    expect(logs.slice(1)).toEqual([
      `Issue #12 created for new failure cluster ${ID}.`,
      'Pull request comment skipped: not a pull request event (none).',
    ]);
  });

  it('comments on the open issue that carries the marker of the cluster instead of opening a second one', () => {
    const code = run([cluster(ID)], [
      ok([
        JSON.stringify({ number: 7, body: '<!-- playwright-smart-reporter cluster:fedcba9876543210 -->\nother' }),
        JSON.stringify({ number: 9, body: `${MARKER}\nearlier run` }),
      ].join('\n')),
      ok('{}'),
    ]);

    expect(code).toBe(0);
    expect(calls).toEqual([
      { args: LIST, body: undefined },
      { args: ['api', '--method', 'POST', 'repos/acme/shop/issues/9/comments', '--input', '-'], body: { body: BODY } },
    ]);
    expect(logs[1]).toBe(`Comment added to issue #9 for new failure cluster ${ID}.`);
  });

  it('makes no gh call for recurring, regressed or untracked clusters', () => {
    const code = run([cluster('1111111111111111', 1, 'recurring'), cluster('2222222222222222', 1, 'regressed'), cluster('3333333333333333', 1, null)]);

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(logs[1]).toBe('Issues skipped: no new failure clusters in this run.');
  });

  it('makes no gh call for a new cluster unless issues are turned on', () => {
    const code = run([cluster(ID)], [], false);

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    expect(logs.slice(1)).toEqual(['Pull request comment skipped: not a pull request event (none).']);
  });

  it('files at most 5 clusters per run, largest first, and says how many it left out', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c) => c.repeat(16));
    const counts = [1, 7, 3, 6, 2, 5, 4];
    const code = run(ids.map((id, i) => cluster(id, counts[i])), [ok(), ...[1, 2, 3, 4, 5].map((n) => ok(`${n}\n`))]);

    expect(code).toBe(0);
    expect(calls.slice(1).map((c) => (c.body as { body: string }).body.split('\n')[0]))
      .toEqual(['b', 'd', 'f', 'g', 'c'].map((c) => `<!-- playwright-smart-reporter cluster:${c.repeat(16)} -->`));
    expect(logs.slice(1, 7)).toEqual([
      ...['b', 'd', 'f', 'g', 'c'].map((c, i) => `Issue #${i + 1} created for new failure cluster ${c.repeat(16)}.`),
      '2 more new failure cluster(s) not filed: at most 5 issues per run.',
    ]);
  });

  it('cuts the title to the 256 characters GitHub accepts', () => {
    run([{ ...cluster(ID), errorType: 'x'.repeat(300) }], [ok(), ok('12\n')]);

    expect((calls[1].body as { title: string }).title).toBe(`New failure cluster: ${'x'.repeat(232)}...`);
  });

  it('keeps the step green with a warning when the token cannot write issues (HTTP 403)', () => {
    const code = run([cluster(ID)], [ok(), { status: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' }]);

    expect(code).toBe(0);
    expect(calls.map((c) => c.args)).toEqual([LIST, CREATE]);
    expect(logs.slice(1)).toEqual([
      '::warning::Issues skipped: the token lacks issues: write (HTTP 403).',
      'Pull request comment skipped: not a pull request event (none).',
    ]);
  });
});
