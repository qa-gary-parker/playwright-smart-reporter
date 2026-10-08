import { describe, it, expect } from 'vitest';
import { COMMENT_MARKER, resolveCommentTarget, upsertStickyComment, type GhResult, type GhRunner } from './pr-comment';

function pullRequest(number: number, head: string | null, base = 'acme/shop') {
  return { pull_request: { number, head: { repo: head === null ? null : { full_name: head } }, base: { repo: { full_name: base } } } };
}

describe('resolveCommentTarget', () => {
  it('comments on a same-repository pull request', () => {
    expect(resolveCommentTarget('pull_request', pullRequest(42, 'acme/shop'), 'acme/shop'))
      .toEqual({ comment: true, repo: 'acme/shop', number: 42 });
  });

  it('skips a pull_request run from a fork, whose token is read-only', () => {
    expect(resolveCommentTarget('pull_request', pullRequest(42, 'someone/shop'), 'acme/shop')).toEqual({
      comment: false,
      reason: 'pull request comes from a fork (someone/shop), so the token cannot write comments',
    });
  });

  it('treats a deleted head repository as a fork', () => {
    expect(resolveCommentTarget('pull_request', pullRequest(42, null), 'acme/shop')).toEqual({
      comment: false,
      reason: 'pull request comes from a fork (deleted repository), so the token cannot write comments',
    });
  });

  it('comments on a fork for pull_request_target, which runs with a write token', () => {
    expect(resolveCommentTarget('pull_request_target', pullRequest(7, 'someone/shop'), 'acme/shop'))
      .toEqual({ comment: true, repo: 'acme/shop', number: 7 });
  });

  it('skips push events', () => {
    expect(resolveCommentTarget('push', undefined, 'acme/shop')).toEqual({ comment: false, reason: 'not a pull request event (push)' });
  });

  it('skips when the payload has no pull request number', () => {
    expect(resolveCommentTarget('pull_request', undefined, 'acme/shop'))
      .toEqual({ comment: false, reason: 'pull request number or repository not found in the event payload' });
  });
});

describe('upsertStickyComment', () => {
  const ok = (stdout = ''): GhResult => ({ status: 0, stdout, stderr: '' });
  const target = { repo: 'acme/shop', number: 42 };

  function recordingGh(responses: GhResult[]) {
    const calls: { args: string[]; body?: unknown }[] = [];
    const gh: GhRunner = (args, stdin) => {
      calls.push({ args, body: stdin === undefined ? undefined : JSON.parse(stdin) });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected gh call: ${args.join(' ')}`);
      return next;
    };
    return { gh, calls };
  }

  const LIST = ['api', '--paginate', 'repos/acme/shop/issues/42/comments', '--jq', '.[] | {id, body}'];

  it('updates the comment that carries the marker instead of posting a second one', () => {
    const { gh, calls } = recordingGh([
      ok([
        JSON.stringify({ id: 11, body: 'LGTM' }),
        JSON.stringify({ id: 12, body: `${COMMENT_MARKER}\n## Playwright Smart Reporter\nold` }),
      ].join('\n')),
      ok(),
    ]);

    expect(upsertStickyComment(target, '## Playwright Smart Reporter\nnew\n', gh)).toEqual({ outcome: 'updated' });
    expect(calls).toEqual([
      { args: LIST, body: undefined },
      {
        args: ['api', '--method', 'PATCH', 'repos/acme/shop/issues/comments/12', '--input', '-'],
        body: { body: '<!-- playwright-smart-reporter -->\n## Playwright Smart Reporter\nnew\n' },
      },
    ]);
  });

  it('creates the comment when no existing comment has the marker', () => {
    const { gh, calls } = recordingGh([ok(`${JSON.stringify({ id: 11, body: 'LGTM' })}\n`), ok()]);

    expect(upsertStickyComment(target, 'report', gh)).toEqual({ outcome: 'created' });
    expect(calls).toEqual([
      { args: LIST, body: undefined },
      {
        args: ['api', '--method', 'POST', 'repos/acme/shop/issues/42/comments', '--input', '-'],
        body: { body: '<!-- playwright-smart-reporter -->\nreport' },
      },
    ]);
  });

  it('reports forbidden on a 403 and makes no further calls', () => {
    const { gh, calls } = recordingGh([
      ok(''),
      { status: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)\n' },
    ]);

    expect(upsertStickyComment(target, 'report', gh)).toEqual({
      outcome: 'forbidden',
      detail: 'gh: Resource not accessible by integration (HTTP 403)',
    });
    expect(calls.map((c) => c.args[2])).toEqual(['repos/acme/shop/issues/42/comments', 'POST']);
  });

  it('reports other gh failures without writing when listing fails', () => {
    const { gh, calls } = recordingGh([{ status: 4, stdout: '', stderr: 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.\n' }]);

    expect(upsertStickyComment(target, 'report', gh)).toEqual({
      outcome: 'failed',
      detail: 'gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable.',
    });
    expect(calls).toHaveLength(1);
  });
});
