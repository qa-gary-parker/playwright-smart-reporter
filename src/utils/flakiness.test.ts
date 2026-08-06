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
    it('treats a flaky outcome as flaky regardless of score', () => {
      expect(isFlakyTest({ outcome: 'flaky', flakinessScore: 1 })).toBe(true);
      expect(isFlakyTest({ outcome: 'flaky', flakinessScore: undefined })).toBe(true);
    });

    it('uses the score when outcome is not flaky', () => {
      expect(isFlakyTest({ outcome: 'unexpected', flakinessScore: 0.5 })).toBe(true);
      expect(isFlakyTest({ outcome: 'unexpected', flakinessScore: 1 })).toBe(false);
      expect(isFlakyTest({ outcome: 'expected', flakinessScore: 0.1 })).toBe(false);
    });
  });
});
