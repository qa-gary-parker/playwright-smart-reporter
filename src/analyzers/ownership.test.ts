import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestResultData } from '../types';
import { resolveOwnership, summarizeOwnership } from './ownership';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(root: string, rel: string, content = ''): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function git(cwd: string, args: string[], email = 'setup@example.com'): void {
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: email,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: email,
      GIT_COMMITTER_EMAIL: email,
    },
  });
}

function commit(repo: string, rel: string, email: string): void {
  write(repo, rel, `${email} ${Date.now()} ${Math.random()}`);
  git(repo, ['add', rel], email);
  git(repo, ['commit', '-q', '-m', `edit ${rel}`], email);
}

function owned(map: ReturnType<typeof resolveOwnership>, root: string): Record<string, string> {
  return Object.fromEntries(
    [...map].map(([file, info]) => [path.relative(root, file).split(path.sep).join('/'), `${info.source}:${info.owners.join(' ')}`]),
  );
}

const CODEOWNERS = `# Default owner for everything
*                           @org/qa

# Any spec file at any depth
*.spec.ts                   @org/spec-owners # inline comment

# Anchored directory and all of its subdirectories
/tests/checkout/            @org/payments

# Nested rule after its parent: last match wins
/tests/checkout/legacy/     @org/payments-legacy legacy@example.com

# Unanchored directory name, matched at any depth
api/                        @org/api

# Leading ** matches a directory name at any depth
**/visual                   @org/visual

# Single * segment matches direct children only
/tests/smoke/*              @org/smoke

# ** in the middle matches zero or more directories
/tests/**/admin/*.spec.ts   @org/admin

# Escaped space in a path
/tests/with\\ space/         @org/space

# Invalid syntax: GitHub skips the line
/tests/***/triple.spec.ts   @org/invalid

# A rule with no owners un-owns what it matches
/tests/checkout/legacy/unowned.spec.ts
/tests/experimental/
`;

const EXPECTED: Record<string, string> = {
  'tests/helpers.ts': 'codeowners:@org/qa',
  'tests/home.spec.ts': 'codeowners:@org/spec-owners',
  'tests/checkout/cart.spec.ts': 'codeowners:@org/payments',
  'tests/checkout/legacy/refund.spec.ts': 'codeowners:@org/payments-legacy legacy@example.com',
  'tests/api/users.spec.ts': 'codeowners:@org/api',
  'services/billing/api/invoices.spec.ts': 'codeowners:@org/api',
  'tests/ui/visual/snap.spec.ts': 'codeowners:@org/visual',
  'tests/smoke/login.spec.ts': 'codeowners:@org/smoke',
  'tests/smoke/nested/deep.spec.ts': 'codeowners:@org/spec-owners',
  'tests/admin/root.spec.ts': 'codeowners:@org/admin',
  'tests/users/eu/admin/roles.spec.ts': 'codeowners:@org/admin',
  'tests/with space/a.spec.ts': 'codeowners:@org/space',
  'tests/a/triple.spec.ts': 'codeowners:@org/spec-owners',
};

const UNOWNED = ['tests/checkout/legacy/unowned.spec.ts', 'tests/experimental/beta.spec.ts'];

describe('resolveOwnership with CODEOWNERS', () => {
  it('maps globs, anchors, directories, nested rules and un-owning rules with last match winning', () => {
    write(tmp, 'CODEOWNERS', CODEOWNERS);
    const files = [...Object.keys(EXPECTED), ...UNOWNED].map((rel) => write(tmp, rel));
    const outside = path.join(os.tmpdir(), 'not-under-root', 'x.spec.ts');

    const map = resolveOwnership([...files, outside], tmp);

    expect(owned(map, tmp)).toEqual(EXPECTED);
  });

  it('reads patterns relative to the git root, not the Playwright rootDir', () => {
    git(tmp, ['init', '-q']);
    write(tmp, '.github/CODEOWNERS', '/e2e/checkout/ @org/payments\n');
    const rootDir = path.join(tmp, 'e2e');
    const file = write(tmp, 'e2e/checkout/pay.spec.ts');

    expect(owned(resolveOwnership([file], rootDir), tmp)).toEqual({ 'e2e/checkout/pay.spec.ts': 'codeowners:@org/payments' });
  });

  it('uses the first file found in .github/, root, docs/ order', () => {
    write(tmp, 'docs/CODEOWNERS', '* @from-docs\n');
    write(tmp, 'CODEOWNERS', '* @from-root\n');
    write(tmp, '.github/CODEOWNERS', '* @from-github\n');
    const file = write(tmp, 'a.spec.ts');

    expect(owned(resolveOwnership([file], tmp), tmp)).toEqual({ 'a.spec.ts': 'codeowners:@from-github' });
  });

  it('uses codeownersPath when given, and throws when it does not exist', () => {
    write(tmp, 'CODEOWNERS', '* @default-location\n');
    write(tmp, 'config/OWNERS', '* @custom-location\n');
    const file = write(tmp, 'a.spec.ts');

    expect(owned(resolveOwnership([file], tmp, { codeownersPath: 'config/OWNERS' }), tmp)).toEqual({
      'a.spec.ts': 'codeowners:@custom-location',
    });
    expect(() => resolveOwnership([file], tmp, { codeownersPath: 'missing/OWNERS' })).toThrow(
      `CODEOWNERS not found at ${path.join(tmp, 'missing/OWNERS')}`,
    );
  });

  it('does no lookup at all when disabled', () => {
    write(tmp, 'CODEOWNERS', '* @org/qa\n');
    const file = write(tmp, 'a.spec.ts');

    expect(resolveOwnership([file], tmp, { enabled: false, codeownersPath: 'missing/OWNERS' }).size).toBe(0);
  });
});

describe('resolveOwnership git fallback', () => {
  function repoWithHistory(): Record<string, string> {
    git(tmp, ['init', '-q']);
    commit(tmp, 'tests/a.spec.ts', 'alice@example.com');
    commit(tmp, 'tests/a.spec.ts', 'Alice@Example.com');
    commit(tmp, 'tests/b.spec.ts', 'bob@example.com');
    commit(tmp, 'tests/a.spec.ts', 'bob@example.com');
    commit(tmp, 'tests/tie.spec.ts', 'alice@example.com');
    commit(tmp, 'tests/tie.spec.ts', 'carol@example.com');
    commit(tmp, 'tests/[id].spec.ts', 'dave@example.com');
    commit(tmp, 'tests/i.spec.ts', 'erin@example.com');
    const untracked = write(tmp, 'tests/untracked.spec.ts');
    return {
      a: path.join(tmp, 'tests/a.spec.ts'),
      b: path.join(tmp, 'tests/b.spec.ts'),
      tie: path.join(tmp, 'tests/tie.spec.ts'),
      literal: path.join(tmp, 'tests/[id].spec.ts'),
      untracked,
    };
  }

  it('picks the most frequent author per file, newest on ties, in one git invocation', () => {
    const f = repoWithHistory();
    vi.mocked(execFileSync).mockClear();

    const map = resolveOwnership([f.a, f.a, f.b, f.tie, f.literal, f.untracked], tmp, { enabled: true });

    expect(owned(map, tmp)).toEqual({
      'tests/a.spec.ts': 'git:alice@example.com',
      'tests/b.spec.ts': 'git:bob@example.com',
      'tests/tie.spec.ts': 'git:carol@example.com',
      'tests/[id].spec.ts': 'git:dave@example.com',
    });
    expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(1);
  });

  it('passes the common directory instead of each file when the file list is too long for one command line', () => {
    git(tmp, ['init', '-q']);
    const rels = Array.from({ length: 300 }, (_, i) => `e2e/suite/${String(i).padStart(4, '0')}-${'x'.repeat(70)}.spec.ts`);
    for (const rel of rels) write(tmp, rel, rel);
    git(tmp, ['add', '.'], 'alice@example.com');
    git(tmp, ['commit', '-q', '-m', 'add suite'], 'alice@example.com');
    commit(tmp, rels[7], 'bob@example.com');
    commit(tmp, rels[7], 'bob@example.com');
    commit(tmp, 'e2e/suite/helper.ts', 'bob@example.com');
    vi.mocked(execFileSync).mockClear();

    const map = resolveOwnership(rels.map((rel) => path.join(tmp, rel)), tmp, { source: 'git' });

    const expected = Object.fromEntries(rels.map((rel, i) => [rel, i === 7 ? 'git:bob@example.com' : 'git:alice@example.com']));
    expect(rels.join('').length).toBeGreaterThan(24_000);
    expect(owned(map, tmp)).toEqual(expected);
    expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(execFileSync).mock.calls[0][1]?.slice(-2)).toEqual(['--', 'e2e/suite']);
  });

  it('is off by default when there is no CODEOWNERS file', () => {
    const f = repoWithHistory();
    vi.mocked(execFileSync).mockClear();

    expect(resolveOwnership([f.a], tmp).size).toBe(0);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it("source 'git' ignores CODEOWNERS; source 'codeowners' never runs git", () => {
    const f = repoWithHistory();
    write(tmp, 'CODEOWNERS', '* @org/qa\n');

    expect(owned(resolveOwnership([f.b], tmp, { source: 'git' }), tmp)).toEqual({ 'tests/b.spec.ts': 'git:bob@example.com' });

    fs.rmSync(path.join(tmp, 'CODEOWNERS'));
    vi.mocked(execFileSync).mockClear();
    expect(resolveOwnership([f.b], tmp, { source: 'codeowners', enabled: true }).size).toBe(0);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });

  it('returns no owners outside a git repository without calling git', () => {
    const file = write(tmp, 'tests/a.spec.ts');
    vi.mocked(execFileSync).mockClear();

    expect(resolveOwnership([file], tmp, { source: 'git' }).size).toBe(0);
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });
});

describe('summarizeOwnership', () => {
  function t(owners: string[] | undefined, over: Partial<TestResultData>): TestResultData {
    return { testId: Math.random().toString(), title: 't', file: 'a.spec.ts', status: 'passed', duration: 1, retry: 0, steps: [], history: [], outcome: 'expected', owners, ...over };
  }

  it('counts each owner of a test and sorts worst-first', () => {
    const tests = [
      t(['@a'], {}),
      t(['@a'], { status: 'failed', outcome: 'unexpected' }),
      t(['@a', '@b'], { status: 'timedOut', outcome: 'unexpected' }),
      t(['@b'], { status: 'failed', expectedStatus: 'failed', outcome: 'flaky', retry: 1 }),
      t(['@b'], { status: 'skipped', outcome: 'skipped' }),
      t(['@c'], {}),
      t(['@c'], { status: 'failed', expectedStatus: 'failed', outcome: 'expected' }),
      t(['@d'], { flakinessScore: 0.5 }),
      t(undefined, { status: 'failed', outcome: 'unexpected' }),
    ];

    expect(summarizeOwnership(tests)).toEqual({
      owners: [
        { owner: '@a', total: 3, failed: 2, flaky: 0, passRate: 33 },
        { owner: '@b', total: 3, failed: 1, flaky: 1, passRate: 33 },
        { owner: '@d', total: 1, failed: 0, flaky: 1, passRate: 100 },
        { owner: '@c', total: 2, failed: 0, flaky: 0, passRate: 100 },
      ],
    });
  });

  it('is undefined when no test has an owner', () => {
    expect(summarizeOwnership([t(undefined, {})])).toBeUndefined();
  });
});
