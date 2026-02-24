import { describe, it, expect } from 'vitest';
import { HealthDigest } from './health-digest';
import type { TestHistory, RunSummary, TestHistoryEntry, DigestOptions } from '../types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function timestamp(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString();
}

function createSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    timestamp: timestamp(0),
    total: 10,
    passed: 9,
    failed: 1,
    skipped: 0,
    flaky: 0,
    slow: 0,
    duration: 5000,
    passRate: 90,
    ...overrides,
  };
}

function createEntry(overrides: Partial<TestHistoryEntry> = {}): TestHistoryEntry {
  return {
    passed: true,
    duration: 1000,
    timestamp: timestamp(0),
    ...overrides,
  };
}

function createOptions(overrides: Partial<DigestOptions> = {}): DigestOptions {
  return {
    period: 'weekly',
    historyFile: 'test-history.json',
    ...overrides,
  };
}

function emptyHistory(): TestHistory {
  return { runs: [], tests: {}, summaries: [] };
}

describe('HealthDigest', () => {
  const digest = new HealthDigest();

  describe('analyze()', () => {
    it('returns data with correct period metadata for weekly', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(5), passRate: 90 }),
          createSummary({ runId: 'r2', timestamp: timestamp(3), passRate: 92 }),
          createSummary({ runId: 'r3', timestamp: timestamp(1), passRate: 95 }),
        ],
      };

      const result = digest.analyze(history, createOptions({ period: 'weekly' }));

      expect(result.period).toBe('weekly');
      expect(result.runsAnalyzed).toBe(3);
    });

    it('returns empty digest when no summaries in range', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(15) }),
        ],
      };

      const result = digest.analyze(history, createOptions({ period: 'weekly' }));

      expect(result.runsAnalyzed).toBe(0);
      expect(result.passRateTrend).toBeNull();
      expect(result.newFlakyTests).toEqual([]);
      expect(result.recoveredTests).toEqual([]);
      expect(result.performanceTrends).toEqual([]);
    });

    it('detects pass rate trending up', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 85 }),
          createSummary({ runId: 'r2', timestamp: timestamp(3), passRate: 90 }),
          createSummary({ runId: 'r3', timestamp: timestamp(1), passRate: 96 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.passRateTrend).not.toBeNull();
      expect(result.passRateTrend!.direction).toBe('up');
      expect(result.passRateTrend!.from).toBe(85);
      expect(result.passRateTrend!.to).toBe(96);
    });

    it('detects pass rate trending down', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 96 }),
          createSummary({ runId: 'r2', timestamp: timestamp(3), passRate: 90 }),
          createSummary({ runId: 'r3', timestamp: timestamp(1), passRate: 85 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.passRateTrend).not.toBeNull();
      expect(result.passRateTrend!.direction).toBe('down');
      expect(result.passRateTrend!.from).toBe(96);
      expect(result.passRateTrend!.to).toBe(85);
    });

    it('detects pass rate stable when change is within 1%', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 95 }),
          createSummary({ runId: 'r2', timestamp: timestamp(3), passRate: 95.5 }),
          createSummary({ runId: 'r3', timestamp: timestamp(1), passRate: 95.8 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.passRateTrend).not.toBeNull();
      expect(result.passRateTrend!.direction).toBe('stable');
    });

    it('detects new flaky tests (was stable, now flaky)', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-flaky': [
            // Before period: stable
            createEntry({ passed: true, timestamp: timestamp(14) }),
            createEntry({ passed: true, timestamp: timestamp(12) }),
            createEntry({ passed: true, timestamp: timestamp(10) }),
            // In period: flaky (3 of 5 fail = 0.6 score)
            createEntry({ passed: false, timestamp: timestamp(6) }),
            createEntry({ passed: true, timestamp: timestamp(5) }),
            createEntry({ passed: false, timestamp: timestamp(4) }),
            createEntry({ passed: false, timestamp: timestamp(3) }),
            createEntry({ passed: true, timestamp: timestamp(2) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6) }),
          createSummary({ runId: 'r2', timestamp: timestamp(3) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.newFlakyTests.length).toBe(1);
      expect(result.newFlakyTests[0].testId).toBe('test-flaky');
      expect(result.newFlakyTests[0].flakinessScore).toBeGreaterThanOrEqual(0.3);
    });

    it('detects recovered tests (was flaky, now stable for 3+ runs)', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-recovered': [
            // Before period: flaky
            createEntry({ passed: false, timestamp: timestamp(14) }),
            createEntry({ passed: true, timestamp: timestamp(13) }),
            createEntry({ passed: false, timestamp: timestamp(12) }),
            createEntry({ passed: true, timestamp: timestamp(11) }),
            createEntry({ passed: false, timestamp: timestamp(10) }),
            // In period: stable (all pass, 4 consecutive)
            createEntry({ passed: true, timestamp: timestamp(6), runId: 'r1' }),
            createEntry({ passed: true, timestamp: timestamp(5), runId: 'r2' }),
            createEntry({ passed: true, timestamp: timestamp(4), runId: 'r3' }),
            createEntry({ passed: true, timestamp: timestamp(3), runId: 'r4' }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6) }),
          createSummary({ runId: 'r2', timestamp: timestamp(3) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.recoveredTests.length).toBe(1);
      expect(result.recoveredTests[0].testId).toBe('test-recovered');
      expect(result.recoveredTests[0].stableForRuns).toBeGreaterThanOrEqual(3);
    });

    it('detects performance regression (>20% slower)', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-slow': [
            // Before period: ~1000ms
            createEntry({ passed: true, duration: 1000, timestamp: timestamp(14) }),
            createEntry({ passed: true, duration: 1000, timestamp: timestamp(12) }),
            createEntry({ passed: true, duration: 1000, timestamp: timestamp(10) }),
            // In period: ~1500ms (50% slower)
            createEntry({ passed: true, duration: 1500, timestamp: timestamp(6) }),
            createEntry({ passed: true, duration: 1500, timestamp: timestamp(4) }),
            createEntry({ passed: true, duration: 1500, timestamp: timestamp(2) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6) }),
          createSummary({ runId: 'r2', timestamp: timestamp(2) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.performanceTrends.length).toBe(1);
      expect(result.performanceTrends[0].testId).toBe('test-slow');
      expect(result.performanceTrends[0].percentChange).toBeGreaterThan(20);
    });

    it('handles empty history', () => {
      const result = digest.analyze(emptyHistory(), createOptions());

      expect(result.runsAnalyzed).toBe(0);
      expect(result.passRateTrend).toBeNull();
      expect(result.newFlakyTests).toEqual([]);
      expect(result.recoveredTests).toEqual([]);
      expect(result.performanceTrends).toEqual([]);
    });

    it('handles history with no test entries', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(3), passRate: 90 }),
          createSummary({ runId: 'r2', timestamp: timestamp(1), passRate: 92 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.runsAnalyzed).toBe(2);
      expect(result.newFlakyTests).toEqual([]);
      expect(result.recoveredTests).toEqual([]);
      expect(result.performanceTrends).toEqual([]);
    });

    it('filters to daily period (24h window)', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r-old', timestamp: timestamp(3), passRate: 80 }),
          createSummary({ runId: 'r-recent', timestamp: timestamp(0.5), passRate: 95 }),
        ],
      };

      const result = digest.analyze(history, createOptions({ period: 'daily' }));

      expect(result.period).toBe('daily');
      expect(result.runsAnalyzed).toBe(1);
    });

    it('filters to monthly period', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r-old', timestamp: timestamp(45), passRate: 80 }),
          createSummary({ runId: 'r1', timestamp: timestamp(25), passRate: 85 }),
          createSummary({ runId: 'r2', timestamp: timestamp(15), passRate: 90 }),
          createSummary({ runId: 'r3', timestamp: timestamp(5), passRate: 95 }),
        ],
      };

      const result = digest.analyze(history, createOptions({ period: 'monthly' }));

      expect(result.period).toBe('monthly');
      expect(result.runsAnalyzed).toBe(3);
    });

    it('handles only skipped entries in period', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-skipped': [
            createEntry({ passed: false, skipped: true, timestamp: timestamp(3) }),
            createEntry({ passed: false, skipped: true, timestamp: timestamp(2) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(3) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.newFlakyTests).toEqual([]);
      expect(result.recoveredTests).toEqual([]);
    });

    it('handles single run in period (no trend for pass rate with one summary)', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(2), passRate: 90 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.runsAnalyzed).toBe(1);
      // With a single summary, from and to are the same so direction is stable
      expect(result.passRateTrend).not.toBeNull();
      expect(result.passRateTrend!.direction).toBe('stable');
    });

    it('does not report flaky test as new if it was already flaky before period', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-already-flaky': [
            // Before period: already flaky
            createEntry({ passed: false, timestamp: timestamp(14) }),
            createEntry({ passed: true, timestamp: timestamp(13) }),
            createEntry({ passed: false, timestamp: timestamp(12) }),
            // In period: still flaky
            createEntry({ passed: false, timestamp: timestamp(5) }),
            createEntry({ passed: true, timestamp: timestamp(4) }),
            createEntry({ passed: false, timestamp: timestamp(3) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(5) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.newFlakyTests).toEqual([]);
    });

    it('reports flaky test as new if no entries before period', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-new-flaky': [
            // Only in period
            createEntry({ passed: false, timestamp: timestamp(5) }),
            createEntry({ passed: true, timestamp: timestamp(4) }),
            createEntry({ passed: false, timestamp: timestamp(3) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(5) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.newFlakyTests.length).toBe(1);
      expect(result.newFlakyTests[0].testId).toBe('test-new-flaky');
    });

    it('does not report performance change under 20% threshold', () => {
      const history: TestHistory = {
        runs: [],
        tests: {
          'test-ok': [
            createEntry({ passed: true, duration: 1000, timestamp: timestamp(14) }),
            createEntry({ passed: true, duration: 1000, timestamp: timestamp(12) }),
            // In period: only 10% slower
            createEntry({ passed: true, duration: 1100, timestamp: timestamp(5) }),
            createEntry({ passed: true, duration: 1100, timestamp: timestamp(3) }),
          ],
        },
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(5) }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.performanceTrends).toEqual([]);
    });

    it('generates correct summary text', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
        summaries: [
          createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 85 }),
          createSummary({ runId: 'r2', timestamp: timestamp(3), passRate: 90 }),
          createSummary({ runId: 'r3', timestamp: timestamp(1), passRate: 96 }),
        ],
      };

      const result = digest.analyze(history, createOptions());

      expect(result.summary).toContain('3 runs analyzed');
      expect(result.summary).toContain('up');
    });

    it('handles undefined summaries array', () => {
      const history: TestHistory = {
        runs: [],
        tests: {},
      };

      const result = digest.analyze(history, createOptions());

      expect(result.runsAnalyzed).toBe(0);
      expect(result.passRateTrend).toBeNull();
    });
  });

  describe('generateMarkdown()', () => {
    it('formats correctly with data', () => {
      const data = digest.analyze(
        {
          runs: [],
          tests: {
            'test-flaky': [
              createEntry({ passed: true, timestamp: timestamp(14) }),
              createEntry({ passed: true, timestamp: timestamp(12) }),
              createEntry({ passed: false, timestamp: timestamp(5) }),
              createEntry({ passed: true, timestamp: timestamp(4) }),
              createEntry({ passed: false, timestamp: timestamp(3) }),
            ],
          },
          summaries: [
            createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 85 }),
            createSummary({ runId: 'r2', timestamp: timestamp(1), passRate: 95 }),
          ],
        },
        createOptions(),
      );

      const md = digest.generateMarkdown(data);

      expect(md).toContain('# Test Health Digest');
      expect(md).toContain('## Summary');
      expect(md).toContain('## New Flaky Tests');
      expect(md).toContain('`test-flaky`');
    });

    it('handles empty sections', () => {
      const data = digest.analyze(
        {
          runs: [],
          tests: {},
          summaries: [
            createSummary({ runId: 'r1', timestamp: timestamp(3), passRate: 95 }),
          ],
        },
        createOptions(),
      );

      const md = digest.generateMarkdown(data);

      expect(md).toContain('# Test Health Digest');
      expect(md).toContain('None');
    });
  });

  describe('generateText()', () => {
    it('produces plain text without markdown markers', () => {
      const data = digest.analyze(
        {
          runs: [],
          tests: {
            'test-flaky': [
              createEntry({ passed: true, timestamp: timestamp(14) }),
              createEntry({ passed: false, timestamp: timestamp(5) }),
              createEntry({ passed: true, timestamp: timestamp(4) }),
              createEntry({ passed: false, timestamp: timestamp(3) }),
            ],
          },
          summaries: [
            createSummary({ runId: 'r1', timestamp: timestamp(6), passRate: 85 }),
            createSummary({ runId: 'r2', timestamp: timestamp(1), passRate: 95 }),
          ],
        },
        createOptions(),
      );

      const text = digest.generateText(data);

      expect(text).not.toContain('#');
      expect(text).not.toContain('`');
      expect(text).toContain('Test Health Digest');
      expect(text).toContain('test-flaky');
    });
  });
});
