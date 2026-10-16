import { describe, expect, it } from 'vitest';
import type { ReportTest } from '../../report-data/schema';
import { csvCell, displayStatus, formatDuration, isFailing, outcomeCounts, titlePath, trendStats } from './data';
import { formatQuery, matchesQuery, parseQuery } from './filters';
import { groupTests } from './grouping';
import { QUEUES } from './queues';
import { formatRoute, parseHash, type Route } from './router';

function t(over: Partial<ReportTest> & { testId: string }): ReportTest {
  return { title: over.testId, file: 'a.spec.ts', status: 'passed', outcome: 'expected', duration: 1, retry: 0, steps: [], history: [], signals: [], ...over };
}

const failed = t({ testId: 'f', status: 'failed', outcome: 'unexpected', file: 'checkout/pay.spec.ts', tags: ['@smoke'], project: 'chromium', clusterId: 'c1' });
const timedOut = t({ testId: 'to', status: 'timedOut', outcome: 'unexpected', clusterId: 'c1', signals: ['new-failure'] });
const flaky = t({ testId: 'k', status: 'passed', outcome: 'flaky', retry: 1, suites: ['Search', 'Filters'] });
const expectedFail = t({ testId: 'x', status: 'failed', outcome: 'expected', expectedStatus: 'failed' });
const passed = t({ testId: 'p', title: 'loads hero', project: 'webkit', stabilityScore: { overall: 95, flakiness: 100, performance: 90, reliability: 95, grade: 'A', needsAttention: false } });
const unexpectedPass = t({ testId: 'u', status: 'passed', outcome: 'unexpected', expectedStatus: 'failed' });

describe('status helpers', () => {
  it('treats expected failures as passes, flaky outcomes as flaky, and a test.fail() test that passed as a failure', () => {
    const tests = [failed, timedOut, flaky, expectedFail, passed, unexpectedPass];
    expect(tests.map(displayStatus)).toEqual(['failed', 'timedOut', 'flaky', 'passed', 'passed', 'failed']);
    expect(tests.map(isFailing)).toEqual([true, true, false, false, false, true]);
  });

  it('builds the title path with the project only when several projects ran', () => {
    expect(titlePath(flaky, false)).toEqual(['Search', 'Filters', 'k']);
    expect(titlePath(failed, true)).toEqual(['chromium', 'f']);
    const withFileSuite = t({ testId: 'w', file: 'parallel/test2.spec.ts', suites: ['parallel/test2.spec.ts', 'Header'] });
    expect(titlePath(withFileSuite, false)).toEqual(['Header', 'w']);
  });

  it('counts each test in exactly one outcome bucket, even when history marks a failure as flaky', () => {
    const historicallyFlakyFailure = t({ testId: 'hf', status: 'failed', outcome: 'unexpected', flakinessScore: 0.4, signals: ['flaky'] });
    const interrupted = t({ testId: 'i', status: 'interrupted', outcome: 'skipped' });
    const skipped = t({ testId: 's', status: 'skipped', outcome: 'skipped' });
    const counts = outcomeCounts([failed, timedOut, flaky, expectedFail, passed, historicallyFlakyFailure, interrupted, skipped, unexpectedPass]);
    expect(counts).toEqual({ failed: 4, flaky: 1, passed: 2, skipped: 2 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(9);
  });

  it('formats durations', () => {
    expect([0, 912, 2100, 60_000, 102_400].map(formatDuration)).toEqual(['0ms', '912ms', '2.1s', '1m', '1m 42s']);
  });
});

describe('filter query', () => {
  it('parses known keys, quoted values, and free text, and round-trips', () => {
    const q = parseQuery('status:failed tag:@smoke  suite:"Search box" checkout pay unknown:x');
    expect(q).toEqual({
      tokens: [
        { key: 'status', value: 'failed' },
        { key: 'tag', value: '@smoke' },
        { key: 'suite', value: 'Search box' },
      ],
      text: 'checkout pay unknown:x',
    });
    expect(formatQuery(q)).toBe('status:failed tag:@smoke suite:"Search box" checkout pay unknown:x');
  });

  it('ORs values of one key and ANDs across keys and words', () => {
    const tests = [failed, timedOut, flaky, passed];
    const ids = (input: string) => tests.filter((x) => matchesQuery(x, parseQuery(input))).map((x) => x.testId);
    expect(ids('status:failed')).toEqual(['f', 'to']);
    expect(ids('status:failed status:flaky')).toEqual(['f', 'to', 'k']);
    expect(ids('status:failed tag:smoke')).toEqual(['f']);
    expect(ids('project:webkit loads')).toEqual(['p']);
    expect(ids('checkout pay')).toEqual(['f']);
    expect(ids('signal:new-failure')).toEqual(['to']);
    expect(ids('grade:a')).toEqual(['p']);
    expect(ids('suite:filters')).toEqual(['k']);
  });
});

describe('grouping', () => {
  const data = { clusters: [{ id: 'c1', errorType: 'toBeVisible failed', testIds: ['f', 'to'] }] };

  it('groups by cluster with new failures first inside and across groups', () => {
    const groups = groupTests([passed, failed, timedOut], 'cluster', data);
    expect(groups.map((g) => [g.label, g.tests.map((x) => x.testId)])).toEqual([
      ['toBeVisible failed', ['to', 'f']],
      ['Not clustered', ['p']],
    ]);
  });

  it('keeps two clusters with the same label in separate groups', () => {
    const other = t({ testId: 'o', status: 'failed', outcome: 'unexpected', clusterId: 'c2' });
    const twins = { clusters: [...data.clusters, { id: 'c2', errorType: 'toBeVisible failed', testIds: ['o'] }] };
    expect(groupTests([failed, timedOut, other], 'cluster', twins).map((g) => [g.key, g.label, g.tests.map((x) => x.testId)])).toEqual([
      ['c1', 'toBeVisible failed', ['to', 'f']],
      ['c2', 'toBeVisible failed', ['o']],
    ]);
  });

  it('puts a test in every tag group it carries and counts sum per mode', () => {
    const tagged = t({ testId: 'm', tags: ['@smoke', '@payments', '@smoke'] });
    const groups = groupTests([failed, tagged, passed], 'tag', data);
    expect(Object.fromEntries(groups.map((g) => [g.label, g.tests.map((x) => x.testId)]))).toEqual({
      '@smoke': ['f', 'm'],
      '@payments': ['m'],
      '(none)': ['p'],
    });
    const shared = t({ testId: 'o', owners: ['@a', '@b'] });
    expect(groupTests([shared, passed], 'owner', data).map((g) => [g.label, g.tests.map((x) => x.testId)])).toEqual([
      ['@a', ['o']],
      ['@b', ['o']],
      ['Unowned', ['p']],
    ]);
    for (const by of ['file', 'project', 'suite', 'status', 'grade', 'none'] as const) {
      expect(groupTests([failed, flaky, passed], by, data).reduce((n, g) => n + g.tests.length, 0)).toBe(3);
    }
  });
});

describe('queues', () => {
  it('select the tests each rail item promises', () => {
    const quarantined = t({ testId: 'q', signals: ['quarantined'] });
    const regressed = t({ testId: 'r', signals: ['regression'] });
    const all = [failed, flaky, quarantined, regressed, passed];
    const pick = (id: keyof typeof QUEUES) => all.filter(QUEUES[id].includes).map((x) => x.testId);
    expect(pick('failures')).toEqual(['f']);
    expect(pick('flaky')).toEqual(['k']);
    expect(pick('quarantined')).toEqual(['q']);
    expect(pick('regressions')).toEqual(['r']);
    expect(pick('all')).toHaveLength(5);
  });
});

describe('router', () => {
  it('round-trips every route shape', () => {
    const routes: Route[] = [
      { view: 'queue', queue: 'failures', q: '' },
      { view: 'queue', queue: 'all', q: 'status:failed tag:"a b"', test: '[chromium] a.spec.ts::x y', group: 'tag' },
      { view: 'insights' },
      { view: 'history', tab: 'compare' },
      { view: 'gallery' },
      { view: 'live' },
      { view: 'a11y' },
      { view: 'coverage' },
      { view: 'queue', queue: 'flaky', q: '', run: 'run-123' },
      { view: 'insights', run: 'shard 1/2#3' },
    ];
    for (const r of routes) expect(parseHash(formatRoute(r))).toEqual(r);
  });

  it('survives malformed percent-encoding in a hand-edited link', () => {
    expect(parseHash('#/run/%E0%A4%A/insights')).toEqual({ view: 'insights', run: '%E0%A4%A' });
  });

  it('falls back to the failures queue for unknown or empty hashes', () => {
    expect(parseHash('')).toEqual({ view: 'queue', queue: 'failures', q: '' });
    expect(parseHash('#/q/nope')).toEqual({ view: 'queue', queue: 'failures', q: '' });
    expect(parseHash('#/q/all?g=bogus')).toEqual({ view: 'queue', queue: 'all', q: '' });
  });
});

describe('csv export', () => {
  it('quotes separators and line breaks and neutralises formulas', () => {
    expect(['plain', 'a,b', 'say "hi"', 'line\r\nbreak', '=HYPERLINK("x")', '-1', '@user', 42].map(csvCell)).toEqual([
      'plain',
      '"a,b"',
      '"say ""hi"""',
      '"line\r\nbreak"',
      `"'=HYPERLINK(""x"")"`,
      "'-1",
      "'@user",
      '42',
    ]);
  });
});

describe('trend statistics', () => {
  it('averages the last three runs and flags runs beyond two standard deviations', () => {
    const { average, anomalies } = trendStats([90, 92, 91, 93, 92, 91, 40, 92]);
    expect(average.slice(0, 3)).toEqual([null, null, 91]);
    expect(average[7]).toBeCloseTo((40 + 92 + 91) / 3, 5);
    expect(anomalies).toEqual([false, false, false, false, false, false, true, false]);
  });

  it('flags nothing on short or flat series', () => {
    expect(trendStats([10, 90, 10, 90]).anomalies).toEqual([false, false, false, false]);
    expect(trendStats([5, 5, 5, 5, 5, 5]).anomalies.every((a) => !a)).toBe(true);
  });
});
