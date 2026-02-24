import type { CIInfo } from '../types';

/**
 * Auto-detect CI environment and capture metadata.
 * Shared between smart-reporter.ts and cloud/uploader.ts.
 */
export function detectCIInfo(): CIInfo | undefined {
  const env = process.env;

  if (env.GITHUB_ACTIONS) {
    return {
      provider: 'github',
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.GITHUB_REF?.replace('refs/heads/', ''),
      commit: env.GITHUB_SHA?.slice(0, 8),
      buildId: env.GITHUB_RUN_ID,
    };
  }
  if (env.GITLAB_CI) {
    return {
      provider: 'gitlab',
      branch: env.CI_COMMIT_REF_NAME,
      commit: env.CI_COMMIT_SHORT_SHA || env.CI_COMMIT_SHA?.slice(0, 8),
      buildId: env.CI_PIPELINE_ID,
    };
  }
  if (env.CIRCLECI) {
    return {
      provider: 'circleci',
      branch: env.CIRCLE_BRANCH,
      commit: env.CIRCLE_SHA1?.slice(0, 8),
      buildId: env.CIRCLE_BUILD_NUM,
    };
  }
  if (env.JENKINS_URL) {
    return {
      provider: 'jenkins',
      branch: env.GIT_BRANCH || env.BRANCH_NAME,
      commit: env.GIT_COMMIT?.slice(0, 8),
      buildId: env.BUILD_NUMBER,
    };
  }
  if (env.TF_BUILD) {
    return {
      provider: 'azure',
      branch: env.BUILD_SOURCEBRANCH?.replace('refs/heads/', ''),
      commit: env.BUILD_SOURCEVERSION?.slice(0, 8),
      buildId: env.BUILD_BUILDID,
    };
  }
  if (env.BUILDKITE) {
    return {
      provider: 'buildkite',
      branch: env.BUILDKITE_BRANCH,
      commit: env.BUILDKITE_COMMIT?.slice(0, 8),
      buildId: env.BUILDKITE_BUILD_NUMBER,
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
