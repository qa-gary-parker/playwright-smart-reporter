import type { RunEfficiency, TestHistory, TestResultData } from '../types';
import { retryWasteOf } from '../utils/run-stats';

export interface EfficiencyInput {
  results: TestResultData[];
  history: TestHistory;
  runIds: string[];          // the runs of the trend, oldest first, this run last
  runId: string;
  runStart: number;          // epoch ms, Playwright's FullResult.startTime
  runDuration: number;       // ms
  shard?: { current: number; total: number };
  merged: boolean;           // merge-reports: attempts of every shard, with no record of which shard ran them
  costPerMinute?: number;
}

const LONG_TAIL_PERCENTS = [5, 10];

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// A past run's retry waste from its history entries. null when no entry has the run, or an entry of a
// retried test was saved before history kept retry waste.
function pastRetryWaste(history: TestHistory, runId: string): number | null {
  const entries = Object.values(history.tests).flat().filter((e) => e.runId === runId);
  if (entries.length === 0 || entries.some((e) => e.retryWaste === undefined && e.retry !== 0)) return null;
  return entries.reduce((sum, e) => sum + (e.retryWaste ?? 0), 0);
}

/** Where the run's CI time went: retries, the slowest tests, setup, and each worker slot. */
export function summarizeEfficiency(input: EfficiencyInput): RunEfficiency {
  const { results } = input;
  const retryWasteByTest = results
    .map((r) => ({ testId: r.testId, waste: retryWasteOf(r) }))
    .filter((t) => t.waste > 0)
    .sort((a, b) => b.waste - a.waste);
  const retryWaste = retryWasteByTest.reduce((sum, t) => sum + t.waste, 0);

  const times = results
    .map((r) => ({ testId: r.testId, time: (r.attempts ?? []).reduce((sum, a) => sum + a.duration, 0) }))
    .filter((t) => t.time > 0)
    .sort((a, b) => b.time - a.time);
  const testTime = times.reduce((sum, t) => sum + t.time, 0);
  const longTail = times.length === 0 ? [] : LONG_TAIL_PERCENTS.map((percent) => {
    const top = times.slice(0, Math.ceil((times.length * percent) / 100));
    const time = top.reduce((sum, t) => sum + t.time, 0);
    return { percent, tests: top.length, time, share: round3(time / testTime), testIds: top.map((t) => t.testId) };
  });

  const ran = results.flatMap((r) => r.attempts ?? []).filter((a) => a.startTime !== undefined && a.parallelIndex !== undefined);
  const first = Math.min(...ran.map((a) => a.startTime!));
  const span = Math.max(...ran.map((a) => a.startTime! + a.duration)) - first;
  const slots = [...new Set(ran.map((a) => a.parallelIndex!))].sort((a, b) => a - b).map((slot) => {
    const on = ran.filter((a) => a.parallelIndex === slot);
    const busy = on.reduce((sum, a) => sum + a.duration, 0);
    return { slot, attempts: on.length, busy, idle: Math.max(0, span - busy) };
  });
  const busy = slots.reduce((sum, s) => sum + s.busy, 0);

  return {
    retryWaste,
    retryWasteByTest,
    retryWasteTrend: input.runIds.map((runId) => ({ runId, retryWaste: runId === input.runId ? retryWaste : pastRetryWaste(input.history, runId) })),
    testTime,
    longTail,
    ...(ran.length > 0 && { setupGap: Math.max(0, first - input.runStart) }),
    ...(input.shard && !input.merged && { shard: { ...input.shard, wallTime: input.runDuration } }),
    ...(ran.length > 0 && !input.merged && { workers: { span, utilisation: span > 0 ? round3(busy / (slots.length * span)) : 1, slots } }),
    ...(input.merged && { merged: true as const }),
    ...(typeof input.costPerMinute === 'number' && input.costPerMinute > 0 && {
      // In hundredths: retryWaste / 60000 × costPerMinute × 100, with one division
      cost: { perMinute: input.costPerMinute, retryWaste: Math.round((retryWaste * input.costPerMinute) / 600) / 100 },
    }),
  };
}
