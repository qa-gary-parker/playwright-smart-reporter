# Phase 5 — CI surface integrations (README-ready)

The sections below are written to drop into README.md. "JSON, JUnit & CTRF Export" replaces the current "JSON & JUnit Export" section. "GitHub Pull Requests" and "Azure DevOps" go under "CI Integration".

---

### JSON, JUnit & CTRF Export

Export test results in structured formats for external tools:

```typescript
reporter: [
  ['playwright-smart-reporter', {
    outputFile: 'smart-report.html',
    exportJson: true,   // smart-report-data.json
    exportJunit: true,  // smart-report-junit.xml
    exportCtrf: true,   // smart-report-ctrf.json
  }],
]
```

`exportCtrf` writes a [Common Test Report Format](https://github.com/ctrf-io/ctrf) document (`specVersion` 0.1.0) next to the HTML report, so any CTRF tool can read your results.

| Playwright result | CTRF `status` | Notes |
|---|---|---|
| passed | `passed` | |
| passed after a retry (flaky) | `passed` | `flaky: true` |
| failed, timedOut | `failed` | `rawStatus` keeps `timedOut` |
| failed as expected (`test.fail()`) | `passed` | `rawStatus: "failed"` |
| interrupted | `other` | |
| skipped | `skipped` | |

- `retries` is the number of earlier attempts. Each earlier attempt is in `retryAttempts` with its status, duration and error.
- `filePath` is relative to the Playwright `rootDir`, the same as in the JSON and JUnit exports.
- The Playwright project name is in `extra.project`.

### GitHub Pull Requests

Show the run where reviewers already look:

- **Job summary:** pass rate, quality gate result, failures (new failures first), flaky tests, slowest tests and a link to the report.
- **Annotations:** an error on the line of each failing assertion, not on the test declaration.
- **Pull request comment:** the same summary as one comment. Each run updates that comment, so re-runs do not add more comments.

Turn on the JSON export, then add the action after your tests:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write   # for the pull request comment
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx playwright install --with-deps

      - run: npx playwright test
        continue-on-error: true

      - id: upload-report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: smart-report
          path: smart-report.html

      - uses: qa-gary-parker/playwright-smart-reporter@v3.0.0
        if: always()
        with:
          data: smart-report-data.json
          report-url: ${{ steps.upload-report.outputs.artifact-url }}
```

| Input | Default | Description |
|---|---|---|
| `data` | `smart-report-data.json` | Path to the JSON export |
| `report-url` | workflow run page | Link to the uploaded report |
| `github-token` | `github.token` | Token for the pull request comment |

- The comment is written only for `pull_request` and `pull_request_target` events. Other events get the summary and annotations.
- `pull_request` runs from forks get a read-only token. The action skips the comment and still writes the summary and annotations. A 403 response does the same and shows a warning. The step does not fail.
- GitHub shows at most 10 error annotations per step. The action writes the first 10 failures and logs how many it left out.
- The action uses the reporter version installed in your project. If it is not installed, `npx` downloads the latest version.

You can also run the command without the action, for example in a custom workflow step:

```bash
npx playwright-smart-reporter github --data smart-report-data.json --report-url "$REPORT_URL"
```

It needs the `gh` CLI and `GH_TOKEN` for the comment. Outside GitHub Actions it prints the summary to stdout.

### Azure DevOps

Azure DevOps has no pull request comment or annotation support in Smart Reporter. Use these pipeline features instead:

```yaml
steps:
  - script: npx playwright test
    continueOnError: true

  # HTML report as a pipeline artifact
  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: smart-report.html
      artifact: playwright-smart-report
    condition: always()

  # Native "Tests" tab, from exportJunit: true
  - task: PublishTestResults@2
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: '**/smart-report-junit.xml'
    condition: always()

  # Markdown summary on the run's "Extensions" tab, from exportJson: true
  - script: |
      GITHUB_STEP_SUMMARY="$(Build.ArtifactStagingDirectory)/smart-summary.md" npx playwright-smart-reporter github --data smart-report-data.json
      echo "##vso[task.uploadsummary]$(Build.ArtifactStagingDirectory)/smart-summary.md"
    condition: always()
```

- The `github` command writes its markdown to the file named in `GITHUB_STEP_SUMMARY`. It also prints `::error` lines, which Azure DevOps shows as plain log text.
- Branch, commit and build ID are detected from the Azure DevOps environment and shown in the report header.
