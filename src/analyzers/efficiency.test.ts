import { describe, expect, it } from 'vitest';
import type { AttemptData, TestHistory, TestResultData } from '../types';
import { summarizeEfficiency } from './efficiency';

const T0 = 1_000_000;

// [slot, start offset from T0, duration, status]
type Run = [number, number, number, AttemptData['status']?];

function test(testId: string, ...runs: Run[]): TestResultData {
  const attempts: AttemptData[] = runs.map(([slot, start, duration, status = 'passed'], retry) => ({
    retry, status, duration, steps: [], workerIndex: slot, parallelIndex: slot, startTime: T0 + start,
  }));
  const last = attempts[attempts.length - 1];
  return { testId, title: testId, file: 'a.spec.ts', status: last.status, duration: last.duration, retry: last.retry, steps: [], history: [], attempts };
}

// Slot 0 runs t1-t5, with a failed first attempt of t2. Slot 1 runs t6-t11. t12 never started.
const results: TestResultData[] = [
  test('t1', [0, 5000, 1000]),
  test('t2', [0, 6000, 1500, 'failed'], [0, 7500, 2000]),
  test('t3', [0, 9500, 3000]),
  test('t4', [0, 12500, 4000]),
  test('t5', [0, 16500, 10000]),
  test('t6', [1, 5200, 1000]),
  test('t7', [1, 6200, 1000]),
  test('t8', [1, 7200, 1000]),
  test('t9', [1, 8200, 1000]),
  test('t10', [1, 9200, 1000]),
  test('t11', [1, 10200, 500]),
  { ...test('t12', [0, 0, 0, 'skipped']), attempts: [{ retry: 0, status: 'skipped', duration: 0, steps: [] }] },
];

const entry = (runId: string, extra: object = {}) => ({ passed: true, duration: 1, timestamp: '2026-01-01T00:00:00.000Z', runId, ...extra });
const history: TestHistory = {
  runs: [],
  tests: {
    t1: [entry('run-a', { retry: 1, retryWaste: 2000 }), entry('run-b', { retry: 1 })],
    t2: [entry('run-a', { retry: 1, retryWaste: 500 })],
    t3: [entry('run-a', { retry: 0 }), entry('run-c', { retry: 0 })],
  },
};

const input = {
  results,
  history,
  runIds: ['run-a', 'run-b', 'run-c', 'run-d', 'run-now'],
  runId: 'run-now',
  runStart: T0,
  runDuration: 30_000,
  shard: { current: 1, total: 2 },
  merged: false,
  costPerMinute: 2,
};

describe('summarizeEfficiency', () => {
  it('computes every metric of a run with known durations', () => {
    expect(summarizeEfficiency(input)).toEqual({
      // t2's failed first attempt
      retryWaste: 1500,
      retryWasteByTest: [{ testId: 't2', waste: 1500 }],
      // run-a: 2000 + 500. run-b: t1 was retried before history kept retry waste. run-c: nothing retried.
      // run-d: no entry in history. run-now: this run.
      retryWasteTrend: [
        { runId: 'run-a', retryWaste: 2500 },
        { runId: 'run-b', retryWaste: null },
        { runId: 'run-c', retryWaste: 0 },
        { runId: 'run-d', retryWaste: null },
        { runId: 'run-now', retryWaste: 1500 },
      ],
      // 1000 + 3500 + 3000 + 4000 + 10000 + 5 × 1000 + 500
      testTime: 27_000,
      // 11 tests ran: 5% is 1 test (t5), 10% is 2 tests (t5, t4). 10000 / 27000 and 14000 / 27000.
      longTail: [
        { percent: 5, tests: 1, time: 10_000, share: 0.37, testIds: ['t5'] },
        { percent: 10, tests: 2, time: 14_000, share: 0.519, testIds: ['t5', 't4'] },
      ],
      // First attempt starts 5000 ms after the run
      setupGap: 5000,
      shard: { current: 1, total: 2, wallTime: 30_000 },
      // Attempts span T0+5000 to T0+26500. Slot 0 is busy 21500, slot 1 is busy 5 × 1000 + 500.
      // Utilisation: 27000 / (2 × 21500).
      workers: {
        span: 21_500,
        utilisation: 0.628,
        slots: [
          { slot: 0, attempts: 6, busy: 21_500, idle: 0 },
          { slot: 1, attempts: 6, busy: 5500, idle: 16_000 },
        ],
      },
      // 1500 ms is 0.025 min, at 2 per minute
      cost: { perMinute: 2, retryWaste: 0.05 },
    });
  });

  it('leaves out workers and shard for a merged report, where they cannot be told apart', () => {
    const merged = summarizeEfficiency({ ...input, merged: true, shard: undefined });
    expect([merged.merged, merged.workers, merged.shard]).toEqual([true, undefined, undefined]);
    expect(merged.setupGap).toBe(5000);
  });

  it('has no cost without a price, and no setup gap or workers when no test started', () => {
    const none = summarizeEfficiency({ ...input, results: [results[11]], costPerMinute: undefined, shard: undefined });
    expect(none).toEqual({
      retryWaste: 0,
      retryWasteByTest: [],
      retryWasteTrend: input.runIds.map((runId, i) => ({ runId, retryWaste: [2500, null, 0, null, 0][i] })),
      testTime: 0,
      longTail: [],
    });
  });
});
