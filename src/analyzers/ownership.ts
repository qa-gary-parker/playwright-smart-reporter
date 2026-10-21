import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ReportData } from '../report-data/schema';
import type { SmartReporterOptions, TestResultData } from '../types';
import { isFlakyTest } from '../utils/flakiness';
import { computeRunStats } from '../utils/run-stats';

export interface OwnerInfo {
  owners: string[];
  source: NonNullable<TestResultData['ownerSource']>;
}

interface CodeownersRule {
  owners: string[];
  regex: RegExp;
}

// GitHub's search order; the first file found wins.
const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
// Caps the history walked by the git fallback so large repos stay fast.
const MAX_GIT_COMMITS = 1000;
// Windows caps a command line at 32k chars; above this, pass the common directory instead of each file.
const MAX_PATHSPEC_CHARS = 24_000;

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// gitignore-style pattern -> regex, following GitHub's CODEOWNERS semantics
// (same rules as github.com/hmarr/codeowners): no negation, no [] classes.
export function compilePattern(pattern: string): RegExp {
  if (pattern === '/') return /^(?!)/;
  let segs = pattern.split('/');
  if (segs[0] === '') {
    segs = segs.slice(1);
  } else if ((segs.length === 1 || (segs.length === 2 && segs[1] === '')) && segs[0] !== '**') {
    segs = ['**', ...segs];
  }
  if (segs.length > 1 && segs[segs.length - 1] === '') segs[segs.length - 1] = '**';

  const last = segs.length - 1;
  let re = '^';
  let needSlash = false;
  segs.forEach((seg, i) => {
    if (seg === '**') {
      if (i === 0 && i === last) re += '.+';
      else if (i === 0) re += '(?:.+/)?';
      else if (i === last) re += '/.*';
      else {
        re += '(?:/.+)?';
        needSlash = true;
      }
      return;
    }
    if (needSlash) re += '/';
    needSlash = true;
    if (seg === '*') {
      re += '[^/]+';
      return;
    }
    let escaped = false;
    for (const ch of seg) {
      if (escaped) {
        re += escapeRegex(ch);
        escaped = false;
      } else if (ch === '\\') escaped = true;
      else if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += escapeRegex(ch);
    }
    if (i === last) re += '(?:/.*)?';
  });
  return new RegExp(`${re}$`);
}

function parseCodeowners(content: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const line of content.split(/\r?\n/)) {
    const tokens: string[] = [];
    let token = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '\\' && i + 1 < line.length) {
        token += ch + line[++i];
      } else if (ch === ' ' || ch === '\t') {
        if (token) tokens.push(token);
        token = '';
      } else if (ch === '#' && !token) {
        break;
      } else {
        token += ch;
      }
    }
    if (token) tokens.push(token);
    if (tokens.length === 0 || tokens[0].includes('***')) continue;
    rules.push({ regex: compilePattern(tokens[0]), owners: tokens.slice(1) });
  }
  return rules;
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function relativeTo(base: string, file: string): string | undefined {
  const rel = path.relative(base, realpath(file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join('/');
}

function findGitRoot(start: string): string | undefined {
  let dir = realpath(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// rootDir and its parents up to the project root: the first folder with package.json or .git.
function projectDirs(start: string): string[] {
  const dirs: string[] = [];
  let dir = realpath(start);
  for (;;) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir || ['package.json', '.git'].some((f) => fs.existsSync(path.join(dir, f)))) return dirs;
    dir = parent;
  }
}

function findCodeowners(bases: string[], explicit?: string): { file: string; base: string } | undefined {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`CODEOWNERS not found at ${explicit}`);
    return { file: explicit, base: bases[0] };
  }
  for (const base of bases) {
    for (const loc of CODEOWNERS_LOCATIONS) {
      const file = path.join(base, loc);
      if (fs.existsSync(file)) return { file, base };
    }
  }
  return undefined;
}

function commonDir(relFiles: string[]): string {
  let parts = path.posix.dirname(relFiles[0]).split('/');
  for (const f of relFiles) {
    const dir = path.posix.dirname(f).split('/');
    let i = 0;
    while (i < parts.length && parts[i] === dir[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join('/') || '.';
}

// One git invocation for all files: most frequent author email per file, newest wins ties.
function recentAuthors(gitRoot: string, relFiles: string[]): Map<string, string> {
  const wanted = new Set(relFiles);
  const pathspecs = relFiles.join('').length > MAX_PATHSPEC_CHARS ? [commonDir(relFiles)] : relFiles;
  const out = execFileSync(
    'git',
    ['-C', gitRoot, 'log', '--no-merges', `--max-count=${MAX_GIT_COMMITS}`, '-z', '--name-only', '--format=%x01%aE', '--', ...pathspecs],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
  );

  const counts = new Map<string, Map<string, number>>();
  for (const commit of out.split('\x01')) {
    const [email, ...names] = commit.split('\0');
    if (!email) continue;
    const author = email.toLowerCase();
    for (const raw of names) {
      const file = raw.replace(/^\n/, '');
      if (!wanted.has(file)) continue;
      const perFile = counts.get(file) ?? new Map<string, number>();
      perFile.set(author, (perFile.get(author) ?? 0) + 1);
      counts.set(file, perFile);
    }
  }

  const authors = new Map<string, string>();
  for (const [file, perFile] of counts) {
    let best = '';
    let bestCount = 0;
    for (const [author, n] of perFile) {
      if (n > bestCount) {
        best = author;
        bestCount = n;
      }
    }
    authors.set(file, best);
  }
  return authors;
}

/**
 * Resolve owners for test files (absolute paths). Call once per run: the result is the cache.
 * CODEOWNERS is searched from the git root, then rootDir and its parents up to the project root;
 * without one, 'auto' falls back to git authors.
 */
export function resolveOwnership(
  files: string[],
  rootDir: string,
  config: SmartReporterOptions['ownership'] = {},
): Map<string, OwnerInfo> {
  const result = new Map<string, OwnerInfo>();
  if (config.enabled === false || files.length === 0) return result;

  const source = config.source ?? 'auto';
  const gitRoot = findGitRoot(rootDir);
  const bases = [...new Set([gitRoot, ...projectDirs(rootDir)].filter((b): b is string => !!b))];
  const explicit = config.codeownersPath && path.resolve(rootDir, config.codeownersPath);
  const codeowners = source === 'git' ? undefined : findCodeowners(bases, explicit);
  if (!(config.enabled ?? (codeowners !== undefined || source === 'git'))) return result;

  const unique = [...new Set(files)];
  if (codeowners) {
    // Last matching rule wins, so search from the bottom
    const rules = parseCodeowners(fs.readFileSync(codeowners.file, 'utf8')).reverse();
    for (const file of unique) {
      const rel = relativeTo(codeowners.base, file);
      const rule = rel === undefined ? undefined : rules.find((r) => r.regex.test(rel));
      if (rule && rule.owners.length > 0) result.set(file, { owners: rule.owners, source: 'codeowners' });
    }
    return result;
  }
  if (source === 'codeowners' || !gitRoot) return result;

  const byRel = new Map<string, string>();
  for (const file of unique) {
    const rel = relativeTo(gitRoot, file);
    if (rel !== undefined) byRel.set(rel, file);
  }
  if (byRel.size === 0) return result;
  for (const [rel, author] of recentAuthors(gitRoot, [...byRel.keys()])) {
    result.set(byRel.get(rel)!, { owners: [author], source: 'git' });
  }
  return result;
}

/** Per-owner health, worst first. A test with several owners counts for each. */
export function summarizeOwnership(
  tests: Array<Pick<TestResultData, 'owners' | 'status' | 'outcome' | 'flakinessScore'>>,
): ReportData['ownership'] {
  const byOwner = new Map<string, typeof tests>();
  for (const t of tests) {
    for (const owner of t.owners ?? []) {
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner)!.push(t);
    }
  }
  if (byOwner.size === 0) return undefined;
  const owners = [...byOwner].map(([owner, owned]) => {
    const { total, failed, passRate } = computeRunStats(owned);
    // Flaky by history or on retry: the owner's tests that need a look, not this run's count.
    return { owner, total, failed, flaky: owned.filter(t => isFlakyTest(t)).length, passRate };
  });
  owners.sort((a, b) => b.failed - a.failed || b.flaky - a.flaky || (a.owner < b.owner ? -1 : a.owner > b.owner ? 1 : 0));
  return { owners };
}
