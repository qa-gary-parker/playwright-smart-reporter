## Ownership and routing

Smart Reporter tags each test with its owners. You can send each team a notification that contains only the failures it owns.

### How owners are found

1. **CODEOWNERS.** The reporter reads the first file that it finds at `.github/CODEOWNERS`, `CODEOWNERS` or `docs/CODEOWNERS`. It searches from the git repository root first, then from Playwright's `rootDir`. Matching uses GitHub's rules:
   - The last matching line wins.
   - A pattern with a leading or middle `/` is anchored to the repository root. A pattern without one matches at any depth.
   - `*` matches inside one path segment. `**` matches any number of directories.
   - `dir/` matches everything below `dir`. `dir/*` matches only the direct children of `dir`.
   - A line that has no owners removes ownership from the paths that it matches.
   - Negation (`!`) and character ranges (`[a-z]`) are not supported, the same as on GitHub.
2. **Git authors (fallback).** If there is no CODEOWNERS file, the owner is the email of the author who made the most commits to the test file. The reporter reads the 1,000 most recent non-merge commits that touch the test files. A tie goes to the most recent author. The reporter runs `git log` one time per run for all test files.

Outside a git repository, CODEOWNERS patterns match relative to Playwright's `rootDir`, and the git fallback gives no owners. Neither case fails the run.

### Options

```ts
['playwright-smart-reporter', {
  ownership: {
    enabled: true,           // default: true when a CODEOWNERS file exists, or when source is 'git'
    source: 'auto',          // 'auto' (CODEOWNERS, else git) | 'codeowners' | 'git'
    codeownersPath: '.github/CODEOWNERS', // optional; relative to Playwright's rootDir
  },
}]
```

If `codeownersPath` points to a file that does not exist, the reporter logs a warning and gives no owners.

### Route notifications by owner

Add `owners` to a notification. The notification is sent only when at least one failure belongs to one of those owners. Counts, conditions, `{{failedTests}}` and the default message include only the tests that those owners own. Owner names are not case-sensitive.

```ts
notifications: [
  { channel: 'slack', config: { webhookUrl: process.env.PAYMENTS_SLACK! }, owners: ['@acme/payments'] },
  { channel: 'slack', config: { webhookUrl: process.env.SEARCH_SLACK! }, owners: ['@acme/search', 'dev@acme.com'] },
]
```

Default message for an owner-routed notification:

```
Test Run: 1/2 passed (50%) — 1 failures owned by @acme/payments: checkout fails
```

A notification without `owners` works as before.

### Report data

- Each test has `owners?: string[]` and `ownerSource?: 'codeowners' | 'git'`.
- `ReportData.ownership.owners` lists `{ owner, total, failed, flaky, passRate }` for each owner. The list starts with the owner that has the most failures, then the most flaky tests, then sorts by name. A test with two owners counts for both owners. Tests without an owner are not in this list.

### Cost

On this repository (164 commits), resolution took less than 1 ms with a CODEOWNERS file and 25–35 ms with the git fallback for the 4 example specs. For 115 files it took 80–320 ms. When there is no CODEOWNERS file and ownership is not turned on, the reporter does not run git.
