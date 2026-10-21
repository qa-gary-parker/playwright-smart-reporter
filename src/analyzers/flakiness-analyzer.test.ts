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

// One run per letter, oldest first: P passed, F failed, R passed on a retry, S skipped.
function historyOf(runs: string): TestHistoryEntry[] {
  return [...runs].map((r) => ({ ...createHistoryEntry(r !== 'F', 1000, r === 'S'), ...(r === 'R' && { retry: 1 }) }));
}

const passedOnRetry: Partial<TestResultData> = { status: 'passed', outcome: 'flaky', retry: 1 };

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

    it('counts this run, so one failure between passes in 11 runs is Stable', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('PPPPPPPPPF'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.09, 11, 'stable', '🟢 Stable']);
    });

    it('marks one failure between passes in 6 runs as Unstable', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('PPPPF'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.17, 6, 'unstable', '🟡 Unstable']);
    });

    it('marks results that keep flipping between pass and fail as Flaky', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('PFPF'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.4, 5, 'flaky', '🔴 Flaky']);
    });

    it('marks a test that failed 5 runs and then passed 6 as Stable, not Flaky', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('FFFFFPPPPP'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.45, 11, 'stable', '🟢 Stable']);
    });

    it('marks a test that passed on retry this run as Flaky after 9 clean passes', () => {
      const test = createTestResult(passedOnRetry);
      analyzer.analyze(test, historyOf('PPPPPPPPP'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.1, 10, 'flaky', '🔴 Flaky']);
    });

    it('reports insufficient history below 5 runs, with the score and its 95% interval', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('PPF'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator, test.flakinessInterval])
        .toEqual([0.25, 4, 'insufficient-history', '⚪ Insufficient history', [0.05, 0.7]]);
    });

    it('gives the 95% Wilson interval of the score over every run', () => {
      const test = createTestResult();
      analyzer.analyze(test, historyOf('FFFFFPPPPP'));

      expect([test.flakinessScore, test.flakinessInterval]).toEqual([0.45, [0.21, 0.72]]);
    });

    it('marks a test that broke and still fails as Failing, not Flaky', () => {
      const test = createTestResult({ status: 'failed', outcome: 'unexpected' });
      analyzer.analyze(test, historyOf('PPPPPPFFFF'));

      expect([test.flakinessScore, test.flakinessRuns, test.flakinessStatus, test.flakinessIndicator]).toEqual([0.45, 11, 'failing', '🔴 Failing']);
    });

    it('excludes skipped runs from flakiness calculation', () => {
      const test = createTestResult();
      const history: TestHistoryEntry[] = [
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(true),
        createHistoryEntry(false, 1000, true), // skipped - should be ignored
        createHistoryEntry(false, 1000, true), // skipped - should be ignored
      ];

      analyzer.analyze(test, history);

      expect([test.flakinessScore, test.flakinessRuns]).toEqual([0, 5]);
      expect(test.flakinessIndicator).toBe('🟢 Stable');
    });

    it('marks consistently failing tests as Failing, not Flaky', () => {
      const test = createTestResult({ status: 'failed', outcome: 'unexpected' });
      const history: TestHistoryEntry[] = [
        createHistoryEntry(false),
        createHistoryEntry(false),
        createHistoryEntry(false),
        createHistoryEntry(false),
      ];

      analyzer.analyze(test, history);

      expect(test.flakinessScore).toBe(1);
      expect(test.flakinessIndicator).toBe('🔴 Failing');
    });

    it('needs 5 runs, this run included, to call a test Failing', () => {
      const failed: Partial<TestResultData> = { status: 'failed', outcome: 'unexpected' };
      const four = createTestResult(failed);
      analyzer.analyze(four, historyOf('FFF'));
      const five = createTestResult(failed);
      analyzer.analyze(five, historyOf('FFFF'));

      expect([four.flakinessIndicator, five.flakinessIndicator]).toEqual(['⚪ Insufficient history', '🔴 Failing']);
    });

    it('counts a run that passed on retry as flaky, and keeps a score of 1 for runs that all failed', () => {
      const mixed = createTestResult();
      analyzer.analyze(mixed, historyOf('RPRP'));
      // A pass on a retry this run is flaky even before there are 5 runs.
      const everyRunRetried = createTestResult(passedOnRetry);
      analyzer.analyze(everyRunRetried, historyOf('RR'));

      expect([mixed.flakinessScore, mixed.flakinessIndicator]).toEqual([0.4, '🔴 Flaky']);
      expect([everyRunRetried.flakinessScore, everyRunRetried.flakinessIndicator]).toEqual([0.99, '🔴 Flaky']);
    });

    it('never rounds a score up to 1 when a run passed', () => {
      // 199 failures and a pass on retry would round to 1.00, which consumers read as failing every run.
      const test = createTestResult(passedOnRetry);
      analyzer.analyze(test, historyOf('F'.repeat(199)));

      expect([test.flakinessScore, test.flakinessIndicator]).toEqual([0.99, '🔴 Flaky']);
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

    it('returns flaky for scores 0.3 up to (but not including) 1', () => {
      expect(analyzer.getStatus(0.3)).toBe('flaky');
      expect(analyzer.getStatus(0.5)).toBe('flaky');
      expect(analyzer.getStatus(0.99)).toBe('flaky');
    });

    it('returns failing when every run failed (score of 1)', () => {
      expect(analyzer.getStatus(1.0)).toBe('failing');
    });
  });
});
