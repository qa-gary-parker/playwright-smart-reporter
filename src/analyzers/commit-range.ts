import { execFileSync } from 'child_process';
import type { CIInfo, CommitRange, CommitRef, RunSummary, TestHistory } from '../types';

// Hex only, so a commit read from history can never reach git as an option
const REV = /^[0-9a-f]{7,64}$/i;

function ref(ci: CIInfo | undefined): CommitRef | undefined {
  const commit = ci?.commit ?? ci?.sha?.slice(0, 8);
  return commit ? { commit, ...(ci?.sha && { sha: ci.sha }) } : undefined;
}

function rev(r: CommitRef | undefined): string | undefined {
  const c = r?.sha ?? r?.commit;
  return c && REV.test(c) ? c : undefined;
}

// The compare page of the range, or the page of the first failed commit, on GitHub and GitLab
function pageUrl({ provider, repoUrl }: CIInfo, from?: string, to?: string): string | undefined {
  if (!repoUrl || !to) return undefined;
  const host = /^https?:\/\/([^/]+)/i.exec(repoUrl)?.[1] ?? '';
  const base = provider === 'gitlab' || host.includes('gitlab') ? `${repoUrl}/-` : provider === 'github' || host.includes('github') ? repoUrl : undefined;
  return base && (from ? `${base}/compare/${from}...${to}` : `${base}/commit/${to}`);
}

/** The range from the run that last passed to the first failed run, or undefined when the first failed run has no commit. */
export function commitRange(lastPassed: Pick<RunSummary, 'ciInfo'> | undefined, firstFailed: Pick<RunSummary, 'ciInfo'>): CommitRange | undefined {
  const to = ref(firstFailed.ciInfo);
  if (!to) return undefined;
  const from = ref(lastPassed?.ciInfo);
  // Passed and failed at one commit: the compare page would be empty
  const url = pageUrl(firstFailed.ciInfo!, from?.commit === to.commit ? undefined : rev(from), rev(to));
  return { ...(from && { lastPassed: from }), firstFailed: to, ...(url && { url }) };
}

/** For a test failing now: from the newest run it passed in to the first of the runs it failed in since. Runs it skipped or did not run are passed over. */
export function failureCommits(testId: string, history: TestHistory, ciInfo: CIInfo | undefined): CommitRange | undefined {
  const entries = new Map((history.tests[testId] ?? []).map((e) => [e.runId, e]));
  let firstFailed: Pick<RunSummary, 'ciInfo'> = { ciInfo };
  let lastPassed: RunSummary | undefined;
  for (const run of [...(history.summaries ?? [])].reverse()) {
    const e = entries.get(run.runId);
    if (!e || e.skipped) continue;
    if (e.passed) {
      lastPassed = run;
      break;
    }
    firstFailed = run;
  }
  return commitRange(lastPassed, firstFailed);
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

function isShallow(cwd: string): boolean {
  try {
    return git(cwd, ['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Sets the files changed in each range of two commits, from git in the local clone: one call per distinct range.
 * A range git cannot compare (no git, or a shallow clone without the commits) keeps no suspects.
 */
export function addSuspects(ranges: Array<CommitRange | undefined>, cwd: string, redact: (text: string) => string = (t) => t): void {
  const diffs = new Map<string, string[] | undefined>();
  for (const r of ranges) {
    const from = rev(r?.lastPassed);
    const to = rev(r?.firstFailed);
    if (!r || !from || !to || from === to) continue;
    const range = `${from}..${to}`;
    if (!diffs.has(range)) {
      try {
        diffs.set(range, git(cwd, ['diff', '--name-only', '-z', range]).split('\0').filter(Boolean));
      } catch {
        diffs.set(range, undefined);
        const why = isShallow(cwd)
          ? 'this clone is shallow and may not have both commits. Fetch the full history, for example with fetch-depth: 0 on actions/checkout.'
          : 'git could not compare these commits here.';
        console.log(`Smart Reporter: no suspects for ${r.lastPassed!.commit}..${r.firstFailed.commit}: ${why}`);
      }
    }
    const files = diffs.get(range);
    if (files) r.suspects = files.map(redact);
  }
}
