import { describe, it, expect } from 'vitest';
import { generateTestA11ySection, generateA11yTab, generateA11yStyles, generateA11yScript } from './a11y-generator';
import type { TestResultData, A11ySuiteScore, A11yViolation } from '../types';

const makeViolation = (overrides: Partial<A11yViolation> = {}): A11yViolation => ({
  id: 'color-contrast',
  impact: 'serious',
  description: 'Elements must have sufficient color contrast',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast',
  wcagTags: ['wcag2aa'],
  nodes: [
    { target: ['.btn'], html: '<button class="btn">Click</button>', failureSummary: 'Fix contrast ratio' },
  ],
  ...overrides,
});

const makeTest = (overrides: Partial<TestResultData> = {}): TestResultData => ({
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

const makeSuiteScore = (overrides: Partial<A11ySuiteScore> = {}): A11ySuiteScore => ({
  totalViolations: 5,
  critical: 1,
  serious: 2,
  moderate: 1,
  minor: 1,
  testsWithViolations: 3,
  testsScanned: 10,
  rating: 'fair',
  topViolationIds: ['color-contrast', 'image-alt'],
  ...overrides,
});

describe('generateTestA11ySection', () => {
  it('returns empty string when no accessibility data', () => {
    const test = makeTest();
    expect(generateTestA11ySection(test)).toBe('');
  });

  it('returns empty string when no violations', () => {
    const test = makeTest({
      accessibility: {
        violations: [],
        passes: 10,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
      },
    });
    expect(generateTestA11ySection(test)).toBe('');
  });

  it('renders violation list with impact badges for community tier', () => {
    const test = makeTest({
      accessibility: {
        violations: [makeViolation()],
        passes: 5,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
      },
    });
    const html = generateTestA11ySection(test, 'community');
    expect(html).toContain('Accessibility');
    expect(html).toContain('a11y-impact-badge');
    expect(html).toContain('serious');
    expect(html).toContain('color-contrast');
    expect(html).not.toContain('a11y-node-target');
    expect(html).not.toContain('a11y-tree-section');
  });

  it('renders node details and help links for starter tier', () => {
    const test = makeTest({
      accessibility: {
        violations: [makeViolation()],
        passes: 5,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
      },
    });
    const html = generateTestA11ySection(test, 'starter');
    expect(html).toContain('a11y-node-target');
    expect(html).toContain('.btn');
    expect(html).toContain('Fix contrast ratio');
    expect(html).toContain('Docs');
    expect(html).toContain('dequeuniversity.com');
  });

  it('renders a11y tree viewer for starter tier when tree is present', () => {
    const test = makeTest({
      accessibility: {
        violations: [makeViolation()],
        passes: 5,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
        tree: { role: 'document', name: 'Test Page', children: [{ role: 'button', name: 'Submit' }] },
      },
    });
    const html = generateTestA11ySection(test, 'pro');
    expect(html).toContain('Accessibility Tree');
    expect(html).toContain('a11y-tree-role');
    expect(html).toContain('document');
    expect(html).toContain('button');
    expect(html).toContain('Submit');
  });

  it('shows violation count badge', () => {
    const test = makeTest({
      accessibility: {
        violations: [makeViolation(), makeViolation({ id: 'image-alt', impact: 'critical' })],
        passes: 5,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
      },
    });
    const html = generateTestA11ySection(test);
    expect(html).toContain('a11y-count-badge');
    expect(html).toContain('>2<');
  });
});

describe('generateA11yTab', () => {
  it('renders summary cards with suite score', () => {
    const score = makeSuiteScore();
    const html = generateA11yTab([], score);
    expect(html).toContain('Accessibility');
    expect(html).toContain('Fair');
    expect(html).toContain('5');
    expect(html).toContain('10');
    expect(html).toContain('3');
  });

  it('renders severity breakdown bar', () => {
    const score = makeSuiteScore();
    const html = generateA11yTab([], score);
    expect(html).toContain('Severity Breakdown');
    expect(html).toContain('a11y-severity-bar');
    expect(html).toContain('Critical: 1');
    expect(html).toContain('Serious: 2');
  });

  it('renders most common issues from test results', () => {
    const tests = [
      makeTest({
        accessibility: {
          violations: [makeViolation(), makeViolation({ id: 'image-alt', impact: 'critical' })],
          passes: 5, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
      makeTest({
        testId: 'test-2',
        accessibility: {
          violations: [makeViolation()],
          passes: 3, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
    ];
    const score = makeSuiteScore();
    const html = generateA11yTab(tests, score);
    expect(html).toContain('Top Issues');
    expect(html).toContain('color-contrast');
    expect(html).toContain('image-alt');
  });

  it('renders worst offenders sorted by violation count', () => {
    const tests = [
      makeTest({
        testId: 'test-1',
        title: 'Login Page',
        accessibility: {
          violations: [makeViolation(), makeViolation({ id: 'image-alt' })],
          passes: 5, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
      makeTest({
        testId: 'test-2',
        title: 'Home Page',
        accessibility: {
          violations: [makeViolation()],
          passes: 3, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
    ];
    const score = makeSuiteScore();
    const html = generateA11yTab(tests, score);
    expect(html).toContain('Worst Offenders');
    expect(html).toContain('Login Page');
    expect(html).toContain('2 violations');
  });

  it('renders AI analysis section when summary provided', () => {
    const score = makeSuiteScore();
    const html = generateA11yTab([], score, 'Your suite has critical contrast issues.');
    expect(html).toContain('AI Accessibility Analysis');
    expect(html).toContain('critical contrast issues');
    expect(html).toContain('a11y-ai-card');
  });

  it('does not render AI section when no summary', () => {
    const score = makeSuiteScore();
    const html = generateA11yTab([], score);
    expect(html).not.toContain('a11y-ai-card');
  });

  it('renders collapsible issue details with node info', () => {
    const tests = [
      makeTest({
        accessibility: {
          violations: [makeViolation()],
          passes: 5, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
    ];
    const html = generateA11yTab(tests, makeSuiteScore());
    expect(html).toContain('a11y-collapsible');
    expect(html).toContain('a11y-detail-body');
    expect(html).toContain('a11y-node-target');
    expect(html).toContain('.btn');
  });

  it('renders WCAG criterion links for known tags', () => {
    const tests = [
      makeTest({
        accessibility: {
          violations: [makeViolation({ wcagTags: ['wcag143'] })],
          passes: 5, incomplete: 0, inapplicable: 0,
          timestamp: new Date().toISOString(), standard: 'wcag2aa',
        },
      }),
    ];
    const html = generateA11yTab(tests, makeSuiteScore());
    expect(html).toContain('WCAG 1.4.3');
    expect(html).toContain('w3.org/WAI/WCAG21');
  });

  it('handles empty results gracefully', () => {
    const score = makeSuiteScore({ totalViolations: 0, critical: 0, serious: 0, moderate: 0, minor: 0 });
    const html = generateA11yTab([], score);
    expect(html).toContain('Accessibility');
    expect(html).not.toContain('Top Issues');
    expect(html).not.toContain('Worst Offenders');
  });
});

describe('generateA11yStyles', () => {
  it('returns CSS string with a11y classes', () => {
    const css = generateA11yStyles();
    expect(css).toContain('.a11y-impact-badge');
    expect(css).toContain('.a11y-summary-cards');
    expect(css).toContain('.a11y-severity-bar');
    expect(css).toContain('.a11y-tree-node');
  });
});

describe('generateA11yScript', () => {
  it('returns JavaScript with the toggle and copy-prompt handlers', () => {
    const js = generateA11yScript();
    expect(js).toContain('function toggleA11y(bodyId, chevronId)');
    expect(js).toContain('function copyA11yPrompt(btn)');
  });

  it('wires generated markup to the toggle handler', () => {
    const test = makeTest({
      accessibility: {
        violations: [makeViolation()],
        passes: 5,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: 'wcag2aa',
        tree: { role: 'document', name: 'Test Page' },
      },
    });
    const section = generateTestA11ySection(test, 'starter');
    expect(section).toContain(`toggleA11y('a11y-test_1-body', 'a11y-test_1-chevron')`);
    expect(section).toContain(`toggleA11y('a11y-test_1-v0-body', 'a11y-test_1-v0-chevron')`);
    expect(section).toContain(`toggleA11y('a11y-test_1-tree', 'a11y-test_1-tree-chevron')`);
  });
});
