/**
 * Statistics helpers shared by the analyzers
 */

/** Fewest non-skipped runs, this run included, that a flakiness or duration verdict is given from. */
export const MIN_SAMPLE_RUNS = 5;

/** Middle value, or the mean of the two middle values for an even count. NaN for an empty list. */
export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation from the median. */
export function mad(xs: readonly number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Weight 1 at age 0, halved every `halfLife` steps of age. */
export function recency(age: number, halfLife: number): number {
  return Math.pow(0.5, age / halfLife);
}

/**
 * Share of consecutive outcomes, oldest first, that differ from the one before.
 * Each pair weighs `weight(age)` of its newer outcome, where the newest outcome
 * has age 0; every pair weighs 1 by default. 0 for fewer than two outcomes.
 */
export function flipRate(outcomes: readonly boolean[], weight: (age: number) => number = () => 1): number {
  const n = outcomes.length;
  let flipped = 0;
  let total = 0;
  for (let k = 1; k < n; k++) {
    const w = weight(n - 1 - k);
    total += w;
    if (outcomes[k] !== outcomes[k - 1]) flipped += w;
  }
  return total > 0 ? flipped / total : 0;
}

/** 95% Wilson score interval of the rate `k` of `n`, as [low, high]. [0, 1] when `n` is 0. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z2 = 1.96 * 1.96;
  const p = k / n;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [clamp01((centre - margin) / denominator), clamp01((centre + margin) / denominator)];
}
