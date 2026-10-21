import * as fs from 'fs';
import type { TestHistory, RunSummary } from '../types';
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
