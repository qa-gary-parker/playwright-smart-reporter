import type {
  FlakeForecast,
  ForecastConfig,
  ForecastReason,
  ForecastSignal,
  ForecastSummary,
  TestHistoryEntry,
  TestResultData,
} from '../types';

/**
 * Flake forecasting: an advisory risk score for tests that passed first time
 * this run but whose history is trending unstable. It never feeds quarantine,
 * which stays driven by observed flakiness (flakinessScore).
 *
 * Each signal yields a strength s in [0, 1], capped by its maximum
 * contribution, and the contributions combine as a noisy-OR:
 * risk = 1 - prod(1 - cap * s). One strong signal can flag a test; weak
 * signals only flag it together.
 */

export const DEFAULT_MIN_RUNS = 5;
export const DEFAULT_THRESHOLD = 0.5;
const MIN_RUNS_FLOOR = 3;

const CAP: Record<ForecastSignal, number> = {
  'outcome-instability': 0.9,
  'retry-trend': 0.8,
  'duration-variance': 0.7,
  'duration-drift': 0.5,
};
const SIGNAL_ORDER = Object.keys(CAP) as ForecastSignal[];

const HALF_LIFE_RUNS = 3;
const FLIP_RATE_FULL = 0.35;
const RETRY_RATE_FULL = 0.25;
// MAD scaled to estimate a standard deviation
const MAD_TO_SD = 1.4826;
const SPREAD_WIDENING_FLOOR = 0.05;
const SPREAD_WIDENING_RANGE = 0.25;
// median and MAD over fewer samples move with a single spike
const MIN_DURATION_HALF = 4;
const MIN_SPREAD_MS = 50;
const DRIFT_FLOOR = 0.2;
const DRIFT_RANGE = 1;
const MIN_DRIFT_MS = 100;
const MIN_REASON_WEIGHT = 0.05;

export interface ForecastRun {
  forecasts: Record<string, FlakeForecast>;
  // scored risks above zero, recorded in the history file
  risks: Record<string, number>;
  summary: ForecastSummary;
}

/**
 * Forecast one test from its chronological history, oldest first, with the
 * current run last. Skipped runs are ignored.
 */
export function forecastTest(series: TestHistoryEntry[], minRuns: number = DEFAULT_MIN_RUNS): FlakeForecast {
  const runs = series.filter((e) => !e.skipped);
  const min = Math.max(MIN_RUNS_FLOOR, minRuns);
  if (runs.length < min) return { state: 'insufficient-history', runs: runs.length, minRuns: min };

  const strengths = [outcomeInstability(runs), retryTrend(runs), durationVariance(runs), durationDrift(runs)];
  let survival = 1;
  const reasons: ForecastReason[] = [];
  for (const s of strengths) {
    if (!s) continue;
    const contribution = CAP[s.signal] * s.strength;
    survival *= 1 - contribution;
    const weight = round2(contribution);
    if (weight >= MIN_REASON_WEIGHT) reasons.push({ signal: s.signal, detail: s.detail, weight });
  }
  reasons.sort((a, b) => b.weight - a.weight || SIGNAL_ORDER.indexOf(a.signal) - SIGNAL_ORDER.indexOf(b.signal));
  return { state: 'scored', risk: round2(1 - survival), reasons };
}

/**
 * Forecast every test that passed on its first attempt this run. Failing,
 * flaky, skipped, and expected-failure tests get no forecast.
 */
export function forecastRun(results: TestResultData[], config: ForecastConfig = {}): ForecastRun | undefined {
  if (config.enabled === false) return undefined;
  const minRuns = Number.isFinite(config.minRuns) ? Math.max(MIN_RUNS_FLOOR, Math.floor(config.minRuns!)) : DEFAULT_MIN_RUNS;
  const threshold = Number.isFinite(config.threshold) && config.threshold! > 0 && config.threshold! <= 1 ? config.threshold! : DEFAULT_THRESHOLD;

  const forecasts: Record<string, FlakeForecast> = {};
  const risks: Record<string, number> = {};
  const atRisk: Array<{ testId: string; risk: number }> = [];
  for (const r of results) {
    if (r.status !== 'passed' || r.retry !== 0 || (r.outcome !== undefined && r.outcome !== 'expected')) continue;
    const current: TestHistoryEntry = { passed: true, duration: r.duration, timestamp: '', retry: 0 };
    const forecast = forecastTest([...r.history, current], minRuns);
    forecasts[r.testId] = forecast;
    if (forecast.state !== 'scored') continue;
    if (forecast.risk > 0) risks[r.testId] = forecast.risk;
    if (forecast.risk >= threshold) atRisk.push({ testId: r.testId, risk: forecast.risk });
  }
  atRisk.sort((a, b) => b.risk - a.risk || (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : 0));
  return { forecasts, risks, summary: { atRisk: atRisk.map((a) => a.testId), threshold, minRuns } };
}

interface Strength {
  signal: ForecastSignal;
  strength: number;
  detail: string;
}

function outcomeInstability(runs: TestHistoryEntry[]): Strength | undefined {
  const n = runs.length;
  let flips = 0;
  let flipWeight = 0;
  let totalWeight = 0;
  let lastFlipAge = -1;
  for (let k = 1; k < n; k++) {
    const w = recency(n - 1 - k);
    totalWeight += w;
    if (runs[k].passed !== runs[k - 1].passed) {
      flips++;
      flipWeight += w;
      lastFlipAge = n - 1 - k;
    }
  }
  if (flips === 0) return undefined;
  return {
    signal: 'outcome-instability',
    strength: clamp01(flipWeight / totalWeight / FLIP_RATE_FULL),
    detail: `Pass/fail flipped ${flips} ${flips === 1 ? 'time' : 'times'} in the last ${n} runs, most recently ${ago(lastFlipAge)}`,
  };
}

function retryTrend(runs: TestHistoryEntry[]): Strength | undefined {
  const n = runs.length;
  let retried = 0;
  let retryWeight = 0;
  let totalWeight = 0;
  let lastAge = -1;
  runs.forEach((e, i) => {
    const w = recency(n - 1 - i);
    totalWeight += w;
    if ((e.retry ?? 0) > 0) {
      retried++;
      retryWeight += w;
      lastAge = n - 1 - i;
    }
  });
  if (retried === 0) return undefined;
  return {
    signal: 'retry-trend',
    strength: clamp01(retryWeight / totalWeight / RETRY_RATE_FULL),
    detail: `Retried in ${retried} of the last ${n} runs, most recently ${ago(lastAge)}`,
  };
}

function halves(runs: TestHistoryEntry[]): [number[], number[]] | undefined {
  const durations = runs.map((e) => e.duration);
  const split = Math.floor(durations.length / 2);
  if (split < MIN_DURATION_HALF) return undefined;
  return [durations.slice(0, split), durations.slice(split)];
}

function durationVariance(runs: TestHistoryEntry[]): Strength | undefined {
  const split = halves(runs);
  if (!split) return undefined;
  const [older, recent] = split;
  const recentMedian = median(recent);
  const recentSpread = MAD_TO_SD * mad(recent);
  if (recentMedian <= 0 || recentSpread < MIN_SPREAD_MS) return undefined;
  const olderMedian = median(older);
  const olderCv = olderMedian > 0 ? (MAD_TO_SD * mad(older)) / olderMedian : 0;
  const recentCv = recentSpread / recentMedian;
  const strength = clamp01((recentCv - olderCv - SPREAD_WIDENING_FLOOR) / SPREAD_WIDENING_RANGE);
  if (strength === 0) return undefined;
  return {
    signal: 'duration-variance',
    strength,
    detail: `Duration spread widened from ±${Math.round(olderCv * 100)}% to ±${Math.round(recentCv * 100)}% of the median`,
  };
}

function durationDrift(runs: TestHistoryEntry[]): Strength | undefined {
  const split = halves(runs);
  if (!split) return undefined;
  const [older, recent] = split;
  const before = median(older);
  const after = median(recent);
  if (before <= 0 || after - before < MIN_DRIFT_MS) return undefined;
  const drift = (after - before) / before;
  const strength = clamp01((drift - DRIFT_FLOOR) / DRIFT_RANGE);
  if (strength === 0) return undefined;
  return {
    signal: 'duration-drift',
    strength,
    detail: `Median duration rose ${Math.round(drift * 100)}% from ${Math.round(before)}ms to ${Math.round(after)}ms`,
  };
}

function recency(age: number): number {
  return Math.pow(0.5, age / HALF_LIFE_RUNS);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function ago(age: number): string {
  return age === 0 ? 'this run' : age === 1 ? '1 run ago' : `${age} runs ago`;
}
