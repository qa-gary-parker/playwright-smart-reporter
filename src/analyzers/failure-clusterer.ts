import type { TestResultData, FailureCluster } from '../types';
import { hashString } from '../utils/sanitizers';

/**
 * Clusters similar test failures together for better analysis and reporting
 */
export class FailureClusterer {
  /**
   * Cluster failed tests by error type
   * Excludes expected failures (tests marked with test.fail() that actually fail)
   */
  clusterFailures(results: TestResultData[]): FailureCluster[] {
    // Only cluster truly unexpected failures - exclude expected failures (Issue #16)
    const failedTests = results.filter(r =>
      (r.status === 'failed' || r.status === 'timedOut') &&
      r.outcome !== 'expected'  // Exclude expected failures
    );

    if (failedTests.length === 0) return [];

    // Group by error type
    const clusters = new Map<string, TestResultData[]>();

    for (const test of failedTests) {
      const errorType = this.extractErrorType(test.error);
      const clusterId = hashString(errorType);

      if (!clusters.has(clusterId)) {
        clusters.set(clusterId, []);
      }
      clusters.get(clusterId)!.push(test);
    }

    // Convert to FailureCluster objects
    return Array.from(clusters.entries()).map(([id, tests]) => ({
      id,
      errorType: this.extractErrorType(tests[0].error),
      count: tests.length,
      tests,
    }));
  }

  /**
   * Extract error type from error message
   */
  private extractErrorType(error?: string): string {
    if (!error) return 'Unknown Error';

    // Try to extract the error class/type from the stack trace
    const lines = error.split('\n');
    const firstLine = lines[0].trim();

    // Check for common patterns
    if (firstLine.includes('TimeoutError')) return 'Timeout Error';
    if (firstLine.includes('AssertionError')) return 'Assertion Error';
    if (firstLine.includes('TypeError')) return 'Type Error';
    if (firstLine.includes('ReferenceError')) return 'Reference Error';
    if (firstLine.includes('NetworkError')) return 'Network Error';
    if (firstLine.includes('ElementNotFound')) return 'Element Not Found';
    if (firstLine.includes('Selector')) return 'Selector Error';

    // Look for "Error:" pattern
    const errorMatch = firstLine.match(/(\w+Error):/);
    if (errorMatch) return errorMatch[1];

    // Look for "expected" pattern (assertions)
    if (firstLine.includes('expected')) return 'Assertion Error';

    // Extract first meaningful word
    const words = firstLine.split(/\s+/);
    if (words.length > 0) {
      return words[0].length > 50 ? 'Unknown Error' : words[0];
    }

    return 'Unknown Error';
  }

  /**
   * Assign cluster information to test results
   * @param results - Array of test results
   * @param clusters - Array of failure clusters
   */
  assignClusters(results: TestResultData[], clusters: FailureCluster[]): void {
    // Create a map of test ID to cluster for quick lookup
    const testToCluster = new Map<string, FailureCluster>();

    for (const cluster of clusters) {
      // Add null check for cluster.tests
      if (!cluster.tests || !Array.isArray(cluster.tests)) {
        continue;
      }

      for (const test of cluster.tests) {
        testToCluster.set(test.testId, cluster);
      }
    }

    // Assign cluster info to each test
    for (const test of results) {
      const cluster = testToCluster.get(test.testId);
      if (cluster) {
        test.failureCluster = {
          id: cluster.id,
          errorType: cluster.errorType,
          count: cluster.count,
          tests: [], // Don't include full test array to avoid circular refs
          aiSuggestion: cluster.aiSuggestion,
        };
      }
    }
  }

  /**
   * Get largest clusters (most common failures)
   */
  getLargestClusters(clusters: FailureCluster[], limit: number = 5): FailureCluster[] {
    return clusters
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * Get cluster summary for reporting
   */
  getClusterSummary(cluster: FailureCluster): string {
    const plural = cluster.count === 1 ? 'test' : 'tests';
    return `${cluster.errorType}: ${cluster.count} ${plural} affected`;
  }
}
