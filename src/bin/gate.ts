#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, QualityGateConfig, StabilityScore, RunComparison, A11yResult } from '../types';
import { QualityGateEvaluator } from '../gates/quality-gate-evaluator';
import { formatGateReport } from '../gates/quality-gate-reporter';
import type { CoverageSummary } from '../report-data/schema';

interface GateOptions {
  inputPath: string;
  configPath?: string;
  maxFailures?: number;
  minPassRate?: number;
  maxFlakyRate?: number;
  minStabilityGrade?: 'A' | 'B' | 'C' | 'D';
  noNewFailures?: boolean;
  maxA11yViolations?: number;
  minCoverage?: number;
}

function printUsage(): void {
  console.log(`
Usage: playwright-smart-reporter gate [options]

Evaluate quality gates against smart-report-data.json.

Options:
  --input <path>              Path to smart-report-data.json (default: ./smart-report-data.json)
  --config <path>             Path to quality gates JSON config file
  --max-failures <n>          Maximum allowed failures
  --min-pass-rate <n>         Minimum pass rate percentage
  --max-flaky-rate <n>        Maximum flaky rate percentage
  --min-stability-grade <g>   Minimum stability grade (A, B, C, D)
  --no-new-failures           Fail if new failures detected (requires comparison data)
  --max-a11y-violations <n>   Maximum accessibility violations (skipped when no test was scanned)
  --min-coverage <n>          Minimum line coverage percentage (fails when no coverage was collected)
  -h, --help                  Show this help message

Examples:
  node node_modules/playwright-smart-reporter/dist/bin/gate.js --config gates.json
  node node_modules/playwright-smart-reporter/dist/bin/gate.js --max-failures 5 --min-pass-rate 90
  node node_modules/playwright-smart-reporter/dist/bin/gate.js --input ./report/smart-report-data.json --max-flaky-rate 5

(npx playwright-smart-reporter gate takes the rules from a --config file only.)
`);
}

function parseArgs(argv: string[]): GateOptions {
  const args = argv.slice(2);

  // Strip leading "gate" subcommand if present
  if (args[0] === 'gate') {
    args.shift();
  }

  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const options: GateOptions = {
    inputPath: path.resolve(process.cwd(), 'smart-report-data.json'),
  };

  const fail = (message: string): never => {
    console.error(`Error: ${message}`);
    process.exit(1);
  };
  const value = (flag: string, i: number): string => args[i] ?? fail(`${flag} needs a value.`);
  const number = (flag: string, i: number): number => {
    const raw = value(flag, i);
    const n = Number(raw);
    return raw.trim() !== '' && Number.isFinite(n) ? n : fail(`${flag} needs a number (got "${raw}").`);
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--input':
        options.inputPath = path.resolve(process.cwd(), value(arg, ++i));
        break;
      case '--config':
        options.configPath = path.resolve(process.cwd(), value(arg, ++i));
        break;
      case '--max-failures':
        options.maxFailures = number(arg, ++i);
        break;
      case '--min-pass-rate':
        options.minPassRate = number(arg, ++i);
        break;
      case '--max-flaky-rate':
        options.maxFlakyRate = number(arg, ++i);
        break;
      case '--min-stability-grade': {
        const grade = value(arg, ++i);
        if (!['A', 'B', 'C', 'D'].includes(grade)) fail(`${arg} must be A, B, C or D (got "${grade}").`);
        options.minStabilityGrade = grade as 'A' | 'B' | 'C' | 'D';
        break;
      }
      case '--no-new-failures':
        options.noNewFailures = true;
        break;
      case '--max-a11y-violations':
        options.maxA11yViolations = number(arg, ++i);
        break;
      case '--min-coverage':
        options.minCoverage = number(arg, ++i);
        break;
    }
  }

  return options;
}

function buildConfig(options: GateOptions): QualityGateConfig {
  // If a config file is specified, load it as the base
  let config: QualityGateConfig = {};

  if (options.configPath) {
    if (!fs.existsSync(options.configPath)) {
      console.error(`Error: Config file not found: ${options.configPath}`);
      process.exit(1);
    }
    try {
      config = JSON.parse(fs.readFileSync(options.configPath, 'utf-8'));
    } catch (err) {
      console.error(`Error: Failed to parse config file: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  // CLI flags override config file values
  if (options.maxFailures !== undefined) config.maxFailures = options.maxFailures;
  if (options.minPassRate !== undefined) config.minPassRate = options.minPassRate;
  if (options.maxFlakyRate !== undefined) config.maxFlakyRate = options.maxFlakyRate;
  if (options.minStabilityGrade !== undefined) config.minStabilityGrade = options.minStabilityGrade;
  if (options.noNewFailures !== undefined) config.noNewFailures = options.noNewFailures;
  if (options.maxA11yViolations !== undefined) config.maxA11yViolations = options.maxA11yViolations;
  if (options.minCoverage !== undefined) config.minCoverage = options.minCoverage;

  return config;
}

interface JsonTestEntry {
  testId: string;
  title: string;
  file: string;
  status: string;
  duration: number;
  error?: string;
  retry: number;
  outcome?: string;
  flakinessScore?: number;
  stabilityScore?: {
    overall: number;
    grade: string;
  };
  a11y?: A11yResult;
}

function toTestResultData(entry: JsonTestEntry): TestResultData {
  const stabilityScore: StabilityScore | undefined = entry.stabilityScore
    ? {
        overall: entry.stabilityScore.overall,
        flakiness: 0,
        performance: 0,
        reliability: 0,
        grade: entry.stabilityScore.grade as StabilityScore['grade'],
        needsAttention: false,
      }
    : undefined;

  return {
    testId: entry.testId,
    title: entry.title,
    file: entry.file,
    status: entry.status as TestResultData['status'],
    duration: entry.duration,
    error: entry.error,
    retry: entry.retry,
    outcome: entry.outcome as TestResultData['outcome'],
    flakinessScore: entry.flakinessScore,
    stabilityScore,
    steps: [],
    history: [],
    a11y: entry.a11y,
  };
}

function main(): void {
  const options = parseArgs(process.argv);
  const config = buildConfig(options);

  // Check if any rules are configured
  const hasRules = config.maxFailures !== undefined
    || config.minPassRate !== undefined
    || config.maxFlakyRate !== undefined
    || config.minStabilityGrade !== undefined
    || config.noNewFailures !== undefined
    || config.maxA11yViolations !== undefined
    || config.maxA11yCritical !== undefined
    || config.maxA11ySerious !== undefined
    || config.minCoverage !== undefined;

  if (!hasRules) {
    console.error('Error: No quality gate rules configured. Use --config or inline flags.');
    printUsage();
    process.exit(1);
  }

  // Load report data
  if (!fs.existsSync(options.inputPath)) {
    console.error(`Error: Report data not found: ${options.inputPath}`);
    console.error('Run your Playwright tests with exportJson: true first.');
    process.exit(1);
  }

  let reportData: unknown;
  try {
    reportData = JSON.parse(fs.readFileSync(options.inputPath, 'utf-8'));
  } catch (err) {
    console.error(`Error: Failed to parse report data: ${(err as Error).message}`);
    process.exit(1);
  }

  const report = reportData as Record<string, unknown>;
  const tests: JsonTestEntry[] = (report.tests as JsonTestEntry[]) || [];
  const results = tests.map(toTestResultData);
  const comparison = report.comparison as RunComparison | undefined;
  const coverage = (report.coverage as { summary?: CoverageSummary } | undefined)?.summary;

  const evaluator = new QualityGateEvaluator();
  const gateResult = evaluator.evaluate(config, results, comparison, coverage);

  console.log(formatGateReport(gateResult));

  if (!gateResult.passed) {
    process.exitCode = 1;
  }
}

main();
