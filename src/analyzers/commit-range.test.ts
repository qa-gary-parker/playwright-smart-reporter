import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRedactor } from '../agent/redact';
import type { CIInfo, CommitRange, RunSummary, TestHistory, TestHistoryEntry } from '../types';
import { addSuspects, commitRange, failureCommits } from './commit-range';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const REPO = 'https://github.com/acme/shop';
const ci = (c: string): CIInfo => ({ provider: 'github', commit: c.repeat(8), sha: c.repeat(40), repoUrl: REPO });
const ref = (c: string) => ({ commit: c.repeat(8), sha: c.repeat(40) });

describe('failureCommits', () => {
  // What the test did in runs 1, 2, ...: 'pass', 'fail', 'skip' or null (not run). Run n is at commit 'abcdefghi'[n - 1].
  function historyOf(runs: Array<'pass' | 'fail' | 'skip' | null>): TestHistory {
    const summary = (n: number): RunSummary => ({
      runId: `run-${n}`, timestamp: `2026-10-0${n}T12:00:00.000Z`, total: 1, passed: 0, failed: 0, skipped: 0, flaky: 0, slow: 0, duration: 1, passRate: null,
      ciInfo: ci('abcdefghi'[n - 1]),
    });
    const entry = (n: number, v: string): TestHistoryEntry => ({ passed: v === 'pass', skipped: v === 'skip', duration: 1, timestamp: '', runId: `run-${n}` });
    return {
      runs: [],
      summaries: runs.map((_, i) => summary(i + 1)),
      tests: { t: runs.flatMap((v, i) => (v === null ? [] : [entry(i + 1, v)])) },
    };
  }

  it('gives a test that fails in run 3 the range from run 2 to run 3, with the compare page', () => {
    expect(failureCommits('t', historyOf(['pass', 'pass']), ci('c'))).toEqual({
      lastPassed: ref('b'),
      firstFailed: ref('c'),
      url: `${REPO}/compare/${'b'.repeat(40)}...${'c'.repeat(40)}`,
    });
  });

  it('starts the range at the first run it failed in since it last passed, passing over runs it skipped or did not run', () => {
    expect(failureCommits('t', historyOf(['pass', 'fail', 'skip', null, 'fail']), ci('f'))).toMatchObject({
      lastPassed: ref('a'),
      firstFailed: ref('b'),
    });
  });

  it('has only the first failed commit and its page when no run passed, and no range when that run has no commit', () => {
    expect(failureCommits('t', historyOf(['fail', 'fail']), ci('c'))).toEqual({
      firstFailed: ref('a'),
      url: `${REPO}/commit/${'a'.repeat(40)}`,
    });
    expect(failureCommits('t', historyOf([]), undefined)).toBeUndefined();
  });
});

describe('commitRange', () => {
  it('links to GitHub and GitLab, self-hosted ones included, and to nothing else', () => {
    const url = (info: Partial<CIInfo>) => commitRange({ ciInfo: { ...ci('a'), ...info } }, { ciInfo: { ...ci('b'), ...info } })?.url;
    const range = `${'a'.repeat(40)}...${'b'.repeat(40)}`;

    expect([
      url({}),
      url({ repoUrl: 'https://git.acme.dev/shop' }),
      url({ provider: 'gitlab', repoUrl: 'https://git.acme.dev/shop' }),
      url({ provider: 'jenkins', repoUrl: 'https://gitlab.com/acme/shop' }),
      url({ provider: 'jenkins', repoUrl: 'https://bitbucket.org/acme/github-tools' }),
      url({ repoUrl: undefined }),
    ]).toEqual([
      `${REPO}/compare/${range}`,
      `https://git.acme.dev/shop/compare/${range}`,
      `https://git.acme.dev/shop/-/compare/${range}`,
      `https://gitlab.com/acme/shop/-/compare/${range}`,
      undefined,
      undefined,
    ]);
  });

  it('shows a commit CI gave only in short form, and links no commit that is not hex', () => {
    const unknown = (commit: string): CIInfo => ({ provider: 'github', commit, repoUrl: REPO });

    expect(commitRange(undefined, { ciInfo: unknown('1234abcd') })).toEqual({ firstFailed: { commit: '1234abcd' }, url: `${REPO}/commit/1234abcd` });
    expect(commitRange(undefined, { ciInfo: unknown('release-7') })).toEqual({ firstFailed: { commit: 'release-7' } });
  });
});

describe('addSuspects', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'suspects-')));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  function git(cwd: string, args: string[]): string {
    // No background maintenance: a detached `git maintenance --auto` can still write into .git during cleanup.
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@example.com', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@example.com' },
    }).trim();
  }

  // A repository with one commit per entry, each writing the files named; returns the shas
  function repoWith(dir: string, commits: string[][]): string[] {
    fs.mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    return commits.map((files, i) => {
      for (const f of files) fs.writeFileSync(path.join(dir, f), `${i}`);
      git(dir, ['add', '.']);
      git(dir, ['commit', '-q', '-m', `commit ${i}`]);
      return git(dir, ['rev-parse', 'HEAD']);
    });
  }

  const range = (from: string | undefined, to: string): CommitRange => ({
    ...(from && { lastPassed: { commit: from.slice(0, 8), sha: from } }),
    firstFailed: { commit: to.slice(0, 8), sha: to },
  });

  it('lists the files changed between the last pass and the first failure, redacted, with one git call per range', () => {
    const repo = path.join(tmp, 'repo');
    const [first, , last] = repoWith(repo, [['a.ts'], ['b.ts', 'secret.ts'], ['c.ts']]);
    const ranges = [range(first, last), range(first, last), range(undefined, last)];
    vi.mocked(execFileSync).mockClear();

    addSuspects(ranges, repo, createRedactor({}, ['secret']).string);

    expect(ranges.map((r) => r.suspects)).toEqual([['b.ts', 'c.ts', '[REDACTED].ts'], ['b.ts', 'c.ts', '[REDACTED].ts'], undefined]);
    expect(vi.mocked(execFileSync).mock.calls.map((c) => c[1])).toEqual([['-C', repo, 'diff', '--name-only', '-z', `${first}..${last}`]]);
  });

  it('gives a shallow clone without the last passed commit no suspects, keeps the range, and says why', () => {
    const [first, last] = repoWith(path.join(tmp, 'repo'), [['a.ts'], ['b.ts']]);
    const clone = path.join(tmp, 'clone');
    git(tmp, ['clone', '-q', '--depth', '1', `file://${path.join(tmp, 'repo')}`, clone]);
    const ranges = [range(first, last)];

    expect(() => addSuspects(ranges, clone)).not.toThrow();

    expect(ranges).toEqual([range(first, last)]);
    expect(vi.mocked(console.log).mock.calls).toEqual([[
      `Smart Reporter: no suspects for ${first.slice(0, 8)}..${last.slice(0, 8)}: this clone is shallow and may not have both commits. Fetch the full history, for example with fetch-depth: 0 on actions/checkout.`,
    ]]);
  });

  it('gives no suspects outside a git repository, and passes git no saved commit that is not hex', () => {
    const outside = [range('a'.repeat(40), 'b'.repeat(40))];
    const injected = [range('--output=/tmp/x', 'b'.repeat(40))];
    vi.mocked(execFileSync).mockClear();

    addSuspects([...outside, ...injected], tmp);

    expect([...outside, ...injected].map((r) => r.suspects)).toEqual([undefined, undefined]);
    expect(vi.mocked(execFileSync).mock.calls.map((c) => c[1]?.[2])).toEqual(['diff', 'rev-parse']);
    expect(vi.mocked(console.log).mock.calls).toEqual([['Smart Reporter: no suspects for aaaaaaaa..bbbbbbbb: git could not compare these commits here.']]);
  });
});
