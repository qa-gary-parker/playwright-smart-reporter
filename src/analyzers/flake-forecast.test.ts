import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { QuarantineGenerator } from '../quarantine';
import type { TestHistoryEntry, TestResultData } from '../types';
import { FlakinessAnalyzer } from './flakiness-analyzer';
import { forecastRun, forecastTest } from './flake-forecast';

// '.' first-try pass, 'r' pass after retry, 'F' fail, 's' skipped
function series(pattern: string, durations: number[] | number = 1000): TestHistoryEntry[] {
  return [...pattern].map((c, i) => ({
    passed: c !== 'F',
    duration: Array.isArray(durations) ? durations[i] : durations,
    timestamp: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    retry: c === 'r' ? 1 : 0,
    skipped: c === 's',
  }));
}

const STABLE = [1000, 1010, 990, 1005, 995, 1002, 998, 1007, 993, 1001];
const WIDENING = [1000, 1010, 990, 1005, 995, 900, 1150, 800, 1300, 700];

describe('forecastTest', () => {
  it('scores a stable series at zero with no reasons', () => {
    expect(forecastTest(series('..........', STABLE))).toEqual({ state: 'scored', risk: 0, reasons: [] });
  });

  it('scores a widening-variance series high', () => {
    expect(forecastTest(series('..........', WIDENING))).toEqual({
      state: 'scored',
      risk: 0.7,
      reasons: [{ signal: 'duration-variance', detail: 'Duration spread widened from ±1% to ±33% of the median', weight: 0.7 }],
    });
  });

  it('returns insufficient history for a short series instead of a number', () => {
    expect(forecastTest(series('F.F.'))).toEqual({ state: 'insufficient-history', runs: 4, minRuns: 5 });
  });

  it('does not count skipped runs towards the minimum', () => {
    expect(forecastTest(series('.s.s..'))).toEqual({ state: 'insufficient-history', runs: 4, minRuns: 5 });
  });

  it('raises a minimum below 3 to 3', () => {
    expect(forecastTest(series('..'), 1)).toEqual({ state: 'insufficient-history', runs: 2, minRuns: 3 });
  });

  it('weights a recent pass/fail flip as outcome instability', () => {
    expect(forecastTest(series('....F.'))).toEqual({
      state: 'scored',
      risk: 0.9,
      reasons: [{ signal: 'outcome-instability', detail: 'Pass/fail flipped 2 times in the last 6 runs, most recently this run', weight: 0.9 }],
    });
  });

  it('does not treat a fixed, long-past breakage as instability', () => {
    const forecast = forecastTest(series('FFFFF.....'));
    expect(forecast).toEqual({
      state: 'scored',
      risk: 0.24,
      reasons: [{ signal: 'outcome-instability', detail: 'Pass/fail flipped 1 time in the last 10 runs, most recently 4 runs ago', weight: 0.24 }],
    });
  });

  it('scores passes that needed retries as a retry trend', () => {
    expect(forecastTest(series('.r.rrr..r.'))).toEqual({
      state: 'scored',
      risk: 0.8,
      reasons: [{ signal: 'retry-trend', detail: 'Retried in 5 of the last 10 runs, most recently 1 run ago', weight: 0.8 }],
    });
  });

  it('scores a step up in median duration as drift', () => {
    expect(forecastTest(series('..........', [1000, 1000, 1000, 1000, 1000, 2200, 2200, 2200, 2200, 2200]))).toEqual({
      state: 'scored',
      risk: 0.5,
      reasons: [{ signal: 'duration-drift', detail: 'Median duration rose 120% from 1000ms to 2200ms', weight: 0.5 }],
    });
  });

  it('combines signals so two together outscore either alone', () => {
    expect(forecastTest(series('..........', [1000, 1000, 1000, 1000, 1000, 1800, 2600, 2200, 3000, 1400]))).toEqual({
      state: 'scored',
      risk: 0.81,
      reasons: [
        { signal: 'duration-variance', detail: 'Duration spread widened from ±0% to ±27% of the median', weight: 0.61 },
        { signal: 'duration-drift', detail: 'Median duration rose 120% from 1000ms to 2200ms', weight: 0.5 },
      ],
    });
  });

  it('ignores a single duration spike', () => {
    expect(forecastTest(series('..........', [6500, 6600, 6400, 6550, 6450, 6500, 46730, 8400, 6350, 6460]))).toEqual({ state: 'scored', risk: 0, reasons: [] });
  });

  it('needs four runs in each half before scoring duration signals', () => {
    // backtest false alarm: one spike in a 3-run half read as widening spread
    expect(forecastTest(series('......', [687, 666, 642, 642, 4673, 840]))).toEqual({ state: 'scored', risk: 0, reasons: [] });
  });

  it('ignores jitter in very short tests', () => {
    expect(forecastTest(series('..........', [10, 10, 10, 10, 10, 10, 30, 5, 40, 2]))).toEqual({ state: 'scored', risk: 0, reasons: [] });
  });
});

function result(over: Partial<TestResultData> & { testId: string }): TestResultData {
  return { title: over.testId, file: 'a.spec.ts', status: 'passed', duration: 1000, retry: 0, steps: [], history: [], outcome: 'expected', ...over };
}

// history holds prior runs only; forecastRun appends the current run
const RESULTS = [
  result({ testId: 'variance', duration: 700, history: series('.........', WIDENING.slice(0, 9)) }),
  result({ testId: 'unstable', history: series('....F') }),
  result({ testId: 'stable', duration: 1001, history: series('.........', STABLE.slice(0, 9)) }),
  result({ testId: 'short', history: series('F.F') }),
  result({ testId: 'failing', status: 'failed', outcome: 'unexpected', history: series('F.F.F.F.F') }),
  result({ testId: 'flaky-now', outcome: 'flaky', retry: 1, history: series('F.F.F.F.F') }),
  result({ testId: 'expected-fail', status: 'failed', outcome: 'expected', expectedStatus: 'failed', history: series('F.F.F.F.F') }),
  result({ testId: 'skipped', status: 'skipped', outcome: 'skipped', history: series('F.F.F.F.F') }),
];

describe('forecastRun', () => {
  it('forecasts only tests that passed first time this run and lists the at-risk ones by risk', () => {
    const run = forecastRun(RESULTS)!;
    expect(Object.keys(run.forecasts).sort()).toEqual(['short', 'stable', 'unstable', 'variance']);
    expect(run.forecasts.short).toEqual({ state: 'insufficient-history', runs: 4, minRuns: 5 });
    expect(run.forecasts.stable).toEqual({ state: 'scored', risk: 0, reasons: [] });
    expect(run.summary).toEqual({ atRisk: ['unstable', 'variance'], threshold: 0.5, minRuns: 5 });
    expect(run.risks).toEqual({ unstable: 0.9, variance: 0.7 });
  });

  it('applies minRuns and threshold options and breaks risk ties by test id', () => {
    const run = forecastRun(RESULTS, { minRuns: 1, threshold: 0.8 })!;
    expect(run.forecasts.short).toEqual({
      state: 'scored',
      risk: 0.9,
      reasons: [{ signal: 'outcome-instability', detail: 'Pass/fail flipped 3 times in the last 4 runs, most recently this run', weight: 0.9 }],
    });
    expect(run.summary).toEqual({ atRisk: ['short', 'unstable'], threshold: 0.8, minRuns: 3 });
  });

  it('falls back to defaults for out-of-range options', () => {
    expect(forecastRun(RESULTS, { minRuns: Number.NaN, threshold: 2 })!.summary).toEqual({ atRisk: ['unstable', 'variance'], threshold: 0.5, minRuns: 5 });
  });

  it('returns undefined when disabled', () => {
    expect(forecastRun(RESULTS, { enabled: false })).toBe(undefined);
  });

  it('does not quarantine a test it forecasts as high risk', () => {
    const drifting = result({ testId: 'drifting', duration: 700, history: series('.........', WIDENING.slice(0, 9)) });
    new FlakinessAnalyzer().analyze(drifting, drifting.history);
    const before = structuredClone(drifting);

    const run = forecastRun([drifting])!;
    expect(run.summary.atRisk).toEqual(['drifting']);
    expect(drifting).toEqual(before);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forecast-quarantine-'));
    try {
      expect(drifting.flakinessScore).toBe(0);
      expect(new QuarantineGenerator({ enabled: true }).generate([drifting], dir).entries).toEqual([]);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
