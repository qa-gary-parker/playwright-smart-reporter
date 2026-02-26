import { describe, it, expect } from 'vitest';
import { FlakinessAnalyzer } from './flakiness-analyzer';
import type { TestResultData, TestHistoryEntry } from '../types';

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test 1',
    file: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

function createHistoryEntry(passed: boolean, duration: number = 1000, skipped: boolean = false): TestHistoryEntry {
  return {
    passed,
    duration,
    timestamp: new Date().toISOString(),
    skipped,
  };
}

describe('FlakinessAnalyzer', () => {
  const analyzer = new FlakinessAnalyzer();

  describe('analyze', () => {
    it('marks skipped tests with skipped indicator', () => {
      const test = createTestResult({ status: 'skipped' });
      const history: TestHistoryEntry[] = [];

      analyzer.analyze(test, history);

      expect(test.flakinessIndicator).toBe('⚪ Skipped');
      expect(test.flakinessScore).toBeUndefined();
    });

    it('marks new tests with no history', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [];

      analyzer.analyze(test, history);

      expect(test.flakinessIndicator).toBe('⚪ New');
    });

    it('marks stable tests (less than 10% failures)', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(false), // 10% failure rate
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessScore).toBe(0.1);
      expect(test.flakinessIndicator).toBe('🟡 Unstable');
    });

    it('marks unstable tests (10-30% failures)', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(false), // 20% failure rate
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessScore).toBe(0.2);
      expect(test.flakinessIndicator).toBe('🟡 Unstable');
    });

    it('marks flaky tests (30%+ failures)', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(true),
        createHistoryEntry(false),
        createHistoryEntry(true),
        createHistoryEntry(false), // 50% failure rate
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessScore).toBe(0.5);
      expect(test.flakinessIndicator).toBe('🔴 Flaky');
    });

    it('excludes skipped runs from flakiness calculation', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(false, 1000, true), // skipped - should be ignored
        createHistoryEntry(false, 1000, true), // skipped - should be ignored
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessScore).toBe(0);
      expect(test.flakinessIndicator).toBe('🟢 Stable');
    });

    it('marks as skipped if all history entries are skipped', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(false, 1000, true),
        createHistoryEntry(false, 1000, true),
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessIndicator).toBe('⚪ Skipped');
    });
  });

  describe('getStatus', () => {
    it('returns new for undefined score', () => {
      expect(analyzer.getStatus(undefined)).toBe('new');
    });

    it('returns stable for scores under 0.1', () => {
      expect(analyzer.getStatus(0)).toBe('stable');
      expect(analyzer.getStatus(0.05)).toBe('stable');
      expect(analyzer.getStatus(0.09)).toBe('stable');
    });

    it('returns unstable for scores 0.1-0.3', () => {
      expect(analyzer.getStatus(0.1)).toBe('unstable');
      expect(analyzer.getStatus(0.2)).toBe('unstable');
      expect(analyzer.getStatus(0.29)).toBe('unstable');
    });

    it('returns flaky for scores 0.3+', () => {
      expect(analyzer.getStatus(0.3)).toBe('flaky');
      expect(analyzer.getStatus(0.5)).toBe('flaky');
      expect(analyzer.getStatus(1.0)).toBe('flaky');
    });
  });
});
