import { spawnSync } from 'child_process';

export const COMMENT_MARKER = '<!-- playwright-smart-reporter -->';

export interface GhResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs `gh` with the given arguments and optional stdin. Injected so tests can record the requests. */
export type GhRunner = (args: string[], stdin?: string) => GhResult;

export const runGh: GhRunner = (args, stdin) => {
  const r = spawnSync('gh', args, { input: stdin, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: '', stderr: r.error.message };
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
};

export type CommentTarget =
  | { comment: true; repo: string; number: number }
  | { comment: false; reason: string };

export interface PullRequestEvent {
  pull_request?: {
    number?: number;
    head?: { repo?: { full_name?: string } | null };
    base?: { repo?: { full_name?: string } };
  };
}

/** Decides whether to comment, from GITHUB_EVENT_NAME, the parsed GITHUB_EVENT_PATH payload and GITHUB_REPOSITORY. */
export function resolveCommentTarget(eventName: string | undefined, event: PullRequestEvent | undefined, repository: string | undefined): CommentTarget {
  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    return { comment: false, reason: `not a pull request event (${eventName ?? 'none'})` };
  }
  const pr = event?.pull_request;
  const repo = pr?.base?.repo?.full_name ?? repository;
  if (!pr?.number || !repo) return { comment: false, reason: 'pull request number or repository not found in the event payload' };
  // pull_request runs from forks get a read-only token; pull_request_target runs get a write token.
  const head = pr.head?.repo?.full_name;
  if (eventName === 'pull_request' && head !== repo) {
    return { comment: false, reason: `pull request comes from a fork (${head ?? 'deleted repository'}), so the token cannot write comments` };
  }
  return { comment: true, repo, number: pr.number };
}

export type UpsertResult =
  | { outcome: 'created' }
  | { outcome: 'updated' }
  | { outcome: 'forbidden'; detail: string }
  | { outcome: 'failed'; detail: string };

function failure(r: GhResult): UpsertResult {
  const detail = (r.stderr || r.stdout).trim();
  return /HTTP 403/.test(detail) ? { outcome: 'forbidden', detail } : { outcome: 'failed', detail };
}

/** Updates the comment carrying COMMENT_MARKER, or creates it, so each pull request has one report comment. */
export function upsertStickyComment(target: { repo: string; number: number }, body: string, gh: GhRunner): UpsertResult {
  const list = gh(['api', '--paginate', `repos/${target.repo}/issues/${target.number}/comments`, '--jq', '.[] | {id, body}']);
  if (list.status !== 0) return failure(list);

  const existing = list.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as { id: number; body?: string })
    .find((c) => c.body?.includes(COMMENT_MARKER));

  const payload = JSON.stringify({ body: `${COMMENT_MARKER}\n${body}` });
  const write = existing
    ? gh(['api', '--method', 'PATCH', `repos/${target.repo}/issues/comments/${existing.id}`, '--input', '-'], payload)
    : gh(['api', '--method', 'POST', `repos/${target.repo}/issues/${target.number}/comments`, '--input', '-'], payload);
  if (write.status !== 0) return failure(write);
  return { outcome: existing ? 'updated' : 'created' };
}
