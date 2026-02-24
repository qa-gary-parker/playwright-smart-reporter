import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateExecutivePdf } from './executive-pdf';
import type { ExecutivePdfData } from './executive-pdf';
import type {
  TestResultData,
  TestHistory,
  CIInfo,
  FailureCluster,
  RunSummary,
  StabilityScore,
} from '../types';

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test One',
    file: 'tests/example.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

function createTestHistory(overrides: Partial<TestHistory> = {}): TestHistory {
  return {
    runs: [],
    tests: {},
    summaries: [],
    ...overrides,
  };
}

function createRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
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
  };
}

function createStabilityScore(overrides: Partial<StabilityScore> = {}): StabilityScore {
  return {
    overall: 90,
    flakiness: 95,
    performance: 85,
    reliability: 90,
    grade: 'A',
    needsAttention: false,
    ...overrides,
  };
}

function createBasicData(overrides: Partial<ExecutivePdfData> = {}): ExecutivePdfData {
  return {
    results: [createTestResult()],
    history: createTestHistory(),
    startTime: Date.now() - 5000,
    ...overrides,
  };
}

describe('executive-pdf', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-pdf-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a file path ending in .pdf', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir);
    expect(result).toMatch(/\.pdf$/);
  });

  it('returns the expected filename', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir);
    expect(path.basename(result)).toBe('smart-report.pdf');
  });

  it('creates a file at the returned path', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir);
    expect(fs.existsSync(result)).toBe(true);
  });

  it('generated file starts with PDF magic bytes', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir);
    const buffer = fs.readFileSync(result);
    const header = buffer.subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('generated file has reasonable size (> 1KB)', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir);
    const stats = fs.statSync(result);
    expect(stats.size).toBeGreaterThan(1024);
  });

  it('handles empty results array without throwing', () => {
    const data = createBasicData({ results: [] });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
    const result = generateExecutivePdf(data, tmpDir);
    expect(fs.existsSync(result)).toBe(true);
  });

  it('handles missing history summaries', () => {
    const data = createBasicData({
      history: createTestHistory({ summaries: undefined }),
    });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
    const result = generateExecutivePdf(data, tmpDir);
    expect(fs.existsSync(result)).toBe(true);
  });

  it('handles empty history summaries', () => {
    const data = createBasicData({
      history: createTestHistory({ summaries: [] }),
    });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles missing CI info', () => {
    const data = createBasicData({ ciInfo: undefined });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles CI info with all fields', () => {
    const ciInfo: CIInfo = {
      provider: 'github',
      branch: 'main',
      commit: 'abc1234',
      buildId: '42',
    };
    const data = createBasicData({ ciInfo });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles missing failure clusters', () => {
    const data = createBasicData({ failureClusters: undefined });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles results with all tests passed (no failures)', () => {
    const results = [
      createTestResult({ testId: '1', status: 'passed', outcome: 'expected' }),
      createTestResult({ testId: '2', status: 'passed', outcome: 'expected' }),
      createTestResult({ testId: '3', status: 'passed', outcome: 'expected' }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles results with failures and AI suggestions', () => {
    const failedTest = createTestResult({
      testId: 'fail-1',
      title: 'Login should work',
      status: 'failed',
      outcome: 'unexpected',
      error: 'TimeoutError: element not found',
      aiSuggestion: 'Add explicit wait for the login button',
    });
    const clusters: FailureCluster[] = [
      {
        id: 'cluster-1',
        errorType: 'TimeoutError',
        count: 1,
        tests: [failedTest],
        aiSuggestion: 'Consider increasing timeout or adding waits',
      },
    ];
    const data = createBasicData({
      results: [failedTest],
      failureClusters: clusters,
    });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles results with no stability scores', () => {
    const results = [
      createTestResult({ testId: '1', stabilityScore: undefined }),
      createTestResult({ testId: '2', stabilityScore: undefined }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles results with stability scores', () => {
    const results = [
      createTestResult({ testId: '1', stabilityScore: createStabilityScore({ grade: 'A' }) }),
      createTestResult({ testId: '2', stabilityScore: createStabilityScore({ grade: 'C' }) }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('custom project name appears in PDF content', () => {
    const data = createBasicData({ projectName: 'MyProject-E2E' });
    const result = generateExecutivePdf(data, tmpDir);
    const buffer = fs.readFileSync(result);
    const content = buffer.toString('latin1');
    expect(content).toContain('MyProject-E2E');
  });

  it('handles history with multiple summaries for sparklines', () => {
    const summaries: RunSummary[] = Array.from({ length: 10 }, (_, i) =>
      createRunSummary({
        runId: `run-${i}`,
        passRate: 70 + i * 3,
        duration: 5000 + i * 500,
      }),
    );
    const data = createBasicData({
      history: createTestHistory({ summaries }),
    });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
    const result = generateExecutivePdf(data, tmpDir);
    expect(fs.statSync(result).size).toBeGreaterThan(1024);
  });

  it('handles mixed test statuses (pass, fail, skip, flaky)', () => {
    const results = [
      createTestResult({ testId: '1', status: 'passed', outcome: 'expected' }),
      createTestResult({ testId: '2', status: 'failed', outcome: 'unexpected', error: 'Assertion failed' }),
      createTestResult({ testId: '3', status: 'skipped', outcome: 'skipped' }),
      createTestResult({ testId: '4', status: 'passed', outcome: 'flaky' }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles failure clusters without AI suggestion', () => {
    const failedTest = createTestResult({
      testId: 'fail-1',
      status: 'failed',
      outcome: 'unexpected',
      error: 'Connection refused',
    });
    const clusters: FailureCluster[] = [
      {
        id: 'cluster-1',
        errorType: 'ConnectionError',
        count: 1,
        tests: [failedTest],
        // no aiSuggestion
      },
    ];
    const data = createBasicData({
      results: [failedTest],
      failureClusters: clusters,
    });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('creates output directory if it does not exist', () => {
    const nestedDir = path.join(tmpDir, 'nested', 'output');
    const result = generateExecutivePdf(createBasicData(), nestedDir);
    expect(fs.existsSync(result)).toBe(true);
  });

  it('handles very long test names in failure table', () => {
    const longName = 'A'.repeat(200);
    const results = [
      createTestResult({
        testId: 'long-1',
        title: longName,
        status: 'failed',
        outcome: 'unexpected',
        error: 'Some error',
      }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  it('handles CI info with partial fields', () => {
    const ciInfo: CIInfo = {
      provider: 'jenkins',
      // branch and commit undefined
    };
    const data = createBasicData({ ciInfo });
    expect(() => generateExecutivePdf(data, tmpDir)).not.toThrow();
  });

  // ── Theme variants ─────────────────────────────────────────────

  it('generates dark theme PDF with correct filename', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir, 'report', 'dark');
    expect(path.basename(result)).toBe('report-dark.pdf');
    expect(fs.existsSync(result)).toBe(true);
    const header = fs.readFileSync(result).subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('generates minimal theme PDF with correct filename', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir, 'report', 'minimal');
    expect(path.basename(result)).toBe('report-minimal.pdf');
    expect(fs.existsSync(result)).toBe(true);
    const header = fs.readFileSync(result).subarray(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('corporate theme uses default filename (no suffix)', () => {
    const result = generateExecutivePdf(createBasicData(), tmpDir, 'report', 'corporate');
    expect(path.basename(result)).toBe('report.pdf');
  });

  it('dark theme produces a valid PDF with failures', () => {
    const results = [
      createTestResult({ testId: '1', status: 'passed', outcome: 'expected' }),
      createTestResult({ testId: '2', status: 'failed', outcome: 'unexpected', error: 'Boom' }),
      createTestResult({ testId: '3', status: 'passed', outcome: 'flaky' }),
    ];
    const data = createBasicData({ results });
    expect(() => generateExecutivePdf(data, tmpDir, 'dark-test', 'dark')).not.toThrow();
    const result = generateExecutivePdf(data, tmpDir, 'dark-test', 'dark');
    expect(fs.statSync(result).size).toBeGreaterThan(1024);
  });

  it('minimal theme produces a valid PDF with history', () => {
    const summaries: RunSummary[] = Array.from({ length: 5 }, (_, i) =>
      createRunSummary({ runId: `run-${i}`, passRate: 80 + i * 2 }),
    );
    const data = createBasicData({
      history: createTestHistory({ summaries }),
    });
    expect(() => generateExecutivePdf(data, tmpDir, 'minimal-test', 'minimal')).not.toThrow();
    const result = generateExecutivePdf(data, tmpDir, 'minimal-test', 'minimal');
    expect(fs.statSync(result).size).toBeGreaterThan(1024);
  });

  it('all 3 themed PDFs can be generated side by side', () => {
    const data = createBasicData();
    const themes = ['corporate', 'dark', 'minimal'] as const;
    const paths = themes.map(t => generateExecutivePdf(data, tmpDir, 'multi', t));

    expect(paths.map(p => path.basename(p))).toEqual([
      'multi.pdf', 'multi-dark.pdf', 'multi-minimal.pdf',
    ]);
    for (const p of paths) {
      expect(fs.existsSync(p)).toBe(true);
      expect(fs.statSync(p).size).toBeGreaterThan(1024);
    }
  });
});
