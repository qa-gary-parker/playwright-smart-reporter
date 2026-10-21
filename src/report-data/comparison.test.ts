import { describe, it, expect } from 'vitest';
import type { RunSummary, TestResultData } from '../types';
import { buildComparison } from './comparison';

const createMinimalTestResult = (overrides: Partial<TestResultData> = {}): TestResultData => ({
  testId: 'test-1',
  title: 'Test One',
  file: 'tests/example.spec.ts',
  status: 'passed',
  duration: 1000,
  retry: 0,
  steps: [],
  history: [],
  ...overrides,
});

const createRunSummary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  runId: 'run-1',
  timestamp: new Date().toISOString(),
  total: 10,
  passed: 8,
  failed: 2,
  skipped: 0,
  flaky: 1,
  slow: 1,
  duration: 5000,
  passRate: 80,
  ...overrides,
});

describe('buildComparison', () => {
  it('builds comparison from test results', () => {
    const currentTests = [
      createMinimalTestResult({ testId: '1', status: 'passed' }),
      createMinimalTestResult({ testId: '2', status: 'failed' }),
      createMinimalTestResult({ testId: '3', status: 'passed', duration: 2000 }),
    ];
    const currentSummary = createRunSummary();
    const baselineSummary = createRunSummary();
    const baselineTests = new Map<string, TestResultData>([
      ['1', createMinimalTestResult({ testId: '1', status: 'failed' })],
      ['2', createMinimalTestResult({ testId: '2', status: 'passed' })],
      ['3', createMinimalTestResult({ testId: '3', status: 'passed', duration: 1000 })],
    ]);

    const comparison = buildComparison(currentTests, currentSummary, baselineSummary, baselineTests);

    expect(comparison.changes.fixedTests).toHaveLength(1);
    expect(comparison.changes.fixedTests[0].testId).toBe('1');
    expect(comparison.changes.newFailures).toHaveLength(1);
    expect(comparison.changes.newFailures[0].testId).toBe('2');
    expect(comparison.changes.regressions).toHaveLength(1);
    expect(comparison.changes.regressions[0].testId).toBe('3');
  });

  it('needs a passed test to be both 20% and 250ms slower or faster than the baseline', () => {
    const current = [
      createMinimalTestResult({ testId: 'jitter', duration: 155 }),
      createMinimalTestResult({ testId: 'slower', duration: 1300 }),
      createMinimalTestResult({ testId: 'faster', duration: 700 }),
      createMinimalTestResult({ testId: 'small-gain', duration: 300 }),
    ];
    const baseline = new Map<string, TestResultData>([
      ['jitter', createMinimalTestResult({ testId: 'jitter', duration: 95 })],
      ['slower', createMinimalTestResult({ testId: 'slower', duration: 1000 })],
      ['faster', createMinimalTestResult({ testId: 'faster', duration: 1000 })],
      ['small-gain', createMinimalTestResult({ testId: 'small-gain', duration: 500 })],
    ]);

    const { changes } = buildComparison(current, createRunSummary(), createRunSummary(), baseline);

    expect(changes.regressions.map((t) => t.testId)).toEqual(['slower']);
    expect(changes.improvements.map((t) => t.testId)).toEqual(['faster']);
  });

  it('uses the configured performance threshold instead of a fixed 20%', () => {
    const current = [createMinimalTestResult({ testId: 'a', duration: 1300 })];
    const baseline = new Map<string, TestResultData>([['a', createMinimalTestResult({ testId: 'a', duration: 1000 })]]);
    expect(buildComparison(current, createRunSummary(), createRunSummary(), baseline, 0.5).changes.regressions).toEqual([]);
    expect(buildComparison(current, createRunSummary(), createRunSummary(), baseline, 0.1).changes.regressions.map((t) => t.testId)).toEqual(['a']);
  });

  it('identifies new tests', () => {
    const currentTests = [createMinimalTestResult({ testId: 'new-test' })];
    const currentSummary = createRunSummary();
    const baselineSummary = createRunSummary();
    const baselineTests = new Map<string, TestResultData>();

    const comparison = buildComparison(currentTests, currentSummary, baselineSummary, baselineTests);

    expect(comparison.changes.newTests).toHaveLength(1);
    expect(comparison.changes.newTests[0].testId).toBe('new-test');
  });

  it('puts a test with history that did not run in the baseline run in notInBaseline, not in newTests', () => {
    const currentTests = [
      createMinimalTestResult({ testId: 'ran-before', status: 'passed' }),
      createMinimalTestResult({ testId: 'never-ran', status: 'passed' }),
    ];
    const withHistory = new Set(['ran-before']);

    const { changes } = buildComparison(currentTests, createRunSummary(), createRunSummary(), new Map(), 0.2, withHistory);

    expect(changes.notInBaseline.map((t) => t.testId)).toEqual(['ran-before']);
    expect(changes.newTests.map((t) => t.testId)).toEqual(['never-ran']);
    expect(changes.fixedTests).toEqual([]);
  });
});
