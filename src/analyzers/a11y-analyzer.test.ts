import { describe, it, expect } from 'vitest';
import { A11yAnalyzer } from './a11y-analyzer';
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

function createA11yResult(violations: A11yViolation[] = []): A11yResult {
  return {
    violations,
    passes: 10,
    incomplete: 0,
    inapplicable: 5,
    timestamp: '2026-03-06T12:00:00Z',
    standard: 'WCAG2AA',
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

describe('A11yAnalyzer', () => {
  const analyzer = new A11yAnalyzer();

  describe('analyze', () => {
    it('does nothing when a11y result is undefined', () => {
      const test = createTestResult();
      analyzer.analyze(test, undefined);
      expect(test.accessibility).toBeUndefined();
    });

    it('attaches a11y result to test data', () => {
      const test = createTestResult();
      const a11y = createA11yResult();
      analyzer.analyze(test, a11y);
      expect(test.accessibility).toBe(a11y);
    });

    it('attaches result with violations', () => {
      const test = createTestResult();
      const violations = [createViolation({ id: 'color-contrast', impact: 'serious' })];
      const a11y = createA11yResult(violations);
      analyzer.analyze(test, a11y);
      expect(test.accessibility).toBe(a11y);
      expect(test.accessibility!.violations).toHaveLength(1);
      expect(test.accessibility!.violations[0].id).toBe('color-contrast');
    });
  });

  describe('calculateSuiteScore', () => {
    it('returns score with zero violations for clean suite', () => {
      const tests = [
        createTestResult({ accessibility: createA11yResult() }),
        createTestResult({ testId: 'test-2', accessibility: createA11yResult() }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.totalViolations).toBe(0);
      expect(score.critical).toBe(0);
      expect(score.serious).toBe(0);
      expect(score.moderate).toBe(0);
      expect(score.minor).toBe(0);
      expect(score.testsWithViolations).toBe(0);
      expect(score.testsScanned).toBe(2);
      expect(score.rating).toBe('excellent');
      expect(score.topViolationIds).toEqual([]);
    });

    it('counts violations by severity correctly', () => {
      const tests = [
        createTestResult({
          accessibility: createA11yResult([
            createViolation({ id: 'v1', impact: 'critical' }),
            createViolation({ id: 'v2', impact: 'serious' }),
          ]),
        }),
        createTestResult({
          testId: 'test-2',
          accessibility: createA11yResult([
            createViolation({ id: 'v3', impact: 'moderate' }),
            createViolation({ id: 'v4', impact: 'minor' }),
          ]),
        }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.critical).toBe(1);
      expect(score.serious).toBe(1);
      expect(score.moderate).toBe(1);
      expect(score.minor).toBe(1);
      expect(score.totalViolations).toBe(4);
      expect(score.testsWithViolations).toBe(2);
      expect(score.testsScanned).toBe(2);
    });

    it('rates as good when only minor violations exist', () => {
      const tests = [
        createTestResult({
          accessibility: createA11yResult([
            createViolation({ id: 'minor-1', impact: 'minor' }),
            createViolation({ id: 'minor-2', impact: 'minor' }),
          ]),
        }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.rating).toBe('good');
    });

    it('rates as fair when moderate violations exist', () => {
      const tests = [
        createTestResult({
          accessibility: createA11yResult([
            createViolation({ id: 'mod-1', impact: 'moderate' }),
          ]),
        }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.rating).toBe('fair');
    });

    it('rates as poor when critical violations exist', () => {
      const tests = [
        createTestResult({
          accessibility: createA11yResult([
            createViolation({ id: 'crit-1', impact: 'critical' }),
          ]),
        }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.rating).toBe('poor');
    });

    it('skips tests without a11y data', () => {
      const tests = [
        createTestResult({ accessibility: createA11yResult() }),
        createTestResult({ testId: 'test-2' }), // no a11y data
        createTestResult({ testId: 'test-3' }), // no a11y data
      ];

      const score = analyzer.calculateSuiteScore(tests);

      expect(score.testsScanned).toBe(1);
      expect(score.testsWithViolations).toBe(0);
    });

    it('identifies top violation IDs sorted by frequency', () => {
      const tests = [
        createTestResult({
          accessibility: createA11yResult([
            createViolation({ id: 'color-contrast' }),
            createViolation({ id: 'image-alt' }),
            createViolation({ id: 'color-contrast' }),
          ]),
        }),
        createTestResult({
          testId: 'test-2',
          accessibility: createA11yResult([
            createViolation({ id: 'color-contrast' }),
            createViolation({ id: 'label' }),
            createViolation({ id: 'image-alt' }),
            createViolation({ id: 'label' }),
            createViolation({ id: 'heading-order' }),
            createViolation({ id: 'link-name' }),
          ]),
        }),
      ];

      const score = analyzer.calculateSuiteScore(tests);

      // color-contrast: 3, image-alt: 2, label: 2, heading-order: 1, link-name: 1
      expect(score.topViolationIds[0]).toBe('color-contrast');
      expect(score.topViolationIds).toHaveLength(5);
      expect(score.topViolationIds).toContain('image-alt');
      expect(score.topViolationIds).toContain('label');
      expect(score.topViolationIds).toContain('heading-order');
      expect(score.topViolationIds).toContain('link-name');
    });
  });
});
