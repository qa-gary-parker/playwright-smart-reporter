#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import type { TestHistory, RunSummary } from '../types';

interface MergeOptions {
  output?: string;
  maxRuns?: number;
  inputFiles: string[];
}

/**
 * Parse command line arguments
 */
function parseArgs(): MergeOptions {
  const args = process.argv.slice(2);
  const options: MergeOptions = {
    inputFiles: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-o' || arg === '--output') {
      options.output = args[++i];
    } else if (arg === '--max-runs') {
      options.maxRuns = parseInt(args[++i], 10);
      if (isNaN(options.maxRuns)) {
        console.error('Error: --max-runs must be a valid number');
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      options.inputFiles.push(arg);
    }
  }

  return options;
}

/**
 * Display usage information
 */
function showUsage(): void {
  console.log(`
Usage: merge-history [options] <input-files...>

Merge multiple test-history.json files from parallel CI runs.

Options:
  -o, --output <file>    Output file path (default: merged-history.json)
  --max-runs <number>    Limit history size to N most recent runs (optional)
  -h, --help            Show this help message

Examples:
  # Merge two history files
  merge-history history1.json history2.json -o merged.json

  # Merge with a quoted pattern and limit to 10 runs
  # (* and ? match within one folder or file name, ** matches any folders)
  merge-history 'blob-reports/**/test-history.json' -o test-history.json --max-runs 10

  # Merge with max-runs limit
  merge-history ci-run1/test-history.json ci-run2/test-history.json --max-runs 20
`);
}

/**
 * Load a test history file
 */
function loadHistoryFile(filePath: string): TestHistory {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);

    // Support both old and new format
    if (parsed.tests) {
      // New format
      return parsed as TestHistory;
    } else {
      // Old format: convert to new format
      return {
        runs: [],
        tests: parsed,
        summaries: [],
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load history from ${filePath}: ${message}`);
  }
}

/**
 * Merge multiple test histories
 */
function mergeHistories(histories: TestHistory[]): TestHistory {
  const merged: TestHistory = {
    runs: [],
    tests: {},
    summaries: [],
  };

  // testId -> entry JSON -> times kept
  const kept = new Map<string, Map<string, number>>();

  // Merge all tests
  for (const history of histories) {
    // An entry restored into several inputs (shards of one run) is kept as often as one input has it
    for (const [testId, entries] of Object.entries(history.tests || {})) {
      if (!merged.tests[testId]) {
        merged.tests[testId] = [];
        kept.set(testId, new Map());
      }
      const keptCounts = kept.get(testId)!;
      const counts = new Map<string, number>();
      for (const entry of entries) {
        const key = JSON.stringify(entry);
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        if (count > (keptCounts.get(key) ?? 0)) {
          keptCounts.set(key, count);
          merged.tests[testId].push(entry);
        }
      }
    }

    // Merge run metadata
    if (history.runs) {
      merged.runs.push(...history.runs);
    }

    // Merge summaries
    if (history.summaries) {
      merged.summaries!.push(...history.summaries);
    }
  }

  // Remove duplicate runs (by runId)
  const seenRunIds = new Set<string>();
  merged.runs = merged.runs.filter((run) => {
    if (seenRunIds.has(run.runId)) {
      return false;
    }
    seenRunIds.add(run.runId);
    return true;
  });

  // Keep a summary restored into several inputs once, and combine the shards of one run (same runId)
  const seenSummaries = new Set<string>();
  const summariesByRunId = new Map<string, RunSummary>();
  for (const summary of merged.summaries!) {
    const key = JSON.stringify(summary);
    if (seenSummaries.has(key)) continue;
    seenSummaries.add(key);
    const prev = summariesByRunId.get(summary.runId);
    if (!prev) {
      summariesByRunId.set(summary.runId, summary);
      continue;
    }
    const total = prev.total + summary.total;
    const passed = prev.passed + summary.passed;
    summariesByRunId.set(summary.runId, {
      ...prev,
      timestamp: summary.timestamp < prev.timestamp ? summary.timestamp : prev.timestamp,
      total,
      passed,
      failed: prev.failed + summary.failed,
      skipped: prev.skipped + summary.skipped,
      flaky: prev.flaky + summary.flaky,
      slow: prev.slow + summary.slow,
      duration: Math.max(prev.duration, summary.duration),
      passRate: total > 0 ? Math.round((passed / total) * 100) : 0,
    });
  }
  merged.summaries = [...summariesByRunId.values()];

  // Sort runs and summaries by timestamp
  merged.runs.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  merged.summaries!.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  // Sort test history entries by timestamp
  for (const testId in merged.tests) {
    merged.tests[testId].sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    });
  }

  return merged;
}

/**
 * Limit history to most recent N runs
 */
function limitHistory(history: TestHistory, maxRuns: number): TestHistory {
  const limited: TestHistory = {
    runs: history.runs.slice(-maxRuns),
    tests: {},
    summaries: history.summaries ? history.summaries.slice(-maxRuns) : [],
  };

  // Get IDs of runs to keep
  const keepRunIds = new Set(limited.runs.map((r) => r.runId));

  // Only keep test entries from runs we're keeping
  if (history.summaries && history.summaries.length > 0) {
    // Keep entries from the start of the oldest kept run on; runs[] is empty without drilldown
    const oldestKeptTimestamp = new Date(limited.summaries![0].timestamp).getTime();

    for (const [testId, entries] of Object.entries(history.tests || {})) {
      limited.tests[testId] = entries.filter((entry) => {
        const entryTime = new Date(entry.timestamp).getTime();
        return entryTime >= oldestKeptTimestamp;
      });
    }
  } else {
    // Fallback: keep last maxRuns entries per test
    for (const [testId, entries] of Object.entries(history.tests || {})) {
      limited.tests[testId] = entries.slice(-maxRuns);
    }
  }

  return limited;
}

/**
 * Write merged history to file
 */
function writeHistory(history: TestHistory, outputPath: string): void {
  try {
    const dir = path.dirname(outputPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(history, null, 2));
    console.log(`✓ Merged history written to: ${outputPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error writing history file: ${message}`);
    process.exit(1);
  }
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Files matching a pattern: * and ? match within one folder or file name, ** matches any folders
 */
function globFiles(pattern: string): string[] {
  const root = path.parse(pattern).root;
  let matches = [root || '.'];
  for (const segment of pattern.slice(root.length).split(/[\\/]/).filter(Boolean)) {
    if (segment === '**') {
      const walk = (dir: string): string[] =>
        [dir, ...readDir(dir).filter((e) => e.isDirectory()).flatMap((e) => walk(path.join(dir, e.name)))];
      matches = matches.flatMap(walk);
    } else if (/[*?]/.test(segment)) {
      const regex = new RegExp(`^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      matches = matches.flatMap((dir) => readDir(dir).filter((e) => regex.test(e.name)).map((e) => path.join(dir, e.name)));
    } else {
      matches = matches.map((dir) => path.join(dir, segment));
    }
  }
  return matches.filter((file) => fs.existsSync(file) && fs.statSync(file).isFile()).sort();
}

/**
 * Expand glob patterns in file paths
 */
function expandPaths(patterns: string[]): string[] {
  const expanded: string[] = [];

  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?')) {
      const matches = globFiles(pattern);
      if (matches.length === 0) {
        console.warn(`Warning: No files matched pattern: ${pattern}`);
      } else {
        expanded.push(...matches);
      }
    } else {
      expanded.push(pattern);
    }
  }

  return [...new Set(expanded)]; // Remove duplicates
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    showUsage();
    process.exit(0);
  }

  const options = parseArgs();

  // Validate input
  if (options.inputFiles.length === 0) {
    console.error('Error: No input files specified');
    showUsage();
    process.exit(1);
  }

  try {
    // Expand glob patterns
    const expandedFiles = expandPaths(options.inputFiles);

    if (expandedFiles.length === 0) {
      console.error('Error: No input files found');
      process.exit(1);
    }

    // Load all history files
    console.log(`Loading ${expandedFiles.length} history file(s)...`);
    const histories: TestHistory[] = [];

    for (const filePath of expandedFiles) {
      try {
        const history = loadHistoryFile(filePath);
        histories.push(history);
        console.log(`  ✓ Loaded: ${filePath}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ Error: ${message}`);
        process.exit(1);
      }
    }

    // Merge histories
    console.log('\nMerging histories...');
    let merged = mergeHistories(histories);

    // Log merge stats before limiting
    const totalTests = Object.keys(merged.tests).length;
    const totalRuns = merged.runs.length;
    console.log(`  ✓ Merged ${totalRuns} unique runs`);
    console.log(`  ✓ Merged ${totalTests} unique tests`);

    // Limit history if requested
    if (options.maxRuns && options.maxRuns > 0) {
      console.log(`\nLimiting history to ${options.maxRuns} most recent runs...`);
      merged = limitHistory(merged, options.maxRuns);
      console.log(`  ✓ Limited to ${merged.runs.length} runs`);
    }

    // Write output
    const outputPath = options.output || 'merged-history.json';
    console.log(`\nWriting output...`);
    writeHistory(merged, outputPath);

    // Print final stats
    console.log('\nMerge Summary:');
    console.log(`  Unique tests: ${Object.keys(merged.tests).length}`);
    console.log(`  Total runs: ${merged.runs.length}`);
    if (merged.summaries && merged.summaries.length > 0) {
      console.log(`  Run summaries: ${merged.summaries.length}`);
      const passRates = merged.summaries.map((s) => s.passRate);
      const avgPassRate = passRates.reduce((a, b) => a + b, 0) / passRates.length;
      console.log(`  Average pass rate: ${Math.round(avgPassRate)}%`);
    }

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\nError: ${message}`);
    process.exit(1);
  }
}

// Run main function
main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
