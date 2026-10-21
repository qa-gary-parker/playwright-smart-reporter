#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const command = args[0];

function printUsage(): void {
  console.log(`
Usage: playwright-smart-reporter <command> [options]

Commands:
  gate      Evaluate quality gates against a JSON export
  digest    Generate a test health digest from history
  failures  Print the redacted failure bundle for coding agents
  mcp       Serve the failure bundle to coding agents over MCP (stdio)
  github    Publish a JSON export to GitHub (job summary, annotations, PR comment)

Run playwright-smart-reporter <command> --help for command-specific help.
`);
}

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

async function runGate(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(`
Usage: playwright-smart-reporter gate [options]

Evaluate quality gates against a JSON export file.

Options:
  --config <path>    Path to gates config JSON file (required)
  --data <path>      Path to smart-report-data.json (default: smart-report-data.json)
  --quarantine-file <path>  Quarantine file for noExpiredQuarantine (default: .smart-quarantine.json in the folder of --data)
  --help             Show this help
`);
    return;
  }

  const configPath = parseFlag('--config');
  const dataPath = parseFlag('--data') ?? 'smart-report-data.json';

  if (!configPath) {
    console.error('Error: --config is required. Provide a JSON file with quality gate rules.');
    console.error('Example: playwright-smart-reporter gate --config gates.json');
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(dataPath)) {
    console.error(`Error: Data file not found: ${dataPath}`);
    console.error('Run your tests with exportJson: true to generate this file.');
    process.exitCode = 1;
    return;
  }

  const { QualityGateEvaluator, formatGateReport, validateQualityGates } = await import('../gates');

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  if (!data || !Array.isArray(data.tests) || !data.summary) {
    console.error(`Error: ${dataPath} is not a Smart Reporter JSON export (it has no tests and summary). Pass the file written by exportJson: true.`);
    process.exitCode = 1;
    return;
  }
  try {
    validateQualityGates(config);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const { toTestResultData } = await import('../generators/json-exporter');
  const results = data.tests.map(toTestResultData);

  const { readQuarantineFile } = await import('../quarantine/quarantine-generator');
  let quarantine;
  try {
    quarantine = readQuarantineFile(parseFlag('--quarantine-file') ?? path.join(path.dirname(dataPath), '.smart-quarantine.json'));
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const evaluator = new QualityGateEvaluator();
  const result = evaluator.evaluate(config, results, data.comparison, data.coverage?.summary, data.failureClusters, quarantine);

  console.log(formatGateReport(result));

  if (!result.passed) {
    process.exitCode = 1;
  }
}

async function runDigest(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(`
Usage: playwright-smart-reporter digest [options]

Generate a test health digest from history.

Options:
  --period <period>    Analysis period: daily, weekly, monthly (default: weekly)
  --history <path>     Path to test-history.json (default: test-history.json)
  --output <path>      Write output to file instead of stdout
  --format <format>    Output format: markdown, text (default: markdown)
  --help               Show this help
`);
    return;
  }

  const period = (parseFlag('--period') ?? 'weekly') as 'daily' | 'weekly' | 'monthly';
  const historyPath = parseFlag('--history') ?? 'test-history.json';
  const output = parseFlag('--output');
  const format = (parseFlag('--format') ?? 'markdown') as 'markdown' | 'text';

  if (!['markdown', 'text'].includes(format)) {
    console.error(`Error: Invalid format "${format}". Use markdown or text.`);
    process.exitCode = 1;
    return;
  }

  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    console.error(`Error: Invalid period "${period}". Use daily, weekly, or monthly.`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(historyPath)) {
    console.error(`Error: History file not found: ${historyPath}`);
    console.error('Run your tests with historyFile configured to generate this file.');
    process.exitCode = 1;
    return;
  }

  const { HealthDigest } = await import('../digest');

  const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
  const digest = new HealthDigest();
  const data = digest.analyze(history, {
    period,
    historyFile: historyPath,
    format,
  });

  const content = format === 'text'
    ? digest.generateText(data)
    : digest.generateMarkdown(data);

  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, content);
    console.log(`Digest written to ${output}`);
  } else {
    console.log(content);
  }
}

const FAILURE_DATA_DEFAULTS = ['smart-report-failures.json', 'smart-report-data.json'];

const FAILURE_DATA_HELP = `  --data <path>    smart-report-failures.json (exportFailures), smart-report-data.json (exportJson),
                   or <name>-data.js (assetMode: 'external')
                   (default: first of ${FAILURE_DATA_DEFAULTS.join(', ')} found in the current directory)`;

function failureDataPath(): string | undefined {
  return parseFlag('--data') ?? FAILURE_DATA_DEFAULTS.find((f) => fs.existsSync(f));
}

async function loadFailures() {
  const dataPath = failureDataPath();
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`Error: Data file not found: ${dataPath ?? FAILURE_DATA_DEFAULTS.join(' or ')}`);
    console.error('Run your tests with exportFailures: true (or exportJson: true) to generate it.');
    process.exitCode = 1;
    return undefined;
  }
  const { loadFailureBundle } = await import('../agent/failure-bundle');
  return loadFailureBundle(dataPath, { rootDir: process.cwd() });
}

async function runGithub(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(`
Usage: playwright-smart-reporter github [options]

Publish a JSON export to GitHub Actions: append a job summary to $GITHUB_STEP_SUMMARY,
print error annotations at each failing assertion, and create or update one PR comment.
The PR comment needs \`pull-requests: write\`; fork PRs and 403s fall back to summary
and annotations only. Requires the gh CLI with GH_TOKEN set for the comment.

Options:
  --data <path>         Path to smart-report-data.json (default: smart-report-data.json)
  --report-url <url>    Link to the uploaded report (default: the workflow run page)
  --help                Show this help
`);
    return;
  }

  const { runGithubCommand } = await import('../github');
  process.exitCode = runGithubCommand({
    dataPath: parseFlag('--data') ?? 'smart-report-data.json',
    reportUrl: parseFlag('--report-url'),
  });
}

async function runFailures(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(`
Usage: playwright-smart-reporter failures [--json] [options]

Print the failed tests with error, call log, failing step, network and console
context, and history. Secrets are redacted.

Options:
  --json           Print the full failure bundle as JSON
${FAILURE_DATA_HELP}
  --help           Show this help
`);
    return;
  }

  const bundle = await loadFailures();
  if (!bundle) return;

  if (hasFlag('--json')) {
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }
  const { formatFailureText } = await import('../agent/failure-bundle');
  console.log(`${bundle.failures.length} failure(s) of ${bundle.run.total} test(s)`);
  for (const f of bundle.failures) console.log(`\n${formatFailureText(f)}`);
}

async function runMcp(): Promise<void> {
  if (hasFlag('--help')) {
    console.log(`
Usage: playwright-smart-reporter mcp [options]

Start an MCP server on stdio with the tools list_failures, get_failure, and
get_trace_context. Register it with Claude Code:

  claude mcp add smart-reporter -- npx playwright-smart-reporter mcp --data ./smart-report-failures.json

Options:
${FAILURE_DATA_HELP}
  --help           Show this help
`);
    return;
  }

  // Start even before the first test run; each tool call reads the file afresh.
  const dataPath = path.resolve(failureDataPath() ?? FAILURE_DATA_DEFAULTS[0]);
  const { loadFailureBundle } = await import('../agent/failure-bundle');
  const { startFailuresMcpServer } = await import('../agent/mcp-server');
  await startFailuresMcpServer(() => {
    if (!fs.existsSync(dataPath)) {
      throw new Error(`No failure data at ${dataPath}. Run your tests with exportFailures: true, then call the tool again.`);
    }
    return loadFailureBundle(dataPath, { rootDir: process.cwd() });
  });
}

async function main(): Promise<void> {
  switch (command) {
    case 'gate':
      await runGate();
      break;
    case 'digest':
      await runDigest();
      break;
    case 'github':
      await runGithub();
      break;
    case 'failures':
      await runFailures();
      break;
    case 'mcp':
      await runMcp();
      break;
    case '--help':
    case '-h':
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
