import { describe, expect, it } from 'vitest';
import { clamp01, flipRate, mad, median, recency, wilson } from './stats';

describe('median', () => {
  it('returns the middle value of an odd count', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('returns the mean of the two middle values of an even count', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('returns NaN for an empty list', () => {
    expect(median([])).toBeNaN();
  });

  it('does not reorder its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('mad', () => {
  it('returns the median absolute deviation from the median', () => {
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it('returns 0 when every value is the same', () => {
    expect(mad([5, 5, 5])).toBe(0);
  });
});

describe('clamp01', () => {
  it('clamps to the range 0 to 1', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.25)).toBe(0.25);
    expect(clamp01(1.5)).toBe(1);
  });
});

describe('recency', () => {
  it('halves the weight every half-life', () => {
    expect(recency(0, 3)).toBe(1);
    expect(recency(3, 3)).toBe(0.5);
    expect(recency(6, 3)).toBe(0.25);
  });
});

describe('flipRate', () => {
  it('returns the share of consecutive outcomes that changed', () => {
    expect(flipRate([true, false, true, true])).toBe(2 / 3);
  });

  it('returns 0 for fewer than two outcomes', () => {
    expect(flipRate([])).toBe(0);
    expect(flipRate([false])).toBe(0);
  });

  it('weighs each pair by the age of its newer outcome, where the newest outcome has age 0', () => {
    // the oldest pair flipped and weighs 0.5; the newest pair did not and weighs 1
    expect(flipRate([true, false, false], (age) => recency(age, 1))).toBe(1 / 3);
  });
});

describe('wilson', () => {
  const round2 = ([lo, hi]: [number, number]) => [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];

  it('gives the 95% Wilson interval of a rate', () => {
    expect(round2(wilson(1, 3))).toEqual([0.06, 0.79]);
    expect(round2(wilson(30, 90))).toEqual([0.24, 0.44]);
  });

  it('stays within 0 and 1 at the extremes', () => {
    expect(round2(wilson(0, 5))).toEqual([0, 0.43]);
    expect(round2(wilson(5, 5))).toEqual([0.57, 1]);
  });

  it('is 0 to 1 with no runs', () => {
    expect(wilson(0, 0)).toEqual([0, 1]);
  });
});
