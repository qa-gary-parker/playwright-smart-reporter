import * as fs from 'fs';
import * as path from 'path';
import type { TestHistory, RunSummary, HistoryRunFile } from '../types';
import { passRateOf } from './run-stats';

/**
 * The one history merge, used by the merge-history bin and the exported mergeHistories().
 */

/**
 * Load a test history file
 */
export function readHistoryFile(filePath: string): TestHistory {
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

/** `<history base>.runs/` beside a history file, for example `test-history.runs/` */
export function runsDirOf(historyPath: string): string {
  return path.join(path.dirname(historyPath), `${path.basename(historyPath, path.extname(historyPath))}.runs`);
}

/**
 * Adds the run files beside a history file to runFiles, by file name. The same file name in two
 * folders is one run and shard, so the later attempt is kept. A file that cannot be read is skipped.
 */
export function readRunFiles(historyPath: string, runFiles = new Map<string, HistoryRunFile>()): Map<string, HistoryRunFile> {
  const dir = runsDirOf(historyPath);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return runFiles;
  }
  for (const name of names) {
    try {
      const run = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as HistoryRunFile;
      if (run.version !== 1 || !run.summary?.runId || !run.tests) throw new Error('not a version 1 run file');
      const kept = runFiles.get(name);
      if (!kept || run.summary.timestamp > kept.summary.timestamp) runFiles.set(name, run);
    } catch (err) {
      console.warn(`Skipped history run file ${path.join(dir, name)}:`, err instanceof Error ? err.message : err);
    }
  }
  return runFiles;
}

/**
 * The history of index files plus run files: each index keeps its runs that have no run file,
 * and every run file adds its run. The run files of one run's shards combine into one summary.
 */
export function rebuildHistory(indexes: TestHistory[], runFiles: Iterable<HistoryRunFile>): TestHistory {
  const runs = [...runFiles];
  const fromFiles = new Set(runs.map((run) => run.summary.runId));
  const kept = indexes.map((index): TestHistory => ({
    ...index,
    tests: Object.fromEntries(
      Object.entries(index.tests ?? {})
        .map(([testId, entries]) => [testId, entries.filter((e) => !e.runId || !fromFiles.has(e.runId))] as const)
        .filter(([, entries]) => entries.length > 0),
    ),
    summaries: (index.summaries ?? []).filter((s) => !fromFiles.has(s.runId)),
    forecasts: index.forecasts && Object.fromEntries(Object.entries(index.forecasts).filter(([runId]) => !fromFiles.has(runId))),
  }));
  // Each file is a distinct shard, so combine here: the merge below keeps equal summaries once
  const summaries = new Map<string, RunSummary>();
  for (const { summary } of runs) {
    const prev = summaries.get(summary.runId);
    summaries.set(summary.runId, prev ? combineShardSummaries(prev, summary) : summary);
  }
  return mergeHistoryData([
    ...kept,
    ...runs.map(({ summary, tests, forecasts }): TestHistory => ({
      runs: [],
      tests: Object.fromEntries(Object.entries(tests).map(([testId, entry]) => [testId, [entry]])),
      forecasts: forecasts && { [summary.runId]: forecasts },
    })),
    { runs: [], tests: {}, summaries: [...summaries.values()] },
  ]);
}

/**
 * Merge multiple test histories
 */
export function mergeHistoryData(histories: TestHistory[]): TestHistory {
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

    // Each shard records the forecasts of its own tests under the run's id
    for (const [runId, risks] of Object.entries(history.forecasts ?? {})) {
      merged.forecasts ??= {};
      merged.forecasts[runId] = { ...merged.forecasts[runId], ...risks };
    }

    for (const [runId, file] of Object.entries(history.runFiles ?? {})) {
      merged.runFiles ??= {};
      merged.runFiles[runId] ??= file;
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
    summariesByRunId.set(summary.runId, prev ? combineShardSummaries(prev, summary) : summary);
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

/** One summary for two shards of a run: counts add up, the run starts with the first shard and lasts as long as the longest. */
export function combineShardSummaries(prev: RunSummary, summary: RunSummary): RunSummary {
  const total = prev.total + summary.total;
  const passed = prev.passed + summary.passed;
  const skipped = prev.skipped + summary.skipped;
  return {
    ...prev,
    timestamp: summary.timestamp < prev.timestamp ? summary.timestamp : prev.timestamp,
    total,
    passed,
    failed: prev.failed + summary.failed,
    skipped,
    flaky: prev.flaky + summary.flaky,
    slow: prev.slow + summary.slow,
    duration: Math.max(prev.duration, summary.duration),
    passRate: passRateOf({ total, passed, skipped }),
  };
}

/**
 * Limit history to most recent N runs
 */
export function limitHistory(history: TestHistory, maxRuns: number): TestHistory {
  const limited: TestHistory = {
    runs: history.runs.slice(-maxRuns),
    tests: {},
    summaries: history.summaries ? history.summaries.slice(-maxRuns) : [],
  };

  // Get IDs of runs to keep
  const keepRunIds = new Set(limited.runs.map((r) => r.runId));
  const keepSummaryIds = new Set(limited.summaries!.map((s) => s.runId));

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

  if (history.forecasts) {
    limited.forecasts = Object.fromEntries(Object.entries(history.forecasts).filter(([runId]) => keepSummaryIds.has(runId)));
  }
  if (history.runFiles) {
    limited.runFiles = Object.fromEntries(Object.entries(history.runFiles).filter(([runId]) => keepRunIds.has(runId)));
  }

  return limited;
}
