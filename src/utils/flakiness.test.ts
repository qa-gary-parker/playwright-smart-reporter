import { describe, it, expect } from 'vitest';
import { isFlakyScore, isConsistentlyFailingScore, isFlakyTest } from './flakiness';

describe('flakiness helpers', () => {
  describe('isFlakyScore', () => {
    it('returns false for undefined', () => {
      expect(isFlakyScore(undefined)).toBe(false);
    });

    it('returns false below the threshold', () => {
      expect(isFlakyScore(0)).toBe(false);
      expect(isFlakyScore(0.29)).toBe(false);
    });

    it('returns true for mixed pass/fail scores at or above the threshold', () => {
      expect(isFlakyScore(0.3)).toBe(true);
      expect(isFlakyScore(0.5)).toBe(true);
      expect(isFlakyScore(0.99)).toBe(true);
    });

    it('returns false for a score of 1 (consistently failing, not flaky)', () => {
      expect(isFlakyScore(1)).toBe(false);
    });

    it('respects a custom threshold', () => {
      expect(isFlakyScore(0.2, 0.1)).toBe(true);
      expect(isFlakyScore(0.05, 0.1)).toBe(false);
    });
  });

  describe('isConsistentlyFailingScore', () => {
    it('returns true only for a score of 1', () => {
      expect(isConsistentlyFailingScore(1)).toBe(true);
      expect(isConsistentlyFailingScore(0.99)).toBe(false);
      expect(isConsistentlyFailingScore(undefined)).toBe(false);
    });
  });

  describe('isFlakyTest', () => {
    it('treats a flaky outcome as flaky regardless of history', () => {
      expect(isFlakyTest({ outcome: 'flaky', flakinessStatus: 'failing' })).toBe(true);
      expect(isFlakyTest({ outcome: 'flaky' })).toBe(true);
    });

    it('uses the history classification, not the failure rate, when outcome is not flaky', () => {
      const flaky = { outcome: 'unexpected' as const, flakinessStatus: 'flaky' as const, flakinessScore: 0.5 };
      const broken = { outcome: 'unexpected' as const, flakinessStatus: 'failing' as const, flakinessScore: 0.45 };
      const fixed = { outcome: 'expected' as const, flakinessStatus: 'stable' as const, flakinessScore: 0.45 };

      expect([isFlakyTest(flaky), isFlakyTest(broken), isFlakyTest(fixed)]).toEqual([true, false, false]);
    });
  });
});
