#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, QualityGateConfig, StabilityScore, RunComparison } from '../types';
import { QualityGateEvaluator } from '../gates/quality-gate-evaluator';
import { formatGateReport } from '../gates/quality-gate-reporter';

interface GateOptions {
  inputPath: string;
  configPath?: string;
  maxFailures?: number;
  minPassRate?: number;
  maxFlakyRate?: number;
  minStabilityGrade?: 'A' | 'B' | 'C' | 'D';
  noNewFailures?: boolean;
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
  -h, --help                  Show this help message

Examples:
  playwright-smart-reporter gate --config gates.json
  playwright-smart-reporter gate --max-failures 5 --min-pass-rate 90
  playwright-smart-reporter gate --input ./report/smart-report-data.json --max-flaky-rate 5
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

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--input':
        options.inputPath = path.resolve(process.cwd(), args[++i]);
        break;
      case '--config':
        options.configPath = path.resolve(process.cwd(), args[++i]);
        break;
      case '--max-failures':
        options.maxFailures = parseInt(args[++i], 10);
        break;
      case '--min-pass-rate':
        options.minPassRate = parseFloat(args[++i]);
        break;
      case '--max-flaky-rate':
        options.maxFlakyRate = parseFloat(args[++i]);
        break;
      case '--min-stability-grade':
        options.minStabilityGrade = args[++i] as 'A' | 'B' | 'C' | 'D';
        break;
      case '--no-new-failures':
        options.noNewFailures = true;
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
    || config.noNewFailures !== undefined;

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

  const evaluator = new QualityGateEvaluator();
  const gateResult = evaluator.evaluate(config, results, comparison);

  console.log(formatGateReport(gateResult));

  if (!gateResult.passed) {
    process.exitCode = 1;
  }
}

main();
