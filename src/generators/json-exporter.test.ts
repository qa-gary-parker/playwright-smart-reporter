import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { exportJsonData } from './json-exporter';
import type {
  TestResultData,
  TestHistory,
  SmartReporterOptions,
  RunComparison,
  FailureCluster,
  RunSummary,
  StabilityScore,
} from '../types';

vi.mock('fs');

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

describe('json-exporter', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock readFileSync for package.json version lookup
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: '1.0.8' }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportJsonData', () => {
    it('produces valid JSON file at expected path', () => {
      const results = [createTestResult()];
      const history = createTestHistory();
      const options: SmartReporterOptions = { outputFile: '/reports/smart-report.html' };

      const outputPath = exportJsonData(results, history, Date.now(), options);

      expect(outputPath).toBe(path.resolve('/reports', 'smart-report-data.json'));
      expect(mockFs.writeFileSync).toHaveBeenCalledOnce();

      const [writtenPath, writtenContent] = mockFs.writeFileSync.mock.calls[0];
      expect(writtenPath).toBe(outputPath);

      // Verify structural correctness of the JSON
      const parsed = JSON.parse(writtenContent as string);
      expect(parsed.metadata.reporterVersion).toBeDefined();
      expect(Array.isArray(parsed.tests)).toBe(true);
      expect(parsed.summary.total).toBe(1);
    });

    it('summary fields are correct (total, passed, failed, skipped, flaky, passRate)', () => {
      // The passed filter is: status==='passed' || outcome==='expected' || outcome==='flaky'
      // The failed filter is: outcome==='unexpected' && (status==='failed' || status==='timedOut')
      const results = [
        createTestResult({ testId: '1', status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: '2', status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: '3', status: 'skipped', outcome: 'skipped' }),
        createTestResult({ testId: '4', status: 'passed', outcome: 'flaky' }),
        createTestResult({ testId: '5', status: 'timedOut', outcome: 'unexpected' }),
      ];
      const history = createTestHistory();
      const options: SmartReporterOptions = {};
      const startTime = Date.now();

      exportJsonData(results, history, startTime, options);

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.summary.total).toBe(5);
      // #1: status=passed -> yes; #4: status=passed + outcome=flaky -> yes
      // #2, #3, #5 don't match any passed condition
      expect(written.summary.passed).toBe(2);
      // #2: outcome=unexpected + status=failed; #5: outcome=unexpected + status=timedOut
      expect(written.summary.failed).toBe(2);
      expect(written.summary.skipped).toBe(1);
      expect(written.summary.flaky).toBe(1);
      expect(written.summary.passRate).toBe(40); // 2/5 * 100
      expect(written.summary.duration).toBeGreaterThanOrEqual(0);
    });

    it('stability grade calculation (average across tests)', () => {
      const results = [
        createTestResult({ testId: '1', stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: '2', stabilityScore: createStabilityScore({ grade: 'B' }) }),
        createTestResult({ testId: '3', stabilityScore: createStabilityScore({ grade: 'A' }) }),
      ];
      const history = createTestHistory();
      const options: SmartReporterOptions = {};

      exportJsonData(results, history, Date.now(), options);

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      // A=5, B=4, A=5 => avg = 14/3 = 4.67 => round = 5 => 'A'
      expect(written.summary.stabilityGrade).toBe('A');
    });

    it('stability grade averages to middle grade correctly', () => {
      const results = [
        createTestResult({ testId: '1', stabilityScore: createStabilityScore({ grade: 'A' }) }),
        createTestResult({ testId: '2', stabilityScore: createStabilityScore({ grade: 'C' }) }),
      ];
      const history = createTestHistory();

      exportJsonData(results, history, Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      // A=5, C=3 => avg = 8/2 = 4 => 'B'
      expect(written.summary.stabilityGrade).toBe('B');
    });

    it('tests array contains all required fields', () => {
      const results = [
        createTestResult({
          testId: 'abc-123',
          title: 'Login test',
          file: 'tests/login.spec.ts',
          status: 'failed',
          duration: 2500,
          retry: 2,
          error: 'Element not found',
          outcome: 'unexpected',
          flakinessScore: 0.3,
          stabilityScore: createStabilityScore({ overall: 75, grade: 'C' }),
          performanceTrend: '↑ 15% slower',
          tags: ['@smoke'],
          suite: 'Auth',
          browser: 'chromium',
          project: 'Desktop Chrome',
          aiSuggestion: 'Add wait before click',
        }),
      ];
      const history = createTestHistory();

      exportJsonData(results, history, Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      const test = written.tests[0];

      expect(test.testId).toBe('abc-123');
      expect(test.title).toBe('Login test');
      expect(test.file).toBe('tests/login.spec.ts');
      expect(test.status).toBe('failed');
      expect(test.duration).toBe(2500);
      expect(test.retry).toBe(2);
      expect(test.error).toBe('Element not found');
      expect(test.outcome).toBe('unexpected');
      expect(test.flakinessScore).toBe(0.3);
      expect(test.stabilityScore).toEqual({ overall: 75, grade: 'C' });
      expect(test.performanceTrend).toBe('↑ 15% slower');
      expect(test.tags).toEqual(['@smoke']);
      expect(test.suite).toBe('Auth');
      expect(test.browser).toBe('chromium');
      expect(test.project).toBe('Desktop Chrome');
      expect(test.aiSuggestion).toBe('Add wait before click');
    });

    it('failure clusters are included when present', () => {
      const clusterTest = createTestResult({ testId: 'fail-1', status: 'failed' });
      const clusters: FailureCluster[] = [
        {
          id: 'cluster-1',
          errorType: 'TimeoutError',
          count: 3,
          tests: [clusterTest],
          aiSuggestion: 'Increase timeout',
        },
      ];

      exportJsonData([clusterTest], createTestHistory(), Date.now(), {}, undefined, clusters);

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.failureClusters).toHaveLength(1);
      expect(written.failureClusters[0].id).toBe('cluster-1');
      expect(written.failureClusters[0].errorType).toBe('TimeoutError');
      expect(written.failureClusters[0].count).toBe(3);
      expect(written.failureClusters[0].testIds).toEqual(['fail-1']);
      expect(written.failureClusters[0].aiSuggestion).toBe('Increase timeout');
    });

    it('comparison data is included when present', () => {
      const comparison: RunComparison = {
        baselineRun: createRunSummary({ runId: 'baseline', passRate: 70 }),
        currentRun: createRunSummary({ runId: 'current', passRate: 90 }),
        changes: {
          newFailures: [],
          fixedTests: [],
          newTests: [],
          regressions: [],
          improvements: [],
        },
      };

      exportJsonData([createTestResult()], createTestHistory(), Date.now(), {}, comparison);

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.comparison).toBeDefined();
      expect(written.comparison.baselineRun.runId).toBe('baseline');
      expect(written.comparison.currentRun.runId).toBe('current');
      expect(written.comparison.changes).toBeDefined();
    });

    it('history data is included', () => {
      const history = createTestHistory({
        runs: [
          { runId: 'run-1', timestamp: '2024-01-01T00:00:00Z' },
          { runId: 'run-2', timestamp: '2024-01-02T00:00:00Z' },
        ],
        summaries: [
          createRunSummary({ runId: 'run-1' }),
          createRunSummary({ runId: 'run-2' }),
        ],
      });

      exportJsonData([createTestResult()], history, Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.history).toBeDefined();
      expect(written.history.runCount).toBe(2);
      expect(written.history.runs).toHaveLength(2);
      expect(written.history.summaries).toHaveLength(2);
    });

    it('handles history with undefined summaries', () => {
      const history = createTestHistory({
        runs: [{ runId: 'run-1', timestamp: '2024-01-01T00:00:00Z' }],
        summaries: undefined,
      });

      exportJsonData([createTestResult()], history, Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.history.runCount).toBe(1);
      expect(written.history.runs).toHaveLength(1);
      expect(written.history.summaries).toBeUndefined();
    });

    it('handles empty results array', () => {
      exportJsonData([], createTestHistory(), Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.summary.total).toBe(0);
      expect(written.summary.passed).toBe(0);
      expect(written.summary.failed).toBe(0);
      expect(written.summary.skipped).toBe(0);
      expect(written.summary.flaky).toBe(0);
      expect(written.summary.passRate).toBe(0);
      expect(written.tests).toEqual([]);
    });

    it('handles results with no stability scores', () => {
      const results = [
        createTestResult({ testId: '1' }),
        createTestResult({ testId: '2' }),
      ];

      exportJsonData(results, createTestHistory(), Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.summary.stabilityGrade).toBeUndefined();
      expect(written.tests[0].stabilityScore).toBeUndefined();
      expect(written.tests[1].stabilityScore).toBeUndefined();
    });

    it('version comes from package.json (not hardcoded)', () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ version: '2.5.0' }));

      exportJsonData([createTestResult()], createTestHistory(), Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.metadata.reporterVersion).toBe('2.5.0');
    });

    it('falls back to 0.0.0 when package.json read fails', () => {
      mockFs.readFileSync.mockImplementation((p: any) => {
        if (typeof p === 'string' && p.includes('package.json')) {
          throw new Error('ENOENT');
        }
        return '';
      });

      exportJsonData([createTestResult()], createTestHistory(), Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.metadata.reporterVersion).toBe('0.0.0');
    });

    it('outputDir parameter is respected', () => {
      const results = [createTestResult()];
      const history = createTestHistory();
      const options: SmartReporterOptions = { outputFile: '/default/smart-report.html' };

      const outputPath = exportJsonData(results, history, Date.now(), options, undefined, undefined, '/custom/output');

      expect(outputPath).toBe(path.resolve('/custom/output', 'smart-report-data.json'));
    });

    it('uses cwd when no outputFile or outputDir specified', () => {
      const results = [createTestResult()];
      const history = createTestHistory();

      const outputPath = exportJsonData(results, history, Date.now(), {});

      expect(outputPath).toBe(path.resolve(process.cwd(), 'smart-report-data.json'));
    });

    it('metadata includes generatedAt timestamp', () => {
      exportJsonData([createTestResult()], createTestHistory(), Date.now(), {});

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.metadata.generatedAt).toBeDefined();
      // Should be a valid ISO date string
      expect(new Date(written.metadata.generatedAt).toISOString()).toBe(written.metadata.generatedAt);
    });

    it('metadata includes projectName when configured', () => {
      const options: SmartReporterOptions = { projectName: 'my-project' };

      exportJsonData([createTestResult()], createTestHistory(), Date.now(), options);

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
      expect(written.metadata.projectName).toBe('my-project');
    });

    it('JSON output is pretty-printed with 2-space indentation', () => {
      exportJsonData([createTestResult()], createTestHistory(), Date.now(), {});

      const writtenContent = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Pretty-printed JSON has newlines and indentation
      expect(writtenContent).toContain('\n');
      expect(writtenContent).toContain('  ');
    });
  });
});
