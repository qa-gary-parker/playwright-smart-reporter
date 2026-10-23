import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { buildPlaywrightStyleAiPrompt } from './prompt-builder';
import type { FullConfig, TestCase, TestResult, TestError } from '@playwright/test/reporter';

vi.mock('fs');

const mockFs = vi.mocked(fs);

function makeConfig(rootDir: string = '/project'): FullConfig {
  return {
    rootDir,
    configFile: '',
    globalSetup: null,
    globalTeardown: null,
    globalTimeout: 0,
    grep: /./,
    grepInvert: null,
    maxFailures: 0,
    metadata: {},
    preserveOutput: 'always',
    projects: [],
    reporter: [],
    reportSlowTests: null,
    quiet: false,
    shard: null,
    updateSnapshots: 'missing' as any,
    version: '1.0.0',
    workers: 1,
    webServer: null,
  } as unknown as FullConfig;
}

function makeTestCase(overrides: Partial<{ title: string; file: string; line: number; column: number; titlePath: string[] }> = {}): TestCase {
  const title = overrides.title ?? 'Test title';
  const titlePath = overrides.titlePath ?? ['Suite', title];
  return {
    title,
    location: {
      file: overrides.file ?? '/project/tests/login.spec.ts',
      line: overrides.line ?? 10,
      column: overrides.column ?? 5,
    },
    titlePath: () => titlePath,
  } as unknown as TestCase;
}

function makeTestResult(overrides: Partial<{
  errors: TestError[];
  stdout: (string | Buffer)[];
  stderr: (string | Buffer)[];
  attachments: TestResult['attachments'];
}> = {}): TestResult {
  return {
    errors: overrides.errors ?? [],
    stdout: overrides.stdout ?? [],
    stderr: overrides.stderr ?? [],
    attachments: overrides.attachments ?? [],
    status: 'failed',
    duration: 1000,
    startTime: new Date(),
    retry: 0,
    parallelIndex: 0,
    workerIndex: 0,
    steps: [],
    annotations: [],
  } as unknown as TestResult;
}

/**
 * Creates a TestError. Note: pickCopyPromptErrors removes single-line errors
 * that appear as a substring of any other formatted error (including themselves).
 * To produce a non-empty prompt, errors must be multiline -- provide a stack
 * different from message.
 */
function makeError(overrides: Partial<TestError> = {}): TestError {
  const message = overrides.message ?? 'Expected true to be false';
  return {
    message,
    stack: overrides.stack ?? `${message}\n  at tests/test.spec.ts:10:5`,
    value: overrides.value,
    snippet: overrides.snippet,
    location: overrides.location,
  } as TestError;
}

describe('buildPlaywrightStyleAiPrompt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty string when there are no errors', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [] }),
    });

    expect(result).toBe('');
  });

  it('builds a prompt with test info and error details', () => {
    const error = makeError({
      message: 'Locator resolved to hidden element',
      stack: 'Locator resolved to hidden element\n  at login.spec.ts:15:3',
    });

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase({ title: 'should login', titlePath: ['Auth', 'Login', 'should login'] }),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result).toContain('# Instructions');
    expect(result).toContain('Playwright test failed');
    expect(result).toContain('# Test info');
    expect(result).toContain('Auth >> Login >> should login');
    expect(result).toContain('tests/login.spec.ts:10:5');
    expect(result).toContain('# Error details');
    expect(result).toContain('Locator resolved to hidden element');
  });

  it('uses safeRelativePath to show relative file paths', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig('/project'),
      test: makeTestCase({ file: '/project/tests/deep/test.spec.ts' }),
      result: makeTestResult({
        errors: [makeError()],
      }),
    });

    expect(result).toContain('tests/deep/test.spec.ts');
    expect(result).not.toContain('/project/tests/deep/test.spec.ts');
  });

  it('keeps absolute path when file is outside rootDir (path traversal guard)', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig('/project'),
      test: makeTestCase({ file: '/other/repo/test.spec.ts' }),
      result: makeTestResult({
        errors: [makeError()],
      }),
    });

    expect(result).toContain('/other/repo/test.spec.ts');
  });

  it('includes stdout when present', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        stdout: ['console output here'],
      }),
    });

    expect(result).toContain('# Stdout');
    expect(result).toContain('console output here');
  });

  it('includes stderr when present', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        stderr: ['error output here'],
      }),
    });

    expect(result).toContain('# Stderr');
    expect(result).toContain('error output here');
  });

  it('does not include stdout/stderr sections when empty', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        stdout: [],
        stderr: [],
      }),
    });

    expect(result).not.toContain('# Stdout');
    expect(result).not.toContain('# Stderr');
  });

  it('strips ANSI codes from error text', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError({
          message: '\x1b[31mRed error\x1b[0m',
          stack: '\x1b[31mRed error\x1b[0m\n  at test.ts:1:1',
        })],
      }),
    });

    expect(result).toContain('Red error');
    expect(result).not.toContain('\x1b[31m');
  });

  it('strips non-SGR CSI and OSC 8 hyperlinks from error, stdout and stderr', () => {
    const ansi = '\x1b[2Kerr\x1b]8;;https://x\x07link\x1b]8;;\x07';
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError({
          message: `Error: ${ansi}`,
          stack: `Error: ${ansi}\n  at test.ts:1:1`,
        })],
        stdout: [`out ${ansi}\n`],
        stderr: [`warn ${ansi.replace(/\x07/g, '\x1b\\')}\n`],
      }),
    });

    expect(result).toContain('# Error details\n\n```\nError: errlink\nError: errlink\n  at test.ts:1:1\n```');
    expect(result).toContain('# Stdout\n\n```\nout errlink\n\n```');
    expect(result).toContain('# Stderr\n\n```\nwarn errlink\n\n```');
  });

  it('includes error location in formatted error', () => {
    const error = makeError({
      message: 'Timeout',
      stack: 'Timeout\n  at slow.spec.ts:25:10',
      location: { file: '/project/tests/slow.spec.ts', line: 25, column: 10 },
    });

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result).toContain('at /project/tests/slow.spec.ts:25:10');
  });

  it('includes error snippet when present', () => {
    const error = makeError({
      message: 'Assertion failed',
      stack: 'Assertion failed\n  at test.spec.ts:5:3',
      snippet: '  expect(value).toBe(true)',
    });

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result).toContain('expect(value).toBe(true)');
  });

  it('truncates prompt at 200,000 characters', () => {
    const longMessage = 'x'.repeat(250_000);
    const error = makeError({
      message: longMessage,
      stack: longMessage + '\n  at test.ts:1:1',
    });

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result.length).toBeLessThanOrEqual(200_000 + 20);
    expect(result).toContain('(truncated)');
  });

  it('builds code frame from error location', () => {
    mockFs.readFileSync.mockReturnValue(
      'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7'
    );

    const error = makeError({
      message: 'fail',
      stack: 'fail\n  at test.spec.ts:4:3',
      location: { file: '/project/tests/test.spec.ts', line: 4, column: 3 },
    });

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result).toContain('# Test source');
    expect(result).toContain('> ');
    expect(result).toContain('^');
  });

  it('falls back to test location for code frame when error has no location', () => {
    mockFs.readFileSync.mockReturnValue(
      'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\nline 11\nline 12'
    );

    const error = makeError();

    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase({ line: 10, column: 5 }),
      result: makeTestResult({ errors: [error] }),
    });

    expect(result).toContain('# Test source');
  });

  it('reads stdout from attachment when present', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        stdout: [],
        attachments: [
          { name: 'stdout', contentType: 'text/plain', body: Buffer.from('Attached stdout') },
        ],
      }),
    });

    expect(result).toContain('# Stdout');
    expect(result).toContain('Attached stdout');
  });

  it('reads stderr from attachment when present', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        stderr: [],
        attachments: [
          { name: 'stderr', contentType: 'text/plain', body: Buffer.from('Attached stderr') },
        ],
      }),
    });

    expect(result).toContain('# Stderr');
    expect(result).toContain('Attached stderr');
  });

  it('adds the timeline first anomaly as a labelled heuristic section after the error details', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [makeError()] }),
      firstAnomaly: {
        kind: 'network-error',
        at: 185,
        summary: 'GET http://app.test/api/orders returned 500',
        ref: { lane: 'network', index: 1 },
      },
    });

    expect(result).toContain([
      '# Possible first anomaly (heuristic)',
      '',
      "A suggestion from Smart Reporter's failure timeline, not a diagnosis: the earliest unusual event before the failure.",
      '',
      '- Kind: network-error',
      '- At: 185ms after the test started',
      '- Detail: GET http://app.test/api/orders returned 500',
    ].join('\n'));
    expect(result.indexOf('# Possible first anomaly (heuristic)')).toBeGreaterThan(result.indexOf('# Error details'));
  });

  it('has no anomaly section when the timeline found none', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [makeError()] }),
    });

    expect(result).toContain('# Error details');
    expect(result).not.toContain('Possible first anomaly');
  });

  it('lists every attempt and where they failed when the test ran more than once', () => {
    const steps = [
      { title: 'checkout', duration: 3300, category: 'test.step', failed: true },
      { title: 'pay', duration: 3200, category: 'test.step', failed: true, parent: 0, depth: 1 },
    ];
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [makeError()] }),
      attempts: [
        { retry: 0, status: 'failed', duration: 4800, error: 'Error: card declined\n    at tests/test.spec.ts:10:5', steps },
        { retry: 1, status: 'timedOut', duration: 30000, error: 'Test timeout of 30000ms exceeded.', steps },
      ],
    });

    expect(result).toContain([
      '# Attempts',
      '',
      '- Attempt 1 (failed, 4.8s): Error: card declined',
      '- Attempt 2 (timedOut, 30.0s): Test timeout of 30000ms exceeded.',
      '',
      "Every attempt failed at step 'checkout › pay'",
    ].join('\n'));
    expect(result.indexOf('# Attempts')).toBeGreaterThan(result.indexOf('# Error details'));
  });

  it('has no attempts section for a test that ran once', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({ errors: [makeError()] }),
      attempts: [{ retry: 0, status: 'failed', duration: 4800, error: 'Error: card declined', steps: [] }],
    });

    expect(result).toContain('# Error details');
    expect(result).not.toContain('# Attempts');
  });

  it('includes error-context attachment content', () => {
    const result = buildPlaywrightStyleAiPrompt({
      config: makeConfig(),
      test: makeTestCase(),
      result: makeTestResult({
        errors: [makeError()],
        attachments: [
          {
            name: 'error-context',
            contentType: 'text/markdown',
            body: Buffer.from('# Page snapshot\n```yaml\n- button "Login"\n```'),
          },
        ],
      }),
    });

    expect(result).toContain('# Page snapshot');
    expect(result).toContain('button "Login"');
  });

  describe('pickCopyPromptErrors deduplication', () => {
    it('keeps multiline errors and filters single-line substrings', () => {
      const error1 = makeError({
        message: 'Expected true',
        stack: undefined as any,
      });
      const error2 = makeError({
        message: 'Expected true to be false',
        stack: 'Expected true to be false\n  at file.ts:1',
      });

      const result = buildPlaywrightStyleAiPrompt({
        config: makeConfig(),
        test: makeTestCase(),
        result: makeTestResult({ errors: [error1, error2] }),
      });

      // The multiline error survives; the one-liner "Expected true" is a
      // substring of the multiline text so it gets deduplicated away.
      expect(result).toContain('Expected true to be false');
    });

    it('removes single-line errors that are substrings of a multiline error', () => {
      // A one-line error that appears as a substring of a multiline error
      // gets deduplicated by pickCopyPromptErrors
      const shortError: TestError = {
        message: 'Expected true',
        stack: 'Expected true',
      } as TestError;

      const longError = makeError({
        message: 'Expected true to be false',
        stack: 'Expected true to be false\n  at tests/test.spec.ts:10:5',
      });

      const result = buildPlaywrightStyleAiPrompt({
        config: makeConfig(),
        test: makeTestCase(),
        result: makeTestResult({ errors: [shortError, longError] }),
      });

      // The multiline error survives; "Expected true" is a substring so it's removed
      expect(result).toContain('Expected true to be false');
      // Only one error block should appear (the multiline one)
      const errorBlocks = result.split('# Error details')[1];
      const codeBlocks = errorBlocks?.match(/```/g) ?? [];
      // Each error is wrapped in a pair of ```, so 2 = one error
      expect(codeBlocks.length).toBe(2);
    });

    it('uses error.value when message is absent', () => {
      const error = makeError({
        message: undefined as any,
        stack: 'Value-based error\n  at test.ts:1:1',
        value: 'Value-based error',
      });

      const result = buildPlaywrightStyleAiPrompt({
        config: makeConfig(),
        test: makeTestCase(),
        result: makeTestResult({ errors: [error] }),
      });

      expect(result).toContain('Value-based error');
    });
  });

  describe('code frame building', () => {
    it('reads source file and builds frame with line marker', () => {
      const lines = Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`);
      mockFs.readFileSync.mockReturnValue(lines.join('\n'));

      const error = makeError({
        message: 'fail',
        stack: 'fail\n  at test.spec.ts:5:7',
        location: { file: '/project/tests/test.spec.ts', line: 5, column: 7 },
      });

      const result = buildPlaywrightStyleAiPrompt({
        config: makeConfig(),
        test: makeTestCase(),
        result: makeTestResult({ errors: [error] }),
      });

      expect(result).toContain('# Test source');
      expect(result).toMatch(/> \d+ \|/);
      expect(result).toContain('^');
    });

    it('handles non-existent source file gracefully', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const error = makeError({
        message: 'fail',
        stack: 'fail\n  at missing.spec.ts:1:1',
        location: { file: '/project/tests/missing.spec.ts', line: 1, column: 1 },
      });

      const result = buildPlaywrightStyleAiPrompt({
        config: makeConfig(),
        test: makeTestCase(),
        result: makeTestResult({ errors: [error] }),
      });

      expect(result).toContain('# Error details');
      expect(result).not.toContain('# Test source');
    });

    it('resolves relative file paths against rootDir', () => {
      mockFs.readFileSync.mockReturnValue('line 1\nline 2\nline 3');

      const error = makeError({
        message: 'fail',
        stack: 'fail\n  at relative.spec.ts:2:1',
        location: { file: 'tests/relative.spec.ts', line: 2, column: 1 },
      });

      buildPlaywrightStyleAiPrompt({
        config: makeConfig('/project'),
        test: makeTestCase(),
        result: makeTestResult({ errors: [error] }),
      });

      expect(mockFs.readFileSync).toHaveBeenCalledWith(
        '/project/tests/relative.spec.ts',
        'utf-8',
      );
    });
  });
});
