## Agent-ready output

Smart Reporter can hand failures straight to a coding agent such as Claude Code. You do not need to copy prompts by hand.

### Failure bundle

```ts
reporter: [['playwright-smart-reporter', { exportFailures: true }]]
```

`exportFailures` writes `<report name>-failures.json` (default `smart-report-failures.json`) next to the HTML report. The default is `false`.

The bundle has `format: "playwright-smart-reporter/failures"` and `schemaVersion: 1`. It holds one entry for each unexpected failure (`failed` or `timedOut`). Flaky passes and expected failures (`test.fail()`) are not in it. Each entry contains:

| Field | Content |
|---|---|
| `id`, `title`, `titlePath`, `file`, `line`, `column`, `project`, `browser`, `status`, `tags` | Test identity |
| `source` | Test file as `relative` and `absolute` paths |
| `error` | `message`, `stack` frames, and the failing `location` (relative and absolute) |
| `codeFrame` | Playwright's source snippet around the failing line |
| `callLog` | The `Call log:` lines from the error |
| `failingStep` | The innermost failed step, from the failure timeline |
| `attempts` | Status, duration and error message of every retry |
| `network` | Total request count and every failed request (status ≥ 400 or no response) |
| `console` | Console errors and warnings, from the failure timeline |
| `anomaly` | The suspected first anomaly, from the failure timeline |
| `history` | Pass, fail and skip counts, the last 10 results, signals, flakiness score, stability grade |
| `trace` | The full step, network and console lanes (served by `get_trace_context`) |

### Redaction

The bundle is made to be sent to a third-party model, so the reporter redacts it before it writes the file:

- Request and response bodies are never copied.
- Header values are replaced with `[REDACTED]` for `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key`, and any header whose name contains `cookie`, `token`, `secret`, `password`, `session`, `signature`, `credential`, or `api-key`, or has an `auth` segment (for example `X-Auth-User`).
- These patterns are replaced in every string: JWTs, `sk-` and `sk-ant-` keys, AWS access key IDs, GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), Slack tokens (`xoxb-`, `xoxp-`, ...), bearer tokens, private key blocks, `password=`/`secret=`/`token=`-style pairs, passwords in URLs (`scheme://user:password@`), and `key`/`sig`/`code`/`jwt` query parameters.
- The value of each environment variable whose name contains `token`, `secret`, `password`, `api_key`, `access_key`, `private_key`, `auth`, `session`, `cookie`, `credential`, `webhook`, `dsn`, or `signature` is replaced wherever it appears (values of 8 characters or more).
- The AI prompt, which carries an environment snapshot, is never copied.

Environment values are redacted from the environment of the process that builds the bundle. Use `exportFailures: true` so that the reporter builds the bundle in the test process.

### CLI

```bash
npx playwright-smart-reporter failures          # one line per failure
npx playwright-smart-reporter failures --json   # the full bundle, for piping into an agent
```

`--data <path>` selects the input. The default is the first of `smart-report-failures.json` and `smart-report-data.json` that is in the current directory. The command also accepts the `exportJson` output (`smart-report-data.json`) and the `<name>-data.js` file that `assetMode: 'external'` writes. For these inputs the command builds the bundle on the fly. Paths resolve against the current directory, so run the command from the Playwright root directory. The `exportJson` output has no steps, line numbers, network data, or history.

### MCP server

```bash
npx playwright-smart-reporter mcp --data ./smart-report-failures.json
```

This command starts an MCP server on stdio with three tools:

| Tool | Input | Returns |
|---|---|---|
| `list_failures` | none | Run info and one summary for each failure: id, title, `file:line`, project, status, first error line, anomaly |
| `get_failure` | `id` | The whole failure entry except the `trace` lanes |
| `get_trace_context` | `id` | `steps`, `network` and `console` for that failure |

The server reads the data file on every tool call. An agent that fixes a test and runs the suite again gets the new failures, and you can register the server before the first test run. Until the file exists, each tool returns an error that tells the agent to run the tests.

Register the server with Claude Code from the project root:

```bash
claude mcp add smart-reporter -- npx playwright-smart-reporter mcp --data ./smart-report-failures.json
```

Add `--scope project` to share the server through `.mcp.json`. Then ask Claude Code, for example, "Use smart-reporter to fix the failing login test".
