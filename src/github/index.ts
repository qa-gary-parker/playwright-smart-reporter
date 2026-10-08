import * as fs from 'fs';
import type { JsonExportData } from '../generators/json-exporter';
import { buildAnnotations, MAX_ANNOTATIONS } from './annotations';
import { renderSummary } from './summary';
import { resolveCommentTarget, runGh, upsertStickyComment, type GhRunner, type PullRequestEvent, type UpsertResult } from './pr-comment';

export interface GithubCommandOptions {
  dataPath: string;
  reportUrl?: string;
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

  const markdown = renderSummary(data, { reportUrl: opts.reportUrl || runUrl(env), workspace: env.GITHUB_WORKSPACE || deps.cwd });

  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  } else {
    log(markdown);
  }

  const annotations = buildAnnotations(data, env.GITHUB_WORKSPACE || deps.cwd);
  annotations.lines.forEach(log);
  if (annotations.omitted > 0) {
    log(`${annotations.omitted} more failure(s) not annotated: GitHub shows at most ${MAX_ANNOTATIONS} error annotations per step.`);
  }

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
