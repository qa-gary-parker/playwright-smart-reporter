import { describe, it, expect } from 'vitest';
import { FailureClusterer } from './failure-clusterer';
import type { TestResultData, FailureCluster } from '../types';

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

describe('FailureClusterer', () => {
  const clusterer = new FailureClusterer();

  describe('clusterFailures', () => {
    it('returns empty array for no failures', () => {
      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ status: 'skipped' }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters).toEqual([]);
    });

    it('groups failures by error type', () => {
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'TimeoutError: Waiting for selector',
        }),
        createTestResult({
          testId: 'test-2',
          status: 'failed',
          error: 'TimeoutError: Navigation timeout',
        }),
        createTestResult({
          testId: 'test-3',
          status: 'failed',
          error: 'AssertionError: expected true to be false',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters.length).toBe(2);

      const timeoutCluster = clusters.find(c => c.errorType === 'Timeout Error');
      const assertionCluster = clusters.find(c => c.errorType === 'Assertion Error');

      expect(timeoutCluster?.count).toBe(2);
      expect(assertionCluster?.count).toBe(1);
    });

    it('includes timedOut status in failures', () => {
      const results = [
        createTestResult({
          status: 'timedOut',
          error: 'Test timeout',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters.length).toBe(1);
    });

    it('handles unknown errors', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: undefined,
        }),
        createTestResult({
          status: 'failed',
          // No error property
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters.length).toBe(1);
      expect(clusters[0].errorType).toBe('Unknown Error');
      expect(clusters[0].count).toBe(2);
    });

    it('extracts error type from various patterns', () => {
      const testCases = [
        { error: 'TypeError: Cannot read property', expectedType: 'Type Error' },
        { error: 'ReferenceError: foo is not defined', expectedType: 'Reference Error' },
        { error: 'NetworkError: Failed to fetch', expectedType: 'Network Error' },
        { error: 'expected 5 to equal 10', expectedType: 'Assertion Error' },
      ];

      for (const tc of testCases) {
        const results = [
          createTestResult({ status: 'failed', error: tc.error }),
        ];

        const clusters = clusterer.clusterFailures(results);

        expect(clusters[0].errorType).toBe(tc.expectedType);
      }
    });

    it('uses CustomError pattern for unknown error types', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: 'CustomError: Something went wrong',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe('CustomError');
    });
  });

  describe('assignClusters', () => {
    it('assigns cluster info to test results', () => {
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'TimeoutError: Test',
        }),
        createTestResult({
          testId: 'test-2',
          status: 'failed',
          error: 'TimeoutError: Test',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);
      clusterer.assignClusters(results, clusters);

      expect(results[0].failureCluster).toBeDefined();
      expect(results[0].failureCluster?.errorType).toBe('Timeout Error');
      expect(results[0].failureCluster?.count).toBe(2);
      expect(results[0].failureCluster?.tests).toEqual([]); // Empty to avoid circular refs
    });

    it('handles clusters without tests property', () => {
      const results = [
        createTestResult({ testId: 'test-1', status: 'failed' }),
      ];

      const clusters: FailureCluster[] = [{
        id: 'cluster-1',
        errorType: 'Error',
        count: 1,
        tests: undefined as any, // Simulate malformed cluster
      }];

      // Should not throw
      expect(() => clusterer.assignClusters(results, clusters)).not.toThrow();
    });

    it('preserves AI suggestions on clusters', () => {
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'TimeoutError: Test',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);
      clusters[0].aiSuggestion = 'Consider increasing timeout';

      clusterer.assignClusters(results, clusters);

      expect(results[0].failureCluster?.aiSuggestion).toBe('Consider increasing timeout');
    });
  });

  describe('getLargestClusters', () => {
    it('returns clusters sorted by count', () => {
      const clusters: FailureCluster[] = [
        { id: '1', errorType: 'Error A', count: 2, tests: [] },
        { id: '2', errorType: 'Error B', count: 5, tests: [] },
        { id: '3', errorType: 'Error C', count: 3, tests: [] },
      ];

      const largest = clusterer.getLargestClusters(clusters);

      expect(largest[0].count).toBe(5);
      expect(largest[1].count).toBe(3);
      expect(largest[2].count).toBe(2);
    });

    it('limits to specified count', () => {
      const clusters: FailureCluster[] = [
        { id: '1', errorType: 'Error A', count: 1, tests: [] },
        { id: '2', errorType: 'Error B', count: 2, tests: [] },
        { id: '3', errorType: 'Error C', count: 3, tests: [] },
        { id: '4', errorType: 'Error D', count: 4, tests: [] },
        { id: '5', errorType: 'Error E', count: 5, tests: [] },
        { id: '6', errorType: 'Error F', count: 6, tests: [] },
      ];

      const largest = clusterer.getLargestClusters(clusters, 3);

      expect(largest.length).toBe(3);
      expect(largest[0].count).toBe(6);
      expect(largest[2].count).toBe(4);
    });

    it('uses default limit of 5', () => {
      const clusters: FailureCluster[] = Array(10).fill(null).map((_, i) => ({
        id: String(i),
        errorType: `Error ${i}`,
        count: i,
        tests: [],
      }));

      const largest = clusterer.getLargestClusters(clusters);

      expect(largest.length).toBe(5);
    });
  });

  describe('getClusterSummary', () => {
    it('returns singular form for one test', () => {
      const cluster: FailureCluster = {
        id: '1',
        errorType: 'Timeout Error',
        count: 1,
        tests: [],
      };

      expect(clusterer.getClusterSummary(cluster)).toBe('Timeout Error: 1 test affected');
    });

    it('returns plural form for multiple tests', () => {
      const cluster: FailureCluster = {
        id: '1',
        errorType: 'Timeout Error',
        count: 5,
        tests: [],
      };

      expect(clusterer.getClusterSummary(cluster)).toBe('Timeout Error: 5 tests affected');
    });
  });

  // Issue #16: Test expected failure exclusion
  describe('expected failure exclusion', () => {
    it('excludes expected failures from clustering', () => {
      const results: TestResultData[] = [
        createTestResult({
          status: 'failed',
          error: 'AssertionError: expected 1 to equal 2',
          outcome: 'unexpected',  // Truly unexpected failure
        }),
        createTestResult({
          testId: 'test-2',
          status: 'failed',
          error: 'AssertionError: expected 1 to equal 2',
          outcome: 'expected',  // Expected failure (test.fail())
        }),
        createTestResult({
          testId: 'test-3',
          status: 'failed',
          error: 'AssertionError: expected 1 to equal 2',
          outcome: 'unexpected',  // Truly unexpected failure
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      // Should only cluster the 2 unexpected failures, not the expected one
      expect(clusters.length).toBe(1);
      expect(clusters[0].count).toBe(2);
      expect(clusters[0].tests.length).toBe(2);
      expect(clusters[0].tests.every(t => t.outcome === 'unexpected')).toBe(true);
    });

    it('returns empty array when all failures are expected', () => {
      const results: TestResultData[] = [
        createTestResult({
          status: 'failed',
          error: 'AssertionError: expected failure',
          outcome: 'expected',
        }),
        createTestResult({
          testId: 'test-2',
          status: 'failed',
          error: 'AssertionError: expected failure',
          outcome: 'expected',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters).toEqual([]);
    });
  });
});
