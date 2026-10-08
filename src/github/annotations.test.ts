import { describe, it, expect } from 'vitest';
import { buildAnnotations, failureLocation, formatAnnotation } from './annotations';
import type { JsonExportData, JsonTestEntry } from '../generators/json-exporter';

const WORKSPACE = '/home/runner/work/shop/shop';
const ROOT = `${WORKSPACE}/e2e/tests`;
const SPEC = `${ROOT}/cart.spec.ts`;

// Error strings below are real Playwright 1.57 output (ANSI stripped) with the checkout path swapped for WORKSPACE.
const EXPECT_MESSAGE = 'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 2\nReceived: 1';

function failing(overrides: Partial<JsonTestEntry>): JsonTestEntry {
  return { testId: 't', title: 'adds to cart', file: 'cart.spec.ts', line: 9, column: 5, status: 'failed', outcome: 'unexpected', retry: 0, duration: 100, ...overrides };
}

describe('failureLocation', () => {
  it.each([
    {
      shape: 'anonymous spec frame',
      error: `${EXPECT_MESSAGE}\n    at ${SPEC}:6:17`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 6, column: 17 },
    },
    {
      shape: 'helper frame first, spec frame second',
      error: `Error: cart total\n\n${EXPECT_MESSAGE}\n    at expectTotal (${ROOT}/helpers/assert.ts:3:32)\n    at ${SPEC}:10:14`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 10, column: 14 },
    },
    {
      shape: 'named function frame inside the spec',
      error: `Error: boom from a named function\n    at explode (${SPEC}:20:9)\n    at ${SPEC}:24:3`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 20, column: 9 },
    },
    {
      shape: 'async named frame',
      error: `${EXPECT_MESSAGE}\n    at async Context.<anonymous> (${SPEC}:15:25)`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 15, column: 25 },
    },
    {
      shape: 'ESM file:// URL frame after a node internal frame',
      error: `${EXPECT_MESSAGE}\n    at node:internal/process/task_queues:95:5\n    at file://${SPEC}:6:17`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 6, column: 17 },
    },
    {
      shape: 'no spec frame (only a helper frame)',
      error: `${EXPECT_MESSAGE}\n    at expectTotal (${ROOT}/helpers/assert.ts:3:32)`,
      expected: { file: 'e2e/tests/cart.spec.ts', line: 9, column: 5 },
    },
    {
      shape: 'no stack at all (timeout)',
      error: 'Test timeout of 30000ms exceeded.',
      expected: { file: 'e2e/tests/cart.spec.ts', line: 9, column: 5 },
    },
  ])('$shape', ({ error, expected }) => {
    expect(failureLocation(failing({ error }), ROOT, WORKSPACE)).toEqual(expected);
  });

  it("prefers Playwright's recorded error location over the stack", () => {
    const t = failing({
      error: `${EXPECT_MESSAGE}\n    at ${SPEC}:10:14`,
      errorLocation: { file: 'helpers/assert.ts', line: 3, column: 32 },
    });
    expect(failureLocation(t, ROOT, WORKSPACE)).toEqual({ file: 'e2e/tests/helpers/assert.ts', line: 3, column: 32 });
  });

  it('parses frames whose path contains parentheses', () => {
    const ws = '/w/shop (copy)';
    const t = failing({ error: `${EXPECT_MESSAGE}\n    at Object.<anonymous> (${ws}/e2e/tests/cart.spec.ts:6:17)` });
    expect(failureLocation(t, `${ws}/e2e/tests`, ws)).toEqual({ file: 'e2e/tests/cart.spec.ts', line: 6, column: 17 });
  });

  it('keeps the root-relative path when the export has no rootDir', () => {
    expect(failureLocation(failing({ error: 'Test timeout of 30000ms exceeded.' }), undefined, WORKSPACE))
      .toEqual({ file: 'cart.spec.ts', line: 9, column: 5 });
  });
});

describe('formatAnnotation', () => {
  it('escapes workflow-command properties and data', () => {
    expect(formatAnnotation({ file: 'e2e/a,b.spec.ts', line: 6, column: 17 }, 'pays: 100% [Mobile, Chrome]', 'Expected: 2\nReceived: 1'))
      .toBe('::error file=e2e/a%2Cb.spec.ts,line=6,col=17,title=pays%3A 100%25 [Mobile%2C Chrome]::Expected: 2%0AReceived: 1');
  });
});

describe('buildAnnotations', () => {
  const data = (tests: JsonTestEntry[]): JsonExportData => ({
    metadata: { generatedAt: '2026-10-08T10:00:00.000Z', reporterVersion: '3.0.0', rootDir: ROOT },
    summary: { total: tests.length, passed: 0, failed: 0, skipped: 0, flaky: 0, duration: 0, passRate: 0 },
    tests,
  });

  it('annotates only unexpected failures, at the failing line, with the error message', () => {
    const { lines, omitted } = buildAnnotations(data([
      failing({ testId: 'f', project: 'Desktop Chrome', error: `${EXPECT_MESSAGE}\n    at ${SPEC}:6:17` }),
      failing({ testId: 'flaky', status: 'passed', outcome: 'flaky' }),
      failing({ testId: 'expected', status: 'failed', outcome: 'expected', error: 'Error: known bug' }),
      failing({ testId: 'skip', status: 'skipped', outcome: 'skipped' }),
      failing({ testId: 'timeout', title: 'checks out', status: 'timedOut', error: 'Test timeout of 30000ms exceeded.' }),
    ]), WORKSPACE);

    expect(lines).toEqual([
      '::error file=e2e/tests/cart.spec.ts,line=6,col=17,title=adds to cart [Desktop Chrome]::Error: expect(received).toBe(expected) // Object.is equality%0A%0AExpected: 2%0AReceived: 1',
      '::error file=e2e/tests/cart.spec.ts,line=9,col=5,title=checks out::Test timeout of 30000ms exceeded.',
    ]);
    expect(omitted).toBe(0);
  });

  it("stops at GitHub's 10-per-step limit and reports how many were left out", () => {
    const tests = Array.from({ length: 12 }, (_, i) => failing({ testId: `t${i}`, title: `case ${i}` }));
    const { lines, omitted } = buildAnnotations(data(tests), WORKSPACE);
    expect(lines.length).toBe(10);
    expect(lines[9]).toBe('::error file=e2e/tests/cart.spec.ts,line=9,col=5,title=case 9::Test failed');
    expect(omitted).toBe(2);
  });
});
