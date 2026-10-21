import { describe, it, expect } from 'vitest';
import { FailureClusterer, fingerprintFailure, trackClusters } from './failure-clusterer';
import type { TestResultData, FailureCluster, RunSummary, TestHistory, TestHistoryEntry } from '../types';

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

    it('groups failures by fingerprint, not by error class alone', () => {
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
          error: 'TimeoutError: Waiting for selector',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters.map(c => [c.errorType, c.count])).toEqual([
        ['TimeoutError: Waiting for selector at test.spec.ts', 2],
        ['TimeoutError: Navigation timeout at test.spec.ts', 1],
      ]);
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
      expect(clusters[0].errorType).toBe('Unknown Error at test.spec.ts');
      expect(clusters[0].count).toBe(2);
    });

    it('labels a cluster with its masked first message line', () => {
      const testCases = [
        { error: 'TypeError: Cannot read property', expectedType: 'TypeError: Cannot read property at test.spec.ts' },
        { error: 'ReferenceError: foo is not defined', expectedType: 'ReferenceError: foo is not defined at test.spec.ts' },
        { error: 'NetworkError: Failed to fetch', expectedType: 'NetworkError: Failed to fetch at test.spec.ts' },
        { error: 'expected 5 to equal 10', expectedType: 'expected <n> to equal <n> at test.spec.ts' },
      ];

      for (const tc of testCases) {
        const results = [
          createTestResult({ status: 'failed', error: tc.error }),
        ];

        const clusters = clusterer.clusterFailures(results);

        expect(clusters[0].errorType).toBe(tc.expectedType);
      }
    });

    it('keeps a custom error class in the label', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: 'CustomError: Something went wrong',
        }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe('CustomError: Something went wrong at test.spec.ts');
    });

    it('splits Playwright expect failures by locator, and labels them by matcher', () => {
      const results = [
        createTestResult({ testId: 't1', status: 'failed', error: "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#a')" }),
        createTestResult({ testId: 't2', status: 'failed', error: "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#b')" }),
        createTestResult({ testId: 't3', status: 'failed', error: "Error: expect(locator).toBeVisible() failed\n\nLocator: locator('#a')" }),
        createTestResult({ testId: 't4', status: 'failed', error: 'Error: expect(locator).toHaveText(expected) failed' }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters.map(c => [c.errorType, c.tests.map(t => t.testId)])).toEqual([
        ["toBeVisible on locator('#a') at test.spec.ts", ['t1', 't3']],
        ["toBeVisible on locator('#b') at test.spec.ts", ['t2']],
        ['toHaveText at test.spec.ts', ['t4']],
      ]);
    });

    it('labels test timeouts by their masked message', () => {
      const clusters = clusterer.clusterFailures([createTestResult({ status: 'timedOut', error: 'Test timeout of 4000ms exceeded.' })]);
      expect(clusters[0].errorType).toBe('Test timeout of <n>ms exceeded. at test.spec.ts');
    });

    it('never produces a bare "Error" cluster name', () => {
      const results = [
        createTestResult({ status: 'failed', error: 'Error: something exploded in the fixture' }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe('something exploded in the fixture at test.spec.ts');
    });

    it('labels negated assertions by the negated matcher', () => {
      const results = [
        createTestResult({ status: 'failed', error: 'Error: expect(locator).not.toBeVisible() failed' }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe('not.toBeVisible at test.spec.ts');
    });

    it('labels soft assertions by matcher', () => {
      const results = [
        createTestResult({ status: 'failed', error: 'Error: expect.soft(locator).toHaveText(expected) failed' }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe('toHaveText at test.spec.ts');
    });

    it('falls back to Unknown Error for empty bare Error messages', () => {
      for (const error of ['Error:', 'Error:   ', 'Error']) {
        const clusters = clusterer.clusterFailures([
          createTestResult({ status: 'failed', error }),
        ]);
        expect(clusters[0].errorType).toBe('Unknown Error at test.spec.ts');
      }
    });

    it('truncates long messages used as cluster labels', () => {
      const results = [
        createTestResult({ status: 'failed', error: `Error: ${'x'.repeat(100)}` }),
      ];

      const clusters = clusterer.clusterFailures(results);

      expect(clusters[0].errorType).toBe(`${'x'.repeat(77)}... at test.spec.ts`);
    });
  });

  describe('fingerprints', () => {
    const ROOT = '/home/runner/work/shop/shop';
    const at = (file: string, line: number, column = 5) => `\n    at ${ROOT}/${file}:${line}:${column}`;
    const cartPage = { file: 'pages/cart.page.ts', line: 12, column: 32 };
    const clickTimeout = (locator: string, callLog = '') =>
      `TimeoutError: locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for ${locator}\n${callLog}${at('pages/cart.page.ts', 12, 32)}`;
    const toHaveText = (received: string, resolved: number) =>
      `Error: expect(locator).toHaveText(expected) failed\n\nLocator:  locator('h1')\nExpected: "Total 30"\nReceived: "${received}"\nTimeout:  5000ms\n\n` +
      `Call log:\n  - Expect "toHaveText" with timeout 5000ms\n  - waiting for locator('h1')\n    ${resolved} × locator resolved to <h1>${received}</h1>\n` +
      at('tests/cart.spec.ts', 15, 36);
    const failed = (testId: string, error: string | undefined, over: Partial<TestResultData> = {}) =>
      createTestResult({ testId, status: 'failed', outcome: 'unexpected', file: 'tests/cart.spec.ts', error, ...over });
    const summary = (clusters: FailureCluster[]) => clusters.map((c) => [c.errorType, c.tests.map((t) => t.testId)]);

    it('splits timeouts on one line by locator, and ignores the call log', () => {
      const clusters = clusterer.clusterFailures([
        failed('save', clickTimeout("getByRole('button', { name: 'Save' })"), { errorLocation: cartPage }),
        failed('cancel', clickTimeout("getByRole('button', { name: 'Cancel' })"), { errorLocation: cartPage }),
        failed('save-retried', clickTimeout("getByRole('button', { name: 'Save' })", '  - retrying click action, attempt #2\n'), { errorLocation: cartPage }),
      ]);

      expect(summary(clusters)).toEqual([
        ["TimeoutError: locator.click: Timeout <n>ms exceeded. on getByRole('button', { name: 'Save' }) at pages/cart.page.ts:12", ['save', 'save-retried']],
        ["TimeoutError: locator.click: Timeout <n>ms exceeded. on getByRole('button', { name: 'Cancel' }) at pages/cart.page.ts:12", ['cancel']],
      ]);
    });

    it('merges an assertion that fails with different received values', () => {
      const location = { file: 'tests/cart.spec.ts', line: 15, column: 36 };
      const clusters = clusterer.clusterFailures([
        failed('twelve', toHaveText('Total 12', 3), { errorLocation: location }),
        failed('seven', toHaveText('Total 7', 5), { errorLocation: location }),
      ]);

      expect(summary(clusters)).toEqual([["toHaveText on locator('h1') at tests/cart.spec.ts:15", ['twelve', 'seven']]]);
    });

    it('masks digits, UUIDs, hex ids, quoted values and URLs', () => {
      const clusters = clusterer.clusterFailures([
        failed('a', `Error: order 1041 for user 3f2a9c1d-1b2c-4d5e-8f90-1234567890ab session 5f1e2d3c4b5a69788796a5b4 got "rejected" from https://shop.test/api/orders/1041?retry=1${at('tests/cart.spec.ts', 30)}`),
        failed('b', `Error: order 2087 for user 9E8D7C6B-5A49-4382-A716-5544332211FF session 0x1f2e got 'timed out' from https://shop.test/api/orders/2087${at('tests/cart.spec.ts', 30)}`),
      ]);

      expect(summary(clusters)).toEqual([['order <n> for user <uuid> session <hex> got <str> from <url> at tests/cart.spec.ts:30', ['a', 'b']]]);
    });

    it('masks the machine part of absolute paths, so another checkout gives the same id', () => {
      const missing = (path: string) => fingerprintFailure({ file: 'tests/cart.spec.ts', error: `Error: ENOENT: no such file or directory, open ${path}` });
      const mac = missing('/Users/a/proj/fixtures/cart.json');

      expect(missing('/home/runner/work/proj/proj/fixtures/cart.json')).toEqual(mac);
      expect(missing('C:\\Users\\a\\proj\\fixtures\\cart.json')).toEqual(mac);
      expect(mac.label).toBe('ENOENT: no such file or directory, open <path>/cart.json at tests/cart.spec.ts');
    });

    it('leaves relative paths, HTML tags, dates, word pairs and comments alone', () => {
      const clusters = clusterer.clusterFailures([failed('a', 'Error: got <b>Cart</b> from fixtures/cart.json due 16/10/2026 and/or later // see docs')]);

      expect(summary(clusters)).toEqual([['got <b>Cart</b> from fixtures/cart.json due <n>/<n>/<n> and/or later // see docs at tests/cart.spec.ts', ['a']]]);
    });

    it("keeps apostrophes in words as text, so they do not swallow the message", () => {
      const clusters = clusterer.clusterFailures([failed('a', "Error: can't save draft 12, isn't signed in")]);

      expect(summary(clusters)).toEqual([["can't save draft <n>, isn't signed in at tests/cart.spec.ts", ['a']]]);
    });

    it('labels the location from errorLocation, then a stack frame in the test file, then the test file, and ids by file only', () => {
      const location = fingerprintFailure({ file: 'tests/cart.spec.ts', error: `Error: boom${at('tests/cart.spec.ts', 9)}`, errorLocation: { file: 'tests\\helpers.ts', line: 4, column: 1 } });
      const frame = fingerprintFailure({ file: 'tests/cart.spec.ts', error: `Error: boom\n    at helper (${ROOT}/node_modules/lib/index.js:1:1)${at('tests/cart.spec.ts', 9)}` });
      const file = fingerprintFailure({ file: 'tests/cart.spec.ts', error: 'Error: boom' });

      expect([location.label, frame.label, file.label]).toEqual(['boom at tests/helpers.ts:4', 'boom at tests/cart.spec.ts:9', 'boom at tests/cart.spec.ts']);
      expect(frame.id).toBe(file.id);
      expect(new Set([location.id, frame.id, file.id]).size).toBe(2);
    });

    it('labels a cluster with the location of its first test', () => {
      const location = (line: number) => ({ errorLocation: { file: 'tests/cart.spec.ts', line, column: 36 } });
      const clusters = clusterer.clusterFailures([
        failed('first', toHaveText('Total 12', 3), location(15)),
        failed('moved', toHaveText('Total 12', 3), location(40)),
      ]);

      expect(summary(clusters)).toEqual([["toHaveText on locator('h1') at tests/cart.spec.ts:15", ['first', 'moved']]]);
    });

    it('ignores escape sequences that the SGR strip leaves behind', () => {
      const plain = fingerprintFailure({ file: 'a.spec.ts', error: 'Error: boom docs' });

      expect(fingerprintFailure({ file: 'a.spec.ts', error: 'Error: \x1b[2Kboom \x1b]8;;https://x.test\x07docs\x1b]8;;\x07' })).toEqual(plain);
      expect(fingerprintFailure({ file: 'a.spec.ts', error: 'Error: boom \x1b]8;;https://x.test\x1b\\docs\x1b]8;;\x1b\\' })).toEqual(plain);
      expect(plain.label).toBe('boom docs at a.spec.ts');
    });

    // Ids are stored in history, so these values must not drift between runs or releases.
    it('gives a fixed 16-character hex id that keeps when lines move, and follows the locator', () => {
      const save = clickTimeout("locator('#save')");
      const cancel = clickTimeout("locator('#cancel')");

      expect(fingerprintFailure({ file: 'tests/cart.spec.ts', error: save, errorLocation: cartPage }).id).toBe('184053c42bd73a9d');
      expect(fingerprintFailure({ file: 'tests/cart.spec.ts', error: save, errorLocation: { ...cartPage, line: 13, column: 99 } }).id).toBe('184053c42bd73a9d');
      expect(fingerprintFailure({ file: 'tests/cart.spec.ts', error: cancel, errorLocation: cartPage }).id).toBe('f4901281ded5673e');
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
      expect(results[0].failureCluster?.errorType).toBe('TimeoutError: Test at test.spec.ts');
      expect(results[0].failureCluster?.count).toBe(2);
      expect(results[0].failureCluster?.tests).toEqual([]); // Empty to avoid circular refs
    });

    it('skips a cluster without a tests array and still assigns the clusters after it', () => {
      const results = [
        createTestResult({ testId: 'test-1', status: 'failed' }),
        createTestResult({ testId: 'test-2', status: 'failed' }),
      ];

      const clusters: FailureCluster[] = [
        { id: 'cluster-1', errorType: 'Error', count: 1, tests: undefined as any }, // Simulate malformed cluster
        { id: 'cluster-2', errorType: 'Boom', count: 1, tests: [results[1]] },
      ];

      clusterer.assignClusters(results, clusters);

      expect(results.map(r => r.failureCluster)).toEqual([
        undefined,
        { id: 'cluster-2', errorType: 'Boom', count: 1, tests: [], aiSuggestion: undefined },
      ]);
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

    it('copies the tracking of the cluster to its tests', () => {
      const results = [createTestResult({ testId: 'test-1', status: 'failed', error: 'TimeoutError: Test' })];
      const clusters = clusterer.clusterFailures(results);
      clusters[0].tracking = { status: 'new', runs: 1, since: '2026-10-09T12:00:00.000Z', trend: [1] };

      clusterer.assignClusters(results, clusters);

      expect(results[0].failureCluster?.tracking).toEqual({ status: 'new', runs: 1, since: '2026-10-09T12:00:00.000Z', trend: [1] });
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

describe('trackClusters', () => {
  const at = (n: number) => `2026-10-0${n}T12:00:00.000Z`;
  const summary = (n: number): RunSummary => ({
    runId: `run-${n}`, timestamp: at(n), total: 1, passed: 0, failed: 0, skipped: 0, flaky: 0, slow: 0, duration: 1, passRate: null,
    ciInfo: { provider: 'github', commit: `c${n}` },
  });
  const current = { runId: 'run-9', timestamp: at(9), ciInfo: { provider: 'github', commit: 'c9' } };

  // testId -> what it did in runs 1, 2, ...: failed with that cluster id, 'pass', 'skip', 'fail' (no cluster id saved), or null (not run)
  function historyOf(tests: Record<string, Array<string | null>>): TestHistory {
    const runCount = Math.max(...Object.values(tests).map((v) => v.length));
    const entry = (n: number, v: string): TestHistoryEntry => ({
      passed: v === 'pass',
      skipped: v === 'skip',
      duration: 1,
      timestamp: at(n),
      runId: `run-${n}`,
      ...(!['pass', 'skip', 'fail'].includes(v) && { clusterId: v }),
    });
    return {
      runs: [],
      summaries: Array.from({ length: runCount }, (_, i) => summary(i + 1)),
      tests: Object.fromEntries(Object.entries(tests).map(([id, vs]) => [id, vs.flatMap((v, i) => (v === null ? [] : [entry(i + 1, v)]))])),
    };
  }
  const cluster = (id: string, ...testIds: string[]): FailureCluster => ({
    id, errorType: id, count: testIds.length, tests: testIds.map((testId) => createTestResult({ testId, status: 'failed', outcome: 'unexpected' })),
  });

  it('labels a cluster seen in run 1, gone in run 2 and back in run 3 Regressed', () => {
    const clusters = [cluster('A', 'a')];

    trackClusters(clusters, clusters[0].tests, historyOf({ a: ['A', 'pass'] }), current);

    expect(clusters[0].tracking).toEqual({
      status: 'regressed', runs: 1, since: at(9), sinceCommit: 'c9', trend: [1, 0, 1], commits: { lastPassed: { commit: 'c2' }, firstFailed: { commit: 'c9' } },
    });
  });

  it('labels a cluster no run had New, and one in the runs before Recurring from the run after it last went away', () => {
    const clusters = [cluster('A', 'a'), cluster('B', 'b')];

    trackClusters(clusters, [], historyOf({ a: ['A', 'pass', 'A', 'A'], b: ['pass', 'pass', 'pass', 'pass'] }), current);

    expect(clusters.map((c) => c.tracking)).toEqual([
      { status: 'recurring', runs: 3, since: at(3), sinceCommit: 'c3', trend: [1, 0, 1, 1, 1], commits: { lastPassed: { commit: 'c2' }, firstFailed: { commit: 'c3' } } },
      { status: 'new', runs: 1, since: at(9), sinceCommit: 'c9', trend: [0, 0, 0, 0, 1], commits: { lastPassed: { commit: 'c4' }, firstFailed: { commit: 'c9' } } },
    ]);
  });

  it('counts a run as gone only when a test the cluster had passed and none failed with it', () => {
    // Run 2: a did not run. Run 3: a skipped. Run 4: a failed with no cluster id saved (before 4.0.0, or clustering off).
    // Run 5: b, which was in the cluster in run 1, passed while a still failed with it.
    const clusters = [cluster('A', 'a')];

    trackClusters(clusters, [], historyOf({ a: ['A', null, 'skip', 'fail', 'A'], b: ['A', null, null, null, 'pass'] }), current);

    expect(clusters[0].tracking).toEqual({ status: 'recurring', runs: 3, since: at(1), sinceCommit: 'c1', trend: [2, 0, 0, 0, 1, 1], commits: { firstFailed: { commit: 'c1' } } });
  });

  it('leaves tracking unset when history cannot tell: no runs, or failures saved without cluster ids', () => {
    const clusters = [cluster('A', 'a')];

    trackClusters(clusters, [], { runs: [], tests: {}, summaries: [] }, current);
    expect(clusters.map((c) => c.tracking)).toEqual([undefined]);

    // Saved before 4.0.0, or with clustering off
    trackClusters(clusters, [], historyOf({ a: ['fail', 'pass'] }), current);
    expect(clusters.map((c) => c.tracking)).toEqual([undefined]);
  });

  it('compares with a history that had no failures, so every cluster is new', () => {
    const clusters = [cluster('A', 'a')];

    trackClusters(clusters, [], historyOf({ a: ['pass', 'pass'] }), current);

    expect(clusters[0].tracking).toEqual({
      status: 'new', runs: 1, since: at(9), sinceCommit: 'c9', trend: [0, 0, 1], commits: { lastPassed: { commit: 'c2' }, firstFailed: { commit: 'c9' } },
    });
  });

  it('leaves out an earlier attempt of this run, which this run replaces', () => {
    const clusters = [cluster('A', 'a')];

    trackClusters(clusters, [], historyOf({ a: ['A', 'pass'] }), { runId: 'run-2', timestamp: at(2) });

    expect(clusters[0].tracking).toEqual({ status: 'recurring', runs: 2, since: at(1), sinceCommit: 'c1', trend: [1, 1], commits: { firstFailed: { commit: 'c1' } } });
  });

  it('returns the clusters of the baseline run that went away, with their tests that passed this run', () => {
    const history = historyOf({ a: ['A', 'A'], b: [null, 'A'], c: [null, 'B'], d: [null, 'C'], e: [null, 'D'] });
    const results = [
      createTestResult({ testId: 'a', status: 'passed', outcome: 'expected' }),
      createTestResult({ testId: 'b', status: 'skipped', outcome: 'skipped' }),
      createTestResult({ testId: 'c', status: 'failed', outcome: 'unexpected' }),
      createTestResult({ testId: 'd', status: 'skipped', outcome: 'skipped' }),
      createTestResult({ testId: 'e', status: 'failed', outcome: 'unexpected' }),
    ];
    // B still fails, C did not run, and D's test now fails with another cluster
    const clusters = [cluster('B', 'c'), cluster('E', 'e')];

    expect(trackClusters(clusters, results, history, current, 'run-2')).toEqual([{ id: 'A', testIds: ['a'] }]);
    expect(trackClusters(clusters, results, history, current)).toBeUndefined();
  });
});
