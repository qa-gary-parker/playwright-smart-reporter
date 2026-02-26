/**
 * Smoke tests for generators
 * Verifies that generators don't crash with various inputs
 */

import { describe, it, expect } from 'vitest';
import { generateHtml, type HtmlGeneratorData } from './html-generator';
import { generateTestCard, generateTestDetails, generateGroupedTests, type AttentionSets } from './card-generator';
import { generateTrendChart, type ChartData } from './chart-generator';
import { generateGallery, generateGalleryScript } from './gallery-generator';
import { generateComparison, generateComparisonScript, buildComparison } from './comparison-generator';
import type { TestResultData, TestHistory, RunComparison, RunSummary } from '../types';

// Test fixtures
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

const createTestHistory = (): TestHistory => ({
  runs: [],
  tests: {},
  summaries: [],
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

describe('html-generator', () => {
  describe('generateHtml', () => {
    it('returns HTML string with minimal data', () => {
      const data: HtmlGeneratorData = {
        results: [],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(typeof html).toBe('string');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });

    it('handles single passed test', () => {
      const data: HtmlGeneratorData = {
        results: [createMinimalTestResult()],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).toContain('Test One');
      expect(html).toContain('passed');
    });

    it('handles mixed test results', () => {
      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({ testId: '1', status: 'passed' }),
          createMinimalTestResult({ testId: '2', status: 'failed', error: 'Test error' }),
          createMinimalTestResult({ testId: '3', status: 'skipped' }),
        ],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).toContain('passed');
      expect(html).toContain('failed');
      expect(html).toContain('skipped');
    });

    it('handles test with history entries', () => {
      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({
            history: [
              { passed: true, duration: 900, timestamp: '2024-01-01T00:00:00Z' },
              { passed: false, duration: 1100, timestamp: '2024-01-02T00:00:00Z' },
            ],
          }),
        ],
        history: {
          runs: [],
          tests: { 'test-1': [{ passed: true, duration: 900, timestamp: '2024-01-01T00:00:00Z' }] },
          summaries: [createRunSummary()],
        },
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).toContain('Test One');
    });

    it('handles flaky tests', () => {
      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({
            flakinessScore: 0.5,
            flakinessIndicator: 'Flaky',
          }),
        ],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).toContain('Flaky');
    });

    it('handles tests with screenshots', () => {
      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({
            status: 'failed',
            screenshot: 'data:image/png;base64,abc123',
          }),
        ],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).toContain('data:image/png;base64,abc123');
    });

    it('handles comparison data', () => {
      const comparison: RunComparison = {
        baselineRun: createRunSummary({ runId: 'baseline', passRate: 70 }),
        currentRun: createRunSummary({ runId: 'current', passRate: 80 }),
        changes: {
          newFailures: [],
          fixedTests: [],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      };

      const data: HtmlGeneratorData = {
        results: [createMinimalTestResult()],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
        comparison,
      };

      const { html } = generateHtml(data);

      expect(html).toContain('Test One');
    });

    it('escapes HTML in test titles', () => {
      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({
            title: '<script>alert("xss")</script>',
          }),
        ],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain('&lt;script&gt;');
    });

    // Issue #19: Large test suites should not crash with RangeError
    it('strips large base64 data from embedded JSON to prevent RangeError', () => {
      // Create a large base64 string (simulating a screenshot)
      const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(100000);

      const data: HtmlGeneratorData = {
        results: [
          createMinimalTestResult({
            screenshot: largeBase64,
            traceData: 'base64-trace-data-here',
            attachments: {
              screenshots: [largeBase64, largeBase64],
              videos: ['/path/to/video.webm'],
              traces: ['/path/to/trace.zip'],
              custom: [{ name: 'custom', contentType: 'text/plain', body: 'base64body' }],
            },
          }),
        ],
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      const { html } = generateHtml(data);

      // The HTML should be generated successfully
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');

      // Extract the JavaScript section that contains "const tests = "
      const jsMatch = html.match(/const tests = (\[[\s\S]*?\]);/);
      expect(jsMatch).toBeTruthy();
      const testsJson = jsMatch![1];

      // The embedded JSON should NOT contain the large base64 data
      expect(testsJson).not.toContain('AAAAAAAAAAAAAAAAA'); // Large base64 content
      expect(testsJson).toContain('[base64-screenshot]'); // Placeholder
      expect(testsJson).toContain('[base64-content]'); // Placeholder for custom attachment body

      // But file paths should be preserved in JSON
      expect(testsJson).toContain('/path/to/video.webm');
      expect(testsJson).toContain('/path/to/trace.zip');

      // Note: The full base64 may still appear in HTML cards for rendering
      // That's intentional - we only strip from JSON to reduce size
    });

    it('handles many tests without exceeding string limits', () => {
      // Create 100 tests with screenshots (simulating a medium-sized suite)
      const results = Array.from({ length: 100 }, (_, i) =>
        createMinimalTestResult({
          testId: `test-${i}`,
          title: `Test ${i}`,
          screenshot: 'data:image/png;base64,' + 'B'.repeat(10000),
        })
      );

      const data: HtmlGeneratorData = {
        results,
        history: createTestHistory(),
        startTime: Date.now(),
        options: {},
      };

      // Should not throw RangeError
      const { html } = generateHtml(data);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Test 0');
      expect(html).toContain('Test 99');

      // Extract the JavaScript section that contains "const tests = "
      const jsMatch = html.match(/const tests = (\[[\s\S]*?\]);/);
      expect(jsMatch).toBeTruthy();
      const testsJson = jsMatch![1];

      // Large base64 data should be stripped from embedded JSON
      expect(testsJson).not.toContain('BBBBBBBBBBBBBBBBB');
      // Should use placeholder instead
      expect(testsJson).toContain('[base64-screenshot]');
    });
  });
});

describe('CSP-safe mode', () => {
  it('returns GeneratedReport with css and js fields when cspSafe is true', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: { cspSafe: true },
      outputBasename: 'test-report',
    };

    const report = generateHtml(data);

    expect(report.html).toContain('<!DOCTYPE html>');
    expect(report.css).toBeDefined();
    expect(typeof report.css).toBe('string');
    expect(report.css!.length).toBeGreaterThan(0);
    expect(report.js).toBeDefined();
    expect(typeof report.js).toBe('string');
    expect(report.js!.length).toBeGreaterThan(0);
  });

  it('CSP-safe HTML uses external stylesheet link instead of inline style', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: { cspSafe: true, enableTraceViewer: false },
      outputBasename: 'test-report',
    };

    const { html } = generateHtml(data);

    expect(html).toContain('<link rel="stylesheet" href="test-report.css">');
    expect(html).not.toMatch(/<style>[^<]/);
  });

  it('CSP-safe HTML uses external script src instead of inline script', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: { cspSafe: true },
      outputBasename: 'test-report',
    };

    const { html } = generateHtml(data);

    expect(html).toContain('<script src="test-report.js" defer></script>');
    expect(html).toContain('<script type="application/json" id="report-data-tests">');
    expect(html).toContain('<script type="application/json" id="report-data-stats">');
  });

  it('CSP-safe JS reads data from DOM JSON tags and does not contain inline data', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: { cspSafe: true },
      outputBasename: 'test-report',
    };

    const report = generateHtml(data);

    expect(report.js).toContain("document.getElementById('report-data-tests')");
    expect(report.js).toContain("document.getElementById('report-data-stats')");
    // Verify inline data declarations were stripped (not just prepended)
    expect(report.js).not.toMatch(/const tests = \[/);
  });

  it('non-CSP mode returns undefined css and js', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: {},
    };

    const report = generateHtml(data);

    expect(report.html).toContain('<!DOCTYPE html>');
    expect(report.css).toBeUndefined();
    expect(report.js).toBeUndefined();
  });

  it('CSP-safe mode strips base64 data from embedded JSON', () => {
    const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(50000);
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult({ screenshot: largeBase64 })],
      history: createTestHistory(),
      startTime: Date.now(),
      options: { cspSafe: true },
      outputBasename: 'test-report',
    };

    const report = generateHtml(data);

    // Extract the JSON script tag content — should use placeholder, not large base64
    const jsonMatch = report.html.match(/<script type="application\/json" id="report-data-tests">([\s\S]*?)<\/script>/);
    expect(jsonMatch).toBeTruthy();
    expect(jsonMatch![1]).toContain('[base64-screenshot]');
    expect(jsonMatch![1]).not.toContain('AAAAAAAAAAAAAAAAA');
  });

  it('non-CSP mode has inline style and script tags', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult()],
      history: createTestHistory(),
      startTime: Date.now(),
      options: {},
    };

    const { html } = generateHtml(data);

    expect(html).toContain('<style>');
    expect(html).not.toContain('<link rel="stylesheet"');
  });
});

describe('flaky filter', () => {
  it('marks test as flaky when outcome is flaky even without high flakinessScore', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult({ outcome: 'flaky', flakinessScore: 0.1 })],
      history: createTestHistory(),
      startTime: Date.now(),
      options: {},
    };

    const { html } = generateHtml(data);

    expect(html).toContain('data-flaky="true"');
  });

  it('marks test as flaky when flakinessScore is high even without flaky outcome', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult({ flakinessScore: 0.5 })],
      history: createTestHistory(),
      startTime: Date.now(),
      options: {},
    };

    const { html } = generateHtml(data);

    expect(html).toContain('data-flaky="true"');
  });

  it('does not mark test as flaky when neither outcome nor score qualifies', () => {
    const data: HtmlGeneratorData = {
      results: [createMinimalTestResult({ flakinessScore: 0.1, outcome: 'expected' })],
      history: createTestHistory(),
      startTime: Date.now(),
      options: {},
    };

    const { html } = generateHtml(data);

    expect(html).toContain('data-flaky="false"');
  });
});

describe('card-generator', () => {
  describe('generateTestCard', () => {
    it('generates card for passed test', () => {
      const test = createMinimalTestResult();
      const card = generateTestCard(test, false);

      expect(card).toContain('test-card');
      expect(card).toContain('Test One');
      expect(card).toContain('passed');
    });

    it('generates card for failed test with error', () => {
      const test = createMinimalTestResult({
        status: 'failed',
        error: 'Expected true but got false',
      });
      const card = generateTestCard(test, false);

      expect(card).toContain('failed');
      expect(card).toContain('expand-icon');
    });

    it('handles test with stability score', () => {
      const test = createMinimalTestResult({
        stabilityScore: {
          overall: 85,
          flakiness: 90,
          performance: 80,
          reliability: 85,
          grade: 'B',
          needsAttention: false,
        },
      });
      const card = generateTestCard(test, false);

      expect(card).toContain('stability');
      expect(card).toContain('B');
    });

    it('handles test with performance trend', () => {
      const test = createMinimalTestResult({
        performanceTrend: '↑ 25% slower',
      });
      const card = generateTestCard(test, false);

      expect(card).toContain('slower');
    });
  });

  describe('generateTestDetails', () => {
    it('generates details with steps', () => {
      const test = createMinimalTestResult({
        steps: [
          { title: 'Click button', duration: 100, category: 'action' },
          { title: 'Wait for element', duration: 500, category: 'wait', isSlowest: true },
        ],
      });
      const details = generateTestDetails(test, 'card-1', false);

      expect(details).toContain('Click button');
      expect(details).toContain('Wait for element');
      expect(details).toContain('Slowest');
    });

    it('generates details with error', () => {
      const test = createMinimalTestResult({
        status: 'failed',
        error: 'Element not found: button.submit',
      });
      const details = generateTestDetails(test, 'card-1', false);

      expect(details).toContain('Error');
      expect(details).toContain('Element not found');
    });

    it('generates details with AI suggestion', () => {
      const test = createMinimalTestResult({
        aiSuggestion: 'Try adding a wait before clicking',
      });
      const details = generateTestDetails(test, 'card-1', false);

      expect(details).toContain('AI Suggestion');
      expect(details).toContain('wait before clicking');
    });

    it('generates history section when history exists', () => {
      const test = createMinimalTestResult({
        history: [
          { passed: true, duration: 900, timestamp: '2024-01-01T00:00:00Z' },
          { passed: false, duration: 1100, timestamp: '2024-01-02T00:00:00Z' },
        ],
      });
      const details = generateTestDetails(test, 'card-1', false);

      expect(details).toContain('Run History');
      expect(details).toContain('Pass rate');
    });
  });

  describe('generateGroupedTests', () => {
    it('groups tests by file', () => {
      const results = [
        createMinimalTestResult({ testId: '1', file: 'tests/auth.spec.ts' }),
        createMinimalTestResult({ testId: '2', file: 'tests/auth.spec.ts' }),
        createMinimalTestResult({ testId: '3', file: 'tests/home.spec.ts' }),
      ];
      const attention: AttentionSets = { newFailures: new Set(), regressions: new Set(), fixed: new Set() };
      const grouped = generateGroupedTests(results, false, attention);

      expect(grouped).toContain('auth.spec.ts');
      expect(grouped).toContain('home.spec.ts');
      expect(grouped).toContain('file-group');
    });

    it('handles attention states', () => {
      const results = [createMinimalTestResult({ testId: 'test-1' })];
      const attention: AttentionSets = {
        newFailures: new Set(['test-1']),
        regressions: new Set(),
        fixed: new Set(),
      };
      const grouped = generateGroupedTests(results, false, attention);

      expect(grouped).toContain('new-failure');
    });
  });
});

describe('chart-generator', () => {
  describe('generateTrendChart', () => {
    it('returns message when no history', () => {
      const data: ChartData = {
        results: [createMinimalTestResult()],
        history: createTestHistory(),
        startTime: Date.now(),
      };
      const chart = generateTrendChart(data);

      expect(chart).toContain('Trends will appear');
    });

    it('generates chart with history data', () => {
      const data: ChartData = {
        results: [createMinimalTestResult()],
        history: {
          runs: [],
          tests: {},
          summaries: [
            createRunSummary({ runId: 'run-1', passRate: 80 }),
            createRunSummary({ runId: 'run-2', passRate: 90 }),
          ],
        },
        startTime: Date.now(),
      };
      const chart = generateTrendChart(data);

      expect(chart).toContain('trend-section');
      expect(chart).toContain('Pass Rate');
      expect(chart).toContain('Duration');
    });
  });
});

describe('gallery-generator', () => {
  describe('generateGallery', () => {
    it('returns empty string when no attachments', () => {
      const results = [createMinimalTestResult()];
      const gallery = generateGallery(results);

      expect(gallery).toBe('');
    });

    it('generates gallery with screenshots', () => {
      const results = [
        createMinimalTestResult({
          screenshot: 'data:image/png;base64,abc123',
        }),
      ];
      const gallery = generateGallery(results);

      expect(gallery).toContain('gallery');
      expect(gallery).toContain('Screenshots');
    });

    it('generates gallery with attachments object', () => {
      const results = [
        createMinimalTestResult({
          attachments: {
            screenshots: ['data:image/png;base64,abc'],
            videos: ['/path/to/video.webm'],
            traces: ['/path/to/trace.zip'],
            custom: [],
          },
        }),
      ];
      const gallery = generateGallery(results);

      expect(gallery).toContain('Screenshots');
      expect(gallery).toContain('Videos');
      expect(gallery).toContain('Traces');
    });
  });

  describe('generateGalleryScript', () => {
    it('returns JavaScript code', () => {
      const script = generateGalleryScript();

      expect(script).toContain('function filterGallery');
      expect(script).toContain('function openLightbox');
      expect(script).toContain('function closeLightbox');
    });
  });
});

describe('comparison-generator', () => {
  describe('generateComparison', () => {
    it('generates comparison view', () => {
      const comparison: RunComparison = {
        baselineRun: createRunSummary({ passRate: 70, duration: 5000 }),
        currentRun: createRunSummary({ passRate: 80, duration: 4000 }),
        changes: {
          newFailures: [],
          fixedTests: [],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      };
      const html = generateComparison(comparison);

      expect(html).toContain('Run Comparison');
      expect(html).toContain('Pass Rate');
      expect(html).toContain('Duration');
    });

    it('shows new failures', () => {
      const comparison: RunComparison = {
        baselineRun: createRunSummary(),
        currentRun: createRunSummary(),
        changes: {
          newFailures: [createMinimalTestResult({ status: 'failed', error: 'Oops' })],
          fixedTests: [],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      };
      const html = generateComparison(comparison);

      expect(html).toContain('New Failures');
    });

    it('shows fixed tests', () => {
      const comparison: RunComparison = {
        baselineRun: createRunSummary(),
        currentRun: createRunSummary(),
        changes: {
          newFailures: [],
          fixedTests: [createMinimalTestResult()],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      };
      const html = generateComparison(comparison);

      expect(html).toContain('Fixed Tests');
    });
  });

  describe('generateComparisonScript', () => {
    it('returns JavaScript code', () => {
      const script = generateComparisonScript();

      expect(script).toContain('toggleComparisonSection');
    });
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
});
