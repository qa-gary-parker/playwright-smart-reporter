---
mode: delegated
complexity: complex
type: feature
playwright: false
created: 2026-03-06T14:00:00
---

# Plan: Developer Workflow Integration & Cue Mascot

## Task Description

Add two major capabilities to playwright-smart-reporter:

1. **PR Comment CLI** — a `pr-comment` subcommand that reads report data and posts a detailed diagnostic comment to GitHub, GitLab, or Bitbucket PRs/MRs. Includes a thin GitHub Action wrapper for zero-config GitHub Actions usage.
2. **Static Upload Helper** — an `upload` subcommand that uploads the HTML report to S3, GCS, or Azure Blob Storage and returns a shareable URL.
3. **Cue Mascot Integration** — introduce "Cue" as the product mascot with visual + voice personality in PR comments and AI analysis framing.

## Objective

Ship PR comments and shareable report URLs as the two highest-impact developer workflow features missing from the product. Establish Cue as a named mascot with personality that appears in PR comments (avatar + voice) and AI analysis copy, differentiating StageWright from every other Playwright reporter.

## Problem Statement

Test reports currently die with CI artifacts. Developers must leave their PR workflow to view results. No other Playwright reporter posts stability grades, flakiness signals, or AI analysis directly into PRs. The StageWright brand has a distinctive red/green robot logo but no named character or personality in the product experience.

## Solution Approach

- **CLI-first architecture**: Both `pr-comment` and `upload` are subcommands of the existing `playwright-smart-reporter` CLI (`src/bin/cli.ts`). The GitHub Action is a thin wrapper that calls the CLI.
- **Provider abstraction**: A `VCSProvider` interface with implementations for GitHub, GitLab, and Bitbucket. Each provider knows how to post/update a comment on a PR/MR using the platform's REST API (no SDK dependencies — raw `fetch`).
- **Markdown generator**: A dedicated module that reads the same report data files (JSON export, history) and produces a rich markdown comment with stability grades, flakiness alerts, performance regressions, failure clusters, and AI summary.
- **Upload helper**: Provider abstraction for S3 (via `@aws-sdk/client-s3`), GCS (`@google-cloud/storage`), Azure Blob (`@azure/storage-blob`) — all as optional peer dependencies. Returns the public URL.
- **Cue mascot**: SVG illustrations for different states (happy, concerned, celebrating, thinking, warning). Embedded as base64 in PR comments. Cue's voice appears in comment copy and AI analysis framing throughout the reporter.

## Relevant Files

- `src/bin/cli.ts` — existing CLI entry point, will add `pr-comment` and `upload` commands
- `src/types.ts` — shared types, will add PR comment and upload config types
- `src/generators/json-exporter.ts` — JSON export format that PR comment reads
- `src/analyzers/` — flakiness, performance, stability analyzers whose data feeds the PR comment
- `src/notifiers/` — existing notification pattern (Slack, Teams) to follow for provider abstraction
- `package.json` — new bin entries, optional peer deps

### New Files

- `src/pr-comment/markdown-generator.ts` — generates the PR comment markdown from report data
- `src/pr-comment/markdown-generator.test.ts` — tests for markdown generation
- `src/pr-comment/providers/types.ts` — VCSProvider interface
- `src/pr-comment/providers/github.ts` — GitHub REST API provider
- `src/pr-comment/providers/gitlab.ts` — GitLab REST API provider
- `src/pr-comment/providers/bitbucket.ts` — Bitbucket REST API provider
- `src/pr-comment/providers/github.test.ts` — GitHub provider tests
- `src/pr-comment/providers/gitlab.test.ts` — GitLab provider tests
- `src/pr-comment/providers/bitbucket.test.ts` — Bitbucket provider tests
- `src/pr-comment/index.ts` — orchestrator: read data, generate markdown, post via provider
- `src/pr-comment/index.test.ts` — orchestrator tests
- `src/upload/index.ts` — upload orchestrator
- `src/upload/index.test.ts` — upload tests
- `src/upload/providers/types.ts` — UploadProvider interface
- `src/upload/providers/s3.ts` — S3 upload provider
- `src/upload/providers/gcs.ts` — GCS upload provider
- `src/upload/providers/azure.ts` — Azure Blob upload provider
- `src/upload/providers/s3.test.ts` — S3 provider tests
- `src/upload/providers/gcs.test.ts` — GCS provider tests
- `src/upload/providers/azure.test.ts` — Azure provider tests
- `src/mascot/cue.ts` — Cue voice copy helper (state-based messages, tone guidelines)
- `src/mascot/cue.test.ts` — Cue voice tests
- `src/mascot/svg/` — SVG illustrations for Cue states (happy, concerned, celebrating, thinking, warning)
- `github-action/action.yml` — GitHub Action definition
- `github-action/index.ts` — GitHub Action entry point

## Implementation Phases

### Phase 1: Foundation

Research Cue's voice and existing codebase patterns. Define the VCSProvider and UploadProvider interfaces. Establish Cue's SVG illustrations and voice copy guidelines.

### Phase 2: Core Implementation

Build the PR comment markdown generator with Cue's voice. Build the VCS providers (GitHub, GitLab, Bitbucket). Build the upload providers (S3, GCS, Azure). Wire both into the CLI. Build the GitHub Action wrapper.

### Phase 3: Integration & Polish

Integration tests across CLI commands and providers. Final code review and validation. Ensure all existing tests still pass.

## Team Members

- Cue Researcher
  - **Role**: Research Cue's voice guidelines, existing codebase patterns for CLI/notifiers, and provider API requirements
  - **Agent Type**: researcher

- PR Comment Builder
  - **Role**: Build the PR comment markdown generator, VCS providers, and CLI integration
  - **Agent Type**: builder

- Upload Builder
  - **Role**: Build the static upload helper with S3/GCS/Azure providers and CLI integration
  - **Agent Type**: builder

- Cue Builder
  - **Role**: Build Cue mascot SVGs, voice copy module, and integrate into PR comments and AI analysis
  - **Agent Type**: builder

- Action Builder
  - **Role**: Build the GitHub Action wrapper
  - **Agent Type**: builder

- Integration Tester
  - **Role**: Write integration tests spanning PR comment + upload + Cue voice across providers
  - **Agent Type**: tester

- Code Reviewer
  - **Role**: Review all code changes for correctness, security, style, and spec compliance
  - **Agent Type**: reviewer

- Final Validator
  - **Role**: Run all validation commands and verify acceptance criteria
  - **Agent Type**: validator

## Review Policy

- **Review After**: each task
- **Fix Loop Trigger**: Critical and Important
- **Max Retries**: 3
- **Skip Review For**: research-cue-patterns, validate-all

## Step by Step Tasks

### 1. Research Cue Voice & Codebase Patterns
- **Task ID**: research-cue-patterns
- **Depends On**: none
- **Description**:
  - Study the existing CLI pattern in `src/bin/cli.ts` — how commands are registered, how flags are parsed, how modules are lazy-imported
  - Study the notifier pattern in `src/notifiers/` — how Slack/Teams notifications are structured, formatted, and sent
  - Study `src/generators/json-exporter.ts` to understand the report data shape that PR comments will consume
  - Study `src/analyzers/` output shapes (flakiness scores, stability grades, performance regression data, failure clusters)
  - Define Cue's voice guidelines: tone is "helpful stage manager" — concise, useful, professional but warm. Never cute or clippy. Examples of good Cue copy for each state: success ("Cue says: all 142 tests passing, stability grade A"), warning ("Cue spotted 3 new flaky tests in this PR"), failure ("Cue found 12 failures — 8 are in a single cluster"), AI insight ("Cue's analysis: the login timeout failures share a common root cause...")
  - Document the VCS provider API requirements: GitHub (POST /repos/{owner}/{repo}/issues/{pr}/comments), GitLab (POST /projects/{id}/merge_requests/{mr}/notes), Bitbucket (POST /repositories/{workspace}/{repo}/pullrequests/{pr}/comments)
  - Document the upload provider API requirements for S3 PutObject, GCS upload, Azure Blob upload
- **Tests**: N/A
- **Assigned To**: Cue Researcher
- **Agent Type**: researcher
- **Background**: true

### 2. Build PR Comment Markdown Generator
- **Task ID**: build-pr-markdown
- **Depends On**: research-cue-patterns
- **Description**:
  - Create `src/pr-comment/markdown-generator.ts` that takes report data (from JSON export shape) and produces a GitHub-flavored markdown string
  - The markdown comment structure:
    - Header: Cue robot image (base64 SVG inline or hosted URL fallback) + "Cue's Test Report" title
    - Summary row: total tests, passed, failed, skipped, duration, pass rate delta vs previous run
    - Stability grades section: table of test files with grades A-F, highlighting any regressions
    - New flaky tests section: list of tests that became flaky in this PR (if any)
    - Performance regressions section: tests that got significantly slower (if any)
    - Failure clusters section: grouped similar failures with count and sample error
    - AI analysis section (Starter+): Cue's AI summary of failures, framed as "Cue's Analysis"
    - Footer: link to full report (if `--report-url` provided), "Powered by StageWright" with link
  - Each section should only appear if there is data for it (no empty sections)
  - Use collapsible `<details>` blocks for verbose sections (failure clusters, full stability table)
  - The generator should accept a config object for: `showStabilityGrades`, `showFlakiness`, `showPerformance`, `showAI`, `reportUrl`, `branding`
  - Create `src/pr-comment/providers/types.ts` with `VCSProvider` interface: `postComment(markdown: string): Promise<{ url: string }>` and `updateComment(commentId: string, markdown: string): Promise<void>` and `findExistingComment(marker: string): Promise<string | null>`
  - The "find existing comment" method searches for a hidden HTML marker (`<!-- stagewright-report -->`) to enable updating previous comments instead of posting duplicates
- **Tests**:
  - `src/pr-comment/markdown-generator.test.ts`:
    - Generates correct markdown for a full report with all sections
    - Omits sections when data is empty (no flaky tests = no flaky section)
    - Includes Cue voice copy in headers and section intros
    - Handles edge cases: zero tests, all passing, all failing
    - Respects config flags (showStabilityGrades: false hides grades)
    - Includes report URL link when provided
    - Includes hidden marker comment for update detection
    - Renders collapsible details blocks for long sections
- **Assigned To**: PR Comment Builder
- **Agent Type**: builder
- **Background**: false

### 3. Review PR Comment Markdown Generator
- **Task ID**: review-pr-markdown
- **Depends On**: build-pr-markdown
- **Description**: Review the markdown generator for correctness, edge cases, markdown rendering issues, and Cue voice consistency.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 4. Build VCS Providers
- **Task ID**: build-vcs-providers
- **Depends On**: review-pr-markdown
- **Description**:
  - Create `src/pr-comment/providers/github.ts` — GitHub provider using REST API (`fetch`):
    - `postComment`: POST to `/repos/{owner}/{repo}/issues/{pr_number}/comments`
    - `updateComment`: PATCH to `/repos/{owner}/{repo}/issues/comments/{comment_id}`
    - `findExistingComment`: GET `/repos/{owner}/{repo}/issues/{pr_number}/comments` and search for marker
    - Auth via `token` parameter (Bearer token header)
    - Auto-detect `owner`, `repo`, `pr_number` from environment variables (`GITHUB_REPOSITORY`, `GITHUB_REF`, `GITHUB_EVENT_PATH`) when running in GitHub Actions
  - Create `src/pr-comment/providers/gitlab.ts` — GitLab provider using REST API:
    - `postComment`: POST to `/api/v4/projects/{project_id}/merge_requests/{mr_iid}/notes`
    - `updateComment`: PUT to `/api/v4/projects/{project_id}/merge_requests/{mr_iid}/notes/{note_id}`
    - `findExistingComment`: GET notes and search for marker
    - Auth via `PRIVATE-TOKEN` header
    - Auto-detect from `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID` env vars
  - Create `src/pr-comment/providers/bitbucket.ts` — Bitbucket provider using REST API:
    - `postComment`: POST to `/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pr_id}/comments`
    - `updateComment`: PUT to same endpoint with `/{comment_id}`
    - `findExistingComment`: GET comments and search for marker
    - Auth via Bearer token or Basic auth
    - Auto-detect from `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`, `BITBUCKET_PR_ID` env vars
  - Create `src/pr-comment/index.ts` — orchestrator that:
    - Reads the JSON export file (default: `smart-report-data.json`)
    - Optionally reads history file for comparison data
    - Calls markdown generator
    - Detects provider from env vars or `--provider` flag
    - Finds existing comment and updates it, or posts new
    - Returns the comment URL
- **Tests**:
  - `src/pr-comment/providers/github.test.ts`:
    - Posts comment with correct URL and headers
    - Updates existing comment when marker found
    - Auto-detects repo/PR from GitHub Actions env vars
    - Handles API errors (401, 403, 404, rate limit)
  - `src/pr-comment/providers/gitlab.test.ts`:
    - Posts note with correct URL and headers
    - Updates existing note when marker found
    - Auto-detects project/MR from GitLab CI env vars
    - Handles API errors
  - `src/pr-comment/providers/bitbucket.test.ts`:
    - Posts comment with correct URL and headers
    - Updates existing comment when marker found
    - Auto-detects workspace/repo/PR from Bitbucket env vars
    - Handles API errors
  - `src/pr-comment/index.test.ts`:
    - Full orchestration: reads data file, generates markdown, posts via provider
    - Updates existing comment on second run
    - Falls back gracefully when data file missing
    - Auto-detects provider from env vars
- **Assigned To**: PR Comment Builder
- **Agent Type**: builder
- **Background**: false

### 5. Review VCS Providers
- **Task ID**: review-vcs-providers
- **Depends On**: build-vcs-providers
- **Description**: Review all three VCS providers and the orchestrator for correctness, security (token handling, no token logging), error handling, and API compliance.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 6. Build Upload Providers
- **Task ID**: build-upload-providers
- **Depends On**: research-cue-patterns
- **Description**:
  - Create `src/upload/providers/types.ts` with `UploadProvider` interface: `upload(filePath: string, remotePath: string): Promise<{ url: string }>`
  - Create `src/upload/providers/s3.ts`:
    - Uses `@aws-sdk/client-s3` as optional peer dependency
    - `upload`: PutObject with `ContentType: text/html`, returns the public URL
    - Config: `bucket`, `region`, `prefix`, `acl` (default: `public-read`), `endpoint` (for S3-compatible services like MinIO)
    - Auth via standard AWS credential chain (env vars, instance profile, etc.)
  - Create `src/upload/providers/gcs.ts`:
    - Uses `@google-cloud/storage` as optional peer dependency
    - `upload`: upload file to bucket with `contentType: text/html`, make public, return URL
    - Config: `bucket`, `prefix`, `projectId`
  - Create `src/upload/providers/azure.ts`:
    - Uses `@azure/storage-blob` as optional peer dependency
    - `upload`: upload block blob with `contentType: text/html`, return URL
    - Config: `connectionString` or `accountName` + `accountKey`, `container`, `prefix`
  - Create `src/upload/index.ts` — orchestrator:
    - Detects provider from `--provider` flag
    - Validates the cloud SDK is installed (helpful error message if not)
    - Uploads the HTML report file
    - Optionally uploads companion files (CSP-safe mode: .css, .js)
    - Returns the public URL
    - Prints URL to stdout for CI piping
  - All cloud SDKs are optional peer dependencies — the upload command checks for their presence at runtime and gives a clear install instruction if missing
- **Tests**:
  - `src/upload/providers/s3.test.ts`:
    - Uploads file with correct bucket, key, content type
    - Returns correct public URL
    - Supports custom prefix and endpoint
    - Handles missing SDK gracefully (clear error message)
    - Handles upload errors (access denied, bucket not found)
  - `src/upload/providers/gcs.test.ts`:
    - Uploads file with correct bucket and path
    - Returns correct public URL
    - Handles missing SDK gracefully
    - Handles upload errors
  - `src/upload/providers/azure.test.ts`:
    - Uploads blob with correct container and path
    - Returns correct public URL
    - Handles missing SDK gracefully
    - Handles upload errors
  - `src/upload/index.test.ts`:
    - Full orchestration: detects provider, uploads file, returns URL
    - Uploads companion CSS/JS files in CSP-safe mode
    - Fails gracefully when SDK not installed
- **Assigned To**: Upload Builder
- **Agent Type**: builder
- **Background**: true

### 7. Review Upload Providers
- **Task ID**: review-upload-providers
- **Depends On**: build-upload-providers
- **Description**: Review upload providers for correctness, security (credential handling), error handling, and optional dependency pattern.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 8. Build Cue Mascot Module
- **Task ID**: build-cue-mascot
- **Depends On**: research-cue-patterns
- **Description**:
  - Create `src/mascot/cue.ts` — the Cue voice and visual module:
    - Export `CueState` type: `'happy' | 'concerned' | 'celebrating' | 'thinking' | 'warning'`
    - Export `getCueMessage(state: CueState, context: CueContext): string` — returns Cue-voiced copy for different situations:
      - `happy`: all tests passing, good stability ("Cue says: all 142 tests passing, stability grade A")
      - `concerned`: new flaky tests or regressions ("Cue spotted 3 new flaky tests in this PR")
      - `celebrating`: improved pass rate or fixed tests ("Cue is pleased: 5 previously failing tests are now passing")
      - `thinking`: AI analysis available ("Cue's analysis: the login timeout failures share a common root cause...")
      - `warning`: quality gate failures or critical issues ("Cue flagged 2 quality gate violations")
    - `CueContext` includes: `testCount`, `passRate`, `failCount`, `flakyCount`, `newFlakyCount`, `regressionCount`, `fixedCount`, `aiSummary`, `gatesPassed`
    - Export `getCueSvg(state: CueState): string` — returns inline SVG string for the robot in the given state
    - The SVGs should be simple, recognizable variations of the red/green robot: green glow for happy/celebrating, amber for thinking, red for warning/concerned
    - Export `getCueAvatar(): string` — returns a small avatar SVG for PR comment headers
    - Export `getCueFooter(reportUrl?: string): string` — returns the PR comment footer with Cue branding
  - Update AI analysis framing: modify the AI analysis section wording in the existing reporter to use "Cue's Analysis" instead of generic headers (this is a targeted string change in `src/generators/html-generator.ts` where AI results are rendered)
- **Tests**:
  - `src/mascot/cue.test.ts`:
    - Returns appropriate message for each state
    - Message includes relevant context data (test counts, etc.)
    - SVG strings are valid (contain `<svg` tag, proper closing)
    - Different states produce different SVGs
    - Footer includes report URL when provided
    - Footer includes StageWright branding
    - Handles edge case contexts (zero tests, 100% pass rate, 0% pass rate)
- **Assigned To**: Cue Builder
- **Agent Type**: builder
- **Background**: true

### 9. Review Cue Mascot Module
- **Task ID**: review-cue-mascot
- **Depends On**: build-cue-mascot
- **Description**: Review Cue mascot module for voice consistency, SVG quality, and correct state handling.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 10. Wire CLI Commands
- **Task ID**: build-cli-commands
- **Depends On**: review-pr-markdown, review-vcs-providers, review-upload-providers, review-cue-mascot
- **Description**:
  - Update `src/bin/cli.ts` to add two new commands:
  - `pr-comment` command:
    - Flags: `--provider <github|gitlab|bitbucket>`, `--token <token>`, `--data <path>` (default: smart-report-data.json), `--history <path>`, `--report-url <url>`, `--pr <number>` (override auto-detect), `--repo <owner/repo>` (override auto-detect), `--update` (update existing comment, default true), `--help`
    - Auto-detects provider from CI env vars if `--provider` not specified
    - Reads data file, calls markdown generator with Cue voice, posts via provider
    - Prints comment URL to stdout on success
    - Exit code 0 on success, 1 on failure
  - `upload` command:
    - Flags: `--provider <s3|gcs|azure>`, `--bucket <name>`, `--container <name>` (Azure), `--prefix <path>`, `--region <region>`, `--report <path>` (default: smart-report/index.html), `--acl <acl>` (S3, default: public-read), `--endpoint <url>` (S3-compatible), `--help`
    - Uploads the report file (and companion files if CSP-safe)
    - Prints the public URL to stdout
    - Exit code 0 on success, 1 on failure
  - Update `printUsage()` to include both new commands
  - Update `package.json` if any new dependencies are needed
- **Tests**:
  - `src/bin/cli.test.ts` (new or extend existing):
    - `pr-comment` prints help with --help flag
    - `pr-comment` errors gracefully when data file missing
    - `pr-comment` errors when no provider detectable
    - `upload` prints help with --help flag
    - `upload` errors gracefully when report file missing
    - `upload` errors when provider SDK not installed
- **Assigned To**: PR Comment Builder
- **Agent Type**: builder
- **Background**: false

### 11. Review CLI Commands
- **Task ID**: review-cli-commands
- **Depends On**: build-cli-commands
- **Description**: Review CLI command wiring for correctness, consistent flag parsing, error messages, and help text quality.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 12. Build GitHub Action
- **Task ID**: build-github-action
- **Depends On**: review-cli-commands
- **Description**:
  - Create `github-action/action.yml`:
    - Name: "StageWright PR Comment"
    - Description: "Post test results as a PR comment with stability grades, flakiness detection, and AI analysis"
    - Inputs: `data-path` (default: smart-report-data.json), `history-path` (optional), `report-url` (optional), `github-token` (default: `${{ github.token }}`)
    - Runs: composite action that calls `npx playwright-smart-reporter pr-comment --provider github --token $INPUT_GITHUB_TOKEN --data $INPUT_DATA_PATH`
  - Create `github-action/README.md` with usage examples:
    - Basic usage (just add after test step)
    - With report URL (after upload step)
    - With custom data path
  - The action should be self-contained — no separate build step needed, uses the npm package directly via npx
- **Tests**: N/A (composite action, tested via integration tests)
- **Assigned To**: Action Builder
- **Agent Type**: builder
- **Background**: false

### 13. Review GitHub Action
- **Task ID**: review-github-action
- **Depends On**: build-github-action
- **Description**: Review the GitHub Action for correctness, security (token handling), and usability of the README examples.
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 14. Integration Tests
- **Task ID**: integration-tests
- **Depends On**: review-cli-commands, review-github-action
- **Description**:
  - Write integration tests that verify the full flow:
    - PR comment CLI reads a fixture data file, generates markdown with Cue voice, and would post to a mocked provider
    - Upload CLI reads a fixture HTML file and would upload to a mocked S3/GCS/Azure
    - PR comment + upload together: upload returns URL, pr-comment uses it as `--report-url`
    - Cue voice appears correctly in all generated markdown (search for "Cue" in output)
    - All three VCS providers produce valid API request shapes
    - Comment update flow: first post creates, second post updates (finds marker)
  - Use fixture data files that represent realistic report output
- **Assigned To**: Integration Tester
- **Agent Type**: tester
- **Background**: false

### 15. Final Code Review
- **Task ID**: review-all
- **Depends On**: build-pr-markdown, build-vcs-providers, build-upload-providers, build-cue-mascot, build-cli-commands, build-github-action, integration-tests
- **Description**: Review all code changes for correctness, style, edge cases, and security. Report issues by severity (Critical, Important, Minor).
- **Assigned To**: Code Reviewer
- **Agent Type**: reviewer
- **Background**: false

### 16. Final Validation
- **Task ID**: validate-all
- **Depends On**: review-all
- **Description**: Run all validation commands, verify every acceptance criterion is met.
- **Assigned To**: Final Validator
- **Agent Type**: validator
- **Background**: false

## Documentation Requirements

- `github-action/README.md` — usage examples for the GitHub Action
- Inline JSDoc on all exported functions in `src/pr-comment/`, `src/upload/`, and `src/mascot/`
- CLI `--help` text for both new commands must be clear and include examples
- Update the main CLI `printUsage()` to list both new commands

## Acceptance Criteria

- `playwright-smart-reporter pr-comment --provider github --token TEST --data fixture.json` generates valid markdown and posts via GitHub API
- `playwright-smart-reporter pr-comment --provider gitlab --token TEST --data fixture.json` posts via GitLab API
- `playwright-smart-reporter pr-comment --provider bitbucket --token TEST --data fixture.json` posts via Bitbucket API
- PR comment includes: pass/fail summary, stability grades, new flaky tests, performance regressions, failure clusters, AI analysis (when available)
- PR comment uses Cue's voice throughout ("Cue says...", "Cue spotted...", "Cue's Analysis")
- PR comment includes Cue robot avatar/image in the header
- PR comment includes hidden marker for update-on-rerun behavior
- `playwright-smart-reporter upload --provider s3 --bucket test --report index.html` uploads and returns URL
- `playwright-smart-reporter upload --provider gcs --bucket test --report index.html` uploads and returns URL
- `playwright-smart-reporter upload --provider azure --container test --report index.html` uploads and returns URL
- Upload providers give clear error when SDK not installed
- GitHub Action `action.yml` is valid and references the CLI correctly
- Cue SVGs render correctly in GitHub markdown (tested by visual inspection of markdown output)
- All existing tests still pass (`npm test`)
- All new tests pass
- TypeScript compiles without errors (`npm run build`)
- No secrets/tokens are logged in any code path

## Validation Commands

```bash
npm run build
npm test
npx tsc --noEmit
```

## Notes

- All cloud SDKs (S3, GCS, Azure) are optional peer dependencies — never add them as direct dependencies
- VCS API calls use native `fetch` (Node 18+) — no HTTP client library needed
- The GitHub Action is a composite action using `npx`, not a JavaScript action — keeps it simple and avoids a separate build
- Cue SVGs should be simple and small (< 2KB each) to inline in markdown without bloating PR comments
- PR comments should degrade gracefully on platforms that don't render HTML in markdown (SVGs fall back to text)
- The `--report-url` flag on `pr-comment` is optional — the comment is useful even without a link to the full report
- Branch requirement: all work must be done on a feature branch, not pushed to master/main
