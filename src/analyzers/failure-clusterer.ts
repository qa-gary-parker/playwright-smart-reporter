import * as crypto from 'crypto';
import type { TestResultData, FailureCluster } from '../types';
import { parseError, type StackFrame } from '../utils/error-stack';
import { stripAnsiCodes, truncate } from '../utils/sanitizers';

export interface FailureFingerprint {
  /**
   * First 16 hex characters of a SHA-256 over the type, masked message, failing file and locator. The line is left
   * out, so the same failure keeps its id in every run, on every machine, and when lines move.
   */
  id: string;
  /** Matcher or masked first message line, then the locator and the failing file:line. */
  label: string;
}

// Retries, waits and element states in Playwright's call log change from run to run.
const CALL_LOG = /^\s*Call log:/m;
const MATCHER = /expect(?:\.\w+)?\(.*?\)\s*\.\s*(not\s*\.\s*)?(\w+)/;
// One level of nested parentheses covers filter({ has: locator(...) }) and getByText('Pay (now)').
const LOCATOR = /\b(?:locator|frameLocator|getBy[A-Z][A-Za-z]*)\((?:[^()]|\([^()]*\))*\)(?:\.[A-Za-z]+\((?:[^()]|\([^()]*\))*\))*/;
const URL_PATTERN = /\b[a-z][a-z\d+.-]*:\/\/[^\s'"`<>()]+/gi;
// A quote that touches a word character is an apostrophe ("can't"), not a delimiter.
const QUOTED = /(?<!\w)(?:"[^"\n]*"|'[^'\n]*'|`[^`\n]*`)(?!\w)/g;
// Two or more segments after "/" or a drive letter. The lookbehind skips relative paths, dates and "and/or".
const ABSOLUTE_PATH = /(?<![\w<>/\\.-])(?:[A-Za-z]:[\\/]|\/)(?:[\w.@+-]+[\\/])+[\w.@+-]+/g;
const UUID = /(?<![\da-z])[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}(?![\da-z])/gi;
// 0x literals, or 8+ hex characters with at least one digit and one letter; plain numbers fall to DIGITS.
const HEX_ID = /(?<![\da-z])(?:0x[\da-f]+|(?=[a-f]*\d)(?=\d*[a-f])[\da-f]{8,})(?![\da-z])/gi;
const DIGITS = /\d+(?:\.\d+)*/g;
const LABEL_MAX = 80;

const toPosix = (p: string) => p.replace(/\\/g, '/');

function maskIds(text: string): string {
  return text.replace(UUID, '<uuid>').replace(HEX_ID, '<hex>');
}

function maskMessage(line: string): string {
  const masked = line
    .replace(URL_PATTERN, '<url>')
    .replace(QUOTED, '<str>')
    .replace(ABSOLUTE_PATH, (p) => `<path>/${p.split(/[\\/]/).pop()}`);
  return maskIds(masked).replace(DIGITS, '<n>');
}

// errorLocation and test.file are relative to the Playwright rootDir; stack frames are absolute, so only their line is used.
function failureLocation(test: Pick<TestResultData, 'errorLocation' | 'file'>, frames: StackFrame[]): { file: string; line?: number } {
  if (test.errorLocation) return { file: toPosix(test.errorLocation.file), line: test.errorLocation.line };
  const file = toPosix(test.file);
  const spec = file.replace(/^(\.\.?\/)+/, '');
  const frame = frames.find((f) => {
    const frameFile = toPosix(f.file);
    return frameFile === spec || frameFile.endsWith(`/${spec}`);
  });
  return { file, line: frame?.line };
}

/**
 * Fingerprints a failure by error type, masked message, failing location and locator, so failures with one root
 * cause share an id while different elements or code paths do not.
 */
export function fingerprintFailure(test: Pick<TestResultData, 'error' | 'errorLocation' | 'file'>): FailureFingerprint {
  const { message, frames } = parseError(stripAnsiCodes(test.error ?? ''));
  const lines = message
    .split(CALL_LOG)[0]
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  const firstLine = lines[0] ?? '';
  const masked = lines.map(maskMessage);

  const matcher = MATCHER.exec(firstLine);
  const assertion = matcher ? `${matcher[1] ? 'not.' : ''}${matcher[2]}` : '';
  const type = assertion ? `expect.${assertion}` : (/^\w*(?:Error|Exception)\b/.exec(firstLine)?.[0] ?? '');
  const rawLocator = LOCATOR.exec(message)?.[0];
  const locator = rawLocator ? maskIds(rawLocator.replace(/\s+/g, ' ')) : '';
  const location = failureLocation(test, frames);

  const what = assertion || truncate((masked[0] ?? '').replace(/^Error\b:?\s*/, '') || 'Unknown Error', LABEL_MAX);
  const at = location.line === undefined ? location.file : `${location.file}:${location.line}`;
  const label = `${what}${locator ? ` on ${locator}` : ''}${at ? ` at ${at}` : ''}`;
  const id = crypto.createHash('sha256').update([type, masked.join('\n'), location.file, locator].join('\0')).digest('hex').slice(0, 16);
  return { id, label };
}

/**
 * Clusters similar test failures together for better analysis and reporting
 */
export class FailureClusterer {
  /**
   * Cluster failed tests by failure fingerprint
   * Excludes expected failures (tests marked with test.fail() that actually fail)
   */
  clusterFailures(results: TestResultData[]): FailureCluster[] {
    // Only cluster truly unexpected failures - exclude expected failures (Issue #16)
    const failedTests = results.filter(r =>
      (r.status === 'failed' || r.status === 'timedOut') &&
      r.outcome !== 'expected'  // Exclude expected failures
    );

    const clusters = new Map<string, FailureCluster>();
    for (const test of failedTests) {
      const { id, label } = fingerprintFailure(test);
      const cluster = clusters.get(id);
      if (cluster) {
        cluster.tests.push(test);
        cluster.count = cluster.tests.length;
      } else {
        clusters.set(id, { id, errorType: label, count: 1, tests: [test] });
      }
    }
    return [...clusters.values()];
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
