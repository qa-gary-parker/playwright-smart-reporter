import * as fs from 'fs';
import { createRedactor } from '../agent/redact';
import type { JsonExportData } from '../generators/json-exporter';
import { buildAnnotations, isFailure, MAX_ANNOTATIONS } from './annotations';
import { fileClusterIssues, MAX_ISSUES, type FiledIssue } from './issues';
import { renderClusterIssue, renderSummary } from './summary';
import { resolveCommentTarget, runGh, upsertStickyComment, type GhFailure, type GhRunner, type PullRequestEvent, type UpsertResult } from './pr-comment';

export interface GithubCommandOptions {
  dataPath: string;
  reportUrl?: string;
  issues?: boolean;
}

export interface GithubCommandDeps {
  env: NodeJS.ProcessEnv;
  cwd: string;
  gh: GhRunner;
  log: (line: string) => void;
}

function runUrl(env: NodeJS.ProcessEnv): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

function readEvent(eventPath: string | undefined): PullRequestEvent | undefined {
  if (!eventPath) return undefined;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  } catch {
    return undefined;
  }
}

// One issue per new cluster, largest first. Problems degrade to a warning, as for the PR comment.
function publishIssues(data: JsonExportData, opts: Parameters<typeof renderClusterIssue>[2], { env, gh, log }: GithubCommandDeps): void {
  const fresh = (data.failureClusters ?? []).filter((c) => c.tracking?.status === 'new').sort((a, b) => b.count - a.count);
  if (fresh.length === 0) return log('Issues skipped: no new failure clusters in this run.');
  if (!env.GITHUB_REPOSITORY) return log('Issues skipped: GITHUB_REPOSITORY is not set.');

  const issues = fresh.slice(0, MAX_ISSUES).map((c) => ({ clusterId: c.id, ...renderClusterIssue(data, c, opts) }));
  let result: { filed: FiledIssue[]; error?: GhFailure };
  try {
    result = fileClusterIssues(env.GITHUB_REPOSITORY, issues, gh);
  } catch (err) {
    result = { filed: [], error: { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) } };
  }
  for (const i of result.filed) {
    log(i.outcome === 'created'
      ? `Issue #${i.number} created for new failure cluster ${i.clusterId}.`
      : `Comment added to issue #${i.number} for new failure cluster ${i.clusterId}.`);
  }
  if (fresh.length > MAX_ISSUES) log(`${fresh.length - MAX_ISSUES} more new failure cluster(s) not filed: at most ${MAX_ISSUES} issues per run.`);
  if (result.error?.outcome === 'forbidden') log('::warning::Issues skipped: the token lacks issues: write (HTTP 403).');
  else if (result.error) log(`::warning::Issues failed: ${result.error.detail.split('\n')[0]}`);
}

/**
 * Publishes a smart-report-data.json to GitHub: job summary, failure annotations and one sticky PR comment.
 * Only an unreadable data file fails the command; comment problems degrade to a warning.
 */
export function runGithubCommand(opts: GithubCommandOptions, deps: GithubCommandDeps = {
  env: process.env,
  cwd: process.cwd(),
  gh: runGh,
  log: (line) => console.log(line),
}): number {
  const { env, log } = deps;
  let data: JsonExportData;
  try {
    data = JSON.parse(fs.readFileSync(opts.dataPath, 'utf-8'));
  } catch (err) {
    log(`::error::Cannot read Smart Reporter data at ${opts.dataPath}: ${err instanceof Error ? err.message : err}. Run the tests with exportJson: true.`);
    return 1;
  }
  if (!data || !Array.isArray(data.tests) || !data.summary) {
    log(`::error::${opts.dataPath} is not a Smart Reporter JSON export (it has no tests and summary). Pass the file written by exportJson: true.`);
    return 1;
  }

  // The report opens on Insights; a failed run's link goes straight to the failures instead.
  const reportUrl = opts.reportUrl && !opts.reportUrl.includes('#') && data.tests.some(isFailure) ? `${opts.reportUrl}#/q/failures` : opts.reportUrl;
  const summaryOptions = { reportUrl: reportUrl || runUrl(env), workspace: env.GITHUB_WORKSPACE || deps.cwd };
  const markdown = renderSummary(data, summaryOptions);

  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  } else {
    log(markdown);
  }

  // GitHub masks only registered secrets, so annotations get the same redaction as the failure bundle.
  const redact = createRedactor(env).string;
  const annotations = buildAnnotations(data, env.GITHUB_WORKSPACE || deps.cwd, redact);
  annotations.lines.forEach(log);
  if (annotations.omitted > 0) {
    log(`${annotations.omitted} more failure(s) not annotated: GitHub shows at most ${MAX_ANNOTATIONS} error annotations per step.`);
  }

  if (opts.issues) publishIssues(data, { ...summaryOptions, redact }, deps);

  const target = resolveCommentTarget(env.GITHUB_EVENT_NAME, readEvent(env.GITHUB_EVENT_PATH), env.GITHUB_REPOSITORY);
  if (!target.comment) {
    log(`Pull request comment skipped: ${target.reason}.`);
    return 0;
  }

  let result: UpsertResult;
  try {
    result = upsertStickyComment(target, markdown, deps.gh);
  } catch (err) {
    result = { outcome: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
  if (result.outcome === 'created' || result.outcome === 'updated') {
    log(`Pull request comment ${result.outcome} on ${target.repo}#${target.number}.`);
  } else if (result.outcome === 'forbidden') {
    log('::warning::Pull request comment skipped: the token lacks pull-requests: write (HTTP 403). The job summary and annotations were still published.');
  } else {
    log(`::warning::Pull request comment failed: ${result.detail.split('\n')[0]}`);
  }
  return 0;
}
