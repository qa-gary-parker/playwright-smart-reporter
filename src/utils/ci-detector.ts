import * as fs from 'fs';
import type { CIInfo } from '../types';

/**
 * Auto-detect CI environment and capture metadata.
 * Shared between smart-reporter.ts and cloud/uploader.ts.
 * When CI tests a merge commit it made for a pull request and also names the pull request head,
 * `sha` is the head: the merge commit is in no branch history.
 */
export function detectCIInfo(): CIInfo | undefined {
  const env = process.env;

  if (env.GITHUB_ACTIONS) {
    const pr = githubPullRequest(env.GITHUB_EVENT_PATH);
    const sha = pr?.head?.sha || env.GITHUB_SHA;
    return {
      provider: 'github',
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GITHUB_REF?.replace('refs/heads/', ''),
      commit: sha?.slice(0, 8),
      buildId: env.GITHUB_RUN_ID,
      sha,
      repoUrl: env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}` : undefined,
      prNumber: pr?.number,
      targetBranch: env.GITHUB_BASE_REF || undefined,
    };
  }
  if (env.GITLAB_CI) {
    const sha = env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA;
    return {
      provider: 'gitlab',
      branch: env.CI_COMMIT_REF_NAME,
      commit: sha?.slice(0, 8) || env.CI_COMMIT_SHORT_SHA,
      buildId: env.CI_PIPELINE_ID,
      sha,
      repoUrl: env.CI_PROJECT_URL,
      prNumber: prNumber(env.CI_MERGE_REQUEST_IID),
      targetBranch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    };
  }
  if (env.CIRCLECI) {
    return {
      provider: 'circleci',
      branch: env.CIRCLE_BRANCH,
      commit: env.CIRCLE_SHA1?.slice(0, 8),
      buildId: env.CIRCLE_BUILD_NUM,
      sha: env.CIRCLE_SHA1,
      repoUrl: webUrl(env.CIRCLE_REPOSITORY_URL),
      prNumber: prNumber(env.CIRCLE_PULL_REQUEST?.split('/').pop()),
    };
  }
  if (env.JENKINS_URL) {
    return {
      provider: 'jenkins',
      branch: env.GIT_BRANCH || env.BRANCH_NAME,
      commit: env.GIT_COMMIT?.slice(0, 8),
      buildId: env.BUILD_NUMBER,
      sha: env.GIT_COMMIT,
      repoUrl: webUrl(env.GIT_URL),
      prNumber: prNumber(env.CHANGE_ID),
      targetBranch: env.CHANGE_TARGET,
    };
  }
  if (env.TF_BUILD) {
    const sha = env.SYSTEM_PULLREQUEST_SOURCECOMMITID || env.BUILD_SOURCEVERSION;
    return {
      provider: 'azure',
      branch: env.BUILD_SOURCEBRANCH?.replace('refs/heads/', ''),
      commit: sha?.slice(0, 8),
      buildId: env.BUILD_BUILDID,
      sha,
      repoUrl: webUrl(env.BUILD_REPOSITORY_URI),
      // GitHub pull requests have a number that differs from their id
      prNumber: prNumber(env.SYSTEM_PULLREQUEST_PULLREQUESTNUMBER || env.SYSTEM_PULLREQUEST_PULLREQUESTID),
      targetBranch: env.SYSTEM_PULLREQUEST_TARGETBRANCH?.replace('refs/heads/', ''),
    };
  }
  if (env.BUILDKITE) {
    return {
      provider: 'buildkite',
      branch: env.BUILDKITE_BRANCH,
      commit: env.BUILDKITE_COMMIT?.slice(0, 8),
      buildId: env.BUILDKITE_BUILD_NUMBER,
      sha: env.BUILDKITE_COMMIT,
      repoUrl: webUrl(env.BUILDKITE_REPO),
      prNumber: prNumber(env.BUILDKITE_PULL_REQUEST),
      targetBranch: env.BUILDKITE_PULL_REQUEST_BASE_BRANCH || undefined,
    };
  }
  if (env.CI) {
    return {
      provider: 'unknown',
      branch: env.CI_BRANCH || env.BRANCH,
      commit: env.CI_COMMIT || env.COMMIT,
      buildId: env.CI_BUILD_ID || env.BUILD_ID,
    };
  }
  return undefined;
}

function githubPullRequest(eventPath: string | undefined): { number?: number; head?: { sha?: string } } | undefined {
  if (!eventPath) return undefined;
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf-8')).pull_request;
  } catch {
    return undefined;
  }
}

function prNumber(value: string | undefined): number | undefined {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}

/** A clone URL as a link to the repository, without credentials: git@host:org/repo.git -> https://host/org/repo. */
function webUrl(cloneUrl: string | undefined): string | undefined {
  if (!cloneUrl) return undefined;
  const scp = /^[^@/:]+@([^/:]+):(.+)$/.exec(cloneUrl);
  try {
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : cloneUrl);
    const origin = url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : `https://${url.hostname}`;
    return origin + url.pathname.replace(/\.git$/, '');
  } catch {
    return undefined;
  }
}
