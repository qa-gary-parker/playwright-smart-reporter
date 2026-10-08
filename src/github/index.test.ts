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
      .toBe(`earlier step\n${renderSummary(data, { reportUrl: 'https://example.test/report', workspace: WORKSPACE })}\n`);
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
