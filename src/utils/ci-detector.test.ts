import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectCIInfo } from './ci-detector';

const HEAD = 'feedc0de00112233445566778899aabbccddeeff';
const MERGE = '1111111111111111111111111111111111111111';

describe('detectCIInfo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear every CI variable, including those of the CI this suite runs on
    process.env = Object.fromEntries(Object.entries(originalEnv).filter(([key]) =>
      !/^(CI|GITHUB_|GITLAB_|JENKINS_|GIT_|BRANCH|CHANGE_|TF_BUILD|BUILD|SYSTEM_PULLREQUEST_|COMMIT)/.test(key)));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined when no CI environment is detected', () => {
    expect(detectCIInfo()).toBeUndefined();
  });

  describe('GitHub Actions', () => {
    it('detects GitHub Actions with GITHUB_HEAD_REF', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_HEAD_REF = 'feature/my-branch';
      process.env.GITHUB_SHA = 'abc12345deadbeef';
      process.env.GITHUB_RUN_ID = '12345';
      process.env.GITHUB_SERVER_URL = 'https://github.example.com';
      process.env.GITHUB_REPOSITORY = 'acme/shop';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'github',
        branch: 'feature/my-branch',
        commit: 'abc12345',
        buildId: '12345',
        sha: 'abc12345deadbeef',
        repoUrl: 'https://github.example.com/acme/shop',
      });
    });

    // On pull request events GITHUB_SHA is the merge commit GitHub makes for the run.
    it('records the pull request head from the event payload, its number and target branch', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-event-'));
      const eventPath = path.join(dir, 'event.json');
      fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { number: 42, head: { sha: HEAD } } }));
      Object.assign(process.env, {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: MERGE,
        GITHUB_REF: 'refs/pull/42/merge',
        GITHUB_HEAD_REF: 'feature/cart',
        GITHUB_BASE_REF: 'main',
        GITHUB_RUN_ID: '12345',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/shop',
      });

      try {
        expect(detectCIInfo()).toEqual({
          provider: 'github',
          branch: 'feature/cart',
          commit: 'feedc0de',
          buildId: '12345',
          sha: HEAD,
          repoUrl: 'https://github.com/acme/shop',
          prNumber: 42,
          targetBranch: 'main',
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('records GITHUB_SHA when the event payload cannot be read', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_EVENT_PATH = path.join(os.tmpdir(), 'no-such-event.json');
      process.env.GITHUB_SHA = MERGE;

      expect(detectCIInfo()?.sha).toBe(MERGE);
    });

    it('falls back to GITHUB_REF_NAME when GITHUB_HEAD_REF is empty', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_HEAD_REF = '';
      process.env.GITHUB_REF_NAME = 'main';
      process.env.GITHUB_SHA = 'deadbeef12345678';

      const info = detectCIInfo();

      expect(info?.branch).toBe('main');
    });

    it('falls back to GITHUB_REF with refs/heads/ prefix stripped', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_REF = 'refs/heads/develop';
      process.env.GITHUB_SHA = 'aabbccdd11223344';

      const info = detectCIInfo();

      expect(info?.branch).toBe('develop');
    });

    it('truncates commit SHA to 8 characters', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_SHA = 'abc123456789abcd';

      const info = detectCIInfo();

      expect(info?.commit).toBe('abc12345');
    });
  });

  describe('GitLab CI', () => {
    it('detects GitLab CI', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI_COMMIT_REF_NAME = 'feature/gitlab-branch';
      process.env.CI_COMMIT_SHORT_SHA = 'abcd1234';
      process.env.CI_PIPELINE_ID = '98765';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'gitlab',
        branch: 'feature/gitlab-branch',
        commit: 'abcd1234',
        buildId: '98765',
      });
    });

    it('falls back to CI_COMMIT_SHA when CI_COMMIT_SHORT_SHA is absent', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI_COMMIT_SHA = 'deadbeefcafebabe';

      const info = detectCIInfo();

      expect(info?.commit).toBe('deadbeef');
    });

    // In merged results pipelines CI_COMMIT_SHA is the merge result.
    it('records the merge request source head, IID and target branch', () => {
      Object.assign(process.env, {
        GITLAB_CI: 'true',
        CI_COMMIT_REF_NAME: 'feature/cart',
        CI_COMMIT_SHA: MERGE,
        CI_COMMIT_SHORT_SHA: '11111111',
        CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: HEAD,
        CI_MERGE_REQUEST_IID: '17',
        CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
        CI_PROJECT_URL: 'https://gitlab.com/acme/shop',
        CI_PIPELINE_ID: '98765',
      });

      expect(detectCIInfo()).toEqual({
        provider: 'gitlab',
        branch: 'feature/cart',
        commit: 'feedc0de',
        buildId: '98765',
        sha: HEAD,
        repoUrl: 'https://gitlab.com/acme/shop',
        prNumber: 17,
        targetBranch: 'main',
      });
    });
  });

  describe('CircleCI', () => {
    it('detects CircleCI', () => {
      process.env.CIRCLECI = 'true';
      process.env.CIRCLE_BRANCH = 'circle-branch';
      process.env.CIRCLE_SHA1 = '1234567890abcdef';
      process.env.CIRCLE_BUILD_NUM = '42';
      process.env.CIRCLE_REPOSITORY_URL = 'git@github.com:acme/shop.git';
      process.env.CIRCLE_PULL_REQUEST = 'https://github.com/acme/shop/pull/9';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'circleci',
        branch: 'circle-branch',
        commit: '12345678',
        buildId: '42',
        sha: '1234567890abcdef',
        repoUrl: 'https://github.com/acme/shop',
        prNumber: 9,
      });
    });
  });

  describe('Jenkins', () => {
    it('detects Jenkins with GIT_BRANCH', () => {
      process.env.JENKINS_URL = 'https://jenkins.example.com';
      process.env.GIT_BRANCH = 'origin/main';
      process.env.GIT_COMMIT = 'aabbccdd00112233';
      process.env.BUILD_NUMBER = '100';
      process.env.GIT_URL = 'https://ci-bot:s3cret@github.com/acme/shop.git';
      process.env.CHANGE_ID = '12';
      process.env.CHANGE_TARGET = 'main';

      const info = detectCIInfo();

      // The credentials in GIT_URL are not recorded.
      expect(info).toEqual({
        provider: 'jenkins',
        branch: 'origin/main',
        commit: 'aabbccdd',
        buildId: '100',
        sha: 'aabbccdd00112233',
        repoUrl: 'https://github.com/acme/shop',
        prNumber: 12,
        targetBranch: 'main',
      });
    });

    it('falls back to BRANCH_NAME when GIT_BRANCH is absent', () => {
      process.env.JENKINS_URL = 'https://jenkins.example.com';
      process.env.BRANCH_NAME = 'develop';

      const info = detectCIInfo();

      expect(info?.branch).toBe('develop');
    });
  });

  describe('Azure DevOps', () => {
    it('detects Azure DevOps and strips refs/heads/ prefix', () => {
      process.env.TF_BUILD = 'True';
      process.env.BUILD_SOURCEBRANCH = 'refs/heads/release/v1';
      process.env.BUILD_SOURCEVERSION = 'fedcba9876543210';
      process.env.BUILD_BUILDID = '555';
      process.env.BUILD_REPOSITORY_URI = 'https://acme@dev.azure.com/acme/shop/_git/shop';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'azure',
        branch: 'release/v1',
        commit: 'fedcba98',
        buildId: '555',
        sha: 'fedcba9876543210',
        repoUrl: 'https://dev.azure.com/acme/shop/_git/shop',
      });
    });

    // On pull request builds BUILD_SOURCEVERSION is the merge commit.
    it('records the pull request source commit, number and target branch', () => {
      Object.assign(process.env, {
        TF_BUILD: 'True',
        BUILD_SOURCEVERSION: MERGE,
        BUILD_BUILDID: '556',
        BUILD_REPOSITORY_URI: 'https://github.com/acme/shop',
        SYSTEM_PULLREQUEST_SOURCECOMMITID: HEAD,
        SYSTEM_PULLREQUEST_PULLREQUESTID: '901',
        SYSTEM_PULLREQUEST_PULLREQUESTNUMBER: '7',
        SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main',
      });

      expect(detectCIInfo()).toEqual({
        provider: 'azure',
        commit: 'feedc0de',
        buildId: '556',
        sha: HEAD,
        repoUrl: 'https://github.com/acme/shop',
        prNumber: 7,
        targetBranch: 'main',
      });
    });
  });

  describe('Buildkite', () => {
    it('detects Buildkite', () => {
      process.env.BUILDKITE = 'true';
      process.env.BUILDKITE_BRANCH = 'bk-branch';
      process.env.BUILDKITE_COMMIT = 'aabb112233445566';
      process.env.BUILDKITE_BUILD_NUMBER = '77';
      process.env.BUILDKITE_REPO = 'git@github.com:acme/shop.git';
      process.env.BUILDKITE_PULL_REQUEST = '31';
      process.env.BUILDKITE_PULL_REQUEST_BASE_BRANCH = 'main';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'buildkite',
        branch: 'bk-branch',
        commit: 'aabb1122',
        buildId: '77',
        sha: 'aabb112233445566',
        repoUrl: 'https://github.com/acme/shop',
        prNumber: 31,
        targetBranch: 'main',
      });
    });

    // Outside a pull request Buildkite sets BUILDKITE_PULL_REQUEST to "false" and the base branch to "".
    it('records no pull request outside one', () => {
      process.env.BUILDKITE = 'true';
      process.env.BUILDKITE_COMMIT = 'aabb112233445566';
      process.env.BUILDKITE_PULL_REQUEST = 'false';
      process.env.BUILDKITE_PULL_REQUEST_BASE_BRANCH = '';

      expect(detectCIInfo()).toEqual({ provider: 'buildkite', commit: 'aabb1122', sha: 'aabb112233445566' });
    });
  });

  describe('Generic CI', () => {
    it('detects generic CI with CI env var', () => {
      process.env.CI = 'true';
      process.env.CI_BRANCH = 'generic-branch';
      process.env.CI_COMMIT = 'generic-commit';
      process.env.CI_BUILD_ID = 'gen-123';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'unknown',
        branch: 'generic-branch',
        commit: 'generic-commit',
        buildId: 'gen-123',
      });
    });

    it('falls back to BRANCH and COMMIT env vars', () => {
      process.env.CI = 'true';
      process.env.BRANCH = 'alt-branch';
      process.env.COMMIT = 'alt-commit';
      process.env.BUILD_ID = 'alt-123';

      const info = detectCIInfo();

      expect(info).toEqual({
        provider: 'unknown',
        branch: 'alt-branch',
        commit: 'alt-commit',
        buildId: 'alt-123',
      });
    });
  });

  describe('provider priority', () => {
    it('GitHub Actions takes priority over generic CI', () => {
      process.env.GITHUB_ACTIONS = 'true';
      process.env.CI = 'true';
      process.env.GITHUB_REF_NAME = 'gh-branch';

      const info = detectCIInfo();

      expect(info?.provider).toBe('github');
    });

    it('GitLab takes priority over generic CI', () => {
      process.env.GITLAB_CI = 'true';
      process.env.CI = 'true';
      process.env.CI_COMMIT_REF_NAME = 'gl-branch';

      const info = detectCIInfo();

      expect(info?.provider).toBe('gitlab');
    });
  });
});
