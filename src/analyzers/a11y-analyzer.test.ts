import { describe, it, expect } from 'vitest';
import { summarizeA11y } from './a11y-analyzer';
import { buildReportData } from '../report-data/builder';
import type { TestResultData, A11yResult, A11yViolation } from '../types';

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

function createA11yResult(violations: A11yViolation[] = [], url?: string): A11yResult {
  return {
    violations,
    passes: 10,
    incomplete: 0,
    inapplicable: 5,
    timestamp: '2026-03-06T12:00:00Z',
    standard: 'WCAG2AA',
    url,
  };
}

function createViolation(overrides: Partial<A11yViolation> = {}): A11yViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    description: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast',
    wcagTags: ['wcag2aa', 'wcag143'],
    nodes: [{ target: ['#main'], html: '<div id="main">', failureSummary: 'Fix color contrast' }],
    ...overrides,
  };
}

const node = (target: string) => ({ target: [target], html: `<${target}>`, failureSummary: '' });

describe('summarizeA11y', () => {
  it('returns undefined when no test was scanned', () => {
    expect(summarizeA11y([createTestResult(), createTestResult({ testId: 'test-2' })])).toBeUndefined();
  });

  it('reports a clean suite as excellent', () => {
    const summary = summarizeA11y([
      createTestResult({ a11y: createA11yResult([], 'https://a.test/') }),
      createTestResult({ testId: 'test-2', a11y: createA11yResult([], 'https://a.test/') }),
    ]);

    expect(summary).toEqual({
      testsScanned: 2,
      testsWithViolations: 0,
      pagesScanned: 1,
      totalViolations: 0,
      byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      byRule: [],
      rating: 'excellent',
    });
  });

  it('totals violations by impact and counts distinct pages', () => {
    const summary = summarizeA11y([
      createTestResult({
        a11y: createA11yResult([
          createViolation({ id: 'v1', impact: 'critical' }),
          createViolation({ id: 'v2', impact: 'serious' }),
        ], 'https://a.test/'),
      }),
      createTestResult({
        testId: 'test-2',
        a11y: createA11yResult([
          createViolation({ id: 'v3', impact: 'moderate' }),
          createViolation({ id: 'v4', impact: 'minor' }),
        ], 'https://a.test/login'),
      }),
      createTestResult({ testId: 'test-3' }),
    ])!;

    expect(summary.byImpact).toEqual({ critical: 1, serious: 1, moderate: 1, minor: 1 });
    expect(summary.totalViolations).toBe(4);
    expect(summary.testsWithViolations).toBe(2);
    expect(summary.testsScanned).toBe(2);
    expect(summary.pagesScanned).toBe(2);
  });

  it.each([
    ['minor', 'good'],
    ['moderate', 'fair'],
    ['serious', 'fair'],
    ['critical', 'poor'],
  ] as const)('rates a suite whose worst violation is %s as %s', (impact, rating) => {
    const summary = summarizeA11y([
      createTestResult({ a11y: createA11yResult([createViolation({ id: 'minor-1', impact: 'minor' }), createViolation({ id: 'x', impact })]) }),
    ]);
    expect(summary!.rating).toBe(rating);
  });

  it('groups each rule across tests, most-hit first', () => {
    const summary = summarizeA11y([
      createTestResult({
        testId: 'home',
        a11y: createA11yResult([
          createViolation({ id: 'image-alt', impact: 'critical', nodes: [node('img.logo')] }),
          createViolation({ id: 'color-contrast', nodes: [node('p'), node('.btn')] }),
        ]),
      }),
      createTestResult({
        testId: 'login',
        a11y: createA11yResult([
          createViolation({ id: 'color-contrast', nodes: [node('label')] }),
          createViolation({ id: 'label', impact: 'critical', nodes: [node('input')] }),
        ]),
      }),
    ])!;

    expect(summary.byRule).toEqual([
      {
        id: 'color-contrast',
        impact: 'serious',
        description: 'Elements must have sufficient color contrast',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast',
        wcagTags: ['wcag2aa', 'wcag143'],
        tests: 2,
        nodes: 3,
        testIds: ['home', 'login'],
      },
      expect.objectContaining({ id: 'image-alt', tests: 1, nodes: 1, testIds: ['home'] }),
      expect.objectContaining({ id: 'label', tests: 1, nodes: 1, testIds: ['login'] }),
    ]);
  });
});

describe('buildReportData accessibility', () => {
  it('carries per-test results and the run summary', () => {
    const scanned = createTestResult({
      testId: 'home',
      a11y: createA11yResult([createViolation({ id: 'image-alt', impact: 'critical' })], 'https://a.test/'),
    });
    const data = buildReportData({
      results: [scanned, createTestResult({ testId: 'plain' })],
      history: { runs: [], tests: {}, summaries: [] },
      startTime: 1_000,
      options: {},
    }, 2_000);

    expect(data.tests.find(t => t.testId === 'home')!.a11y).toEqual(scanned.a11y);
    expect(data.tests.find(t => t.testId === 'plain')!.a11y).toBeUndefined();
    expect(data.a11y).toEqual({
      testsScanned: 1,
      testsWithViolations: 1,
      pagesScanned: 1,
      totalViolations: 1,
      byImpact: { critical: 1, serious: 0, moderate: 0, minor: 0 },
      byRule: [expect.objectContaining({ id: 'image-alt', tests: 1, nodes: 1, testIds: ['home'] })],
      rating: 'poor',
    });
  });

  it('omits the run summary when nothing was scanned', () => {
    const data = buildReportData({
      results: [createTestResult()],
      history: { runs: [], tests: {}, summaries: [] },
      startTime: 1_000,
      options: {},
    }, 2_000);
    expect(data.a11y).toBeUndefined();
  });
});
