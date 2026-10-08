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

  it('identifies new tests', () => {
    const currentTests = [createMinimalTestResult({ testId: 'new-test' })];
    const currentSummary = createRunSummary();
    const baselineSummary = createRunSummary();
    const baselineTests = new Map<string, TestResultData>();

    const comparison = buildComparison(currentTests, currentSummary, baselineSummary, baselineTests);

    expect(comparison.changes.newTests).toHaveLength(1);
    expect(comparison.changes.newTests[0].testId).toBe('new-test');
  });
});
