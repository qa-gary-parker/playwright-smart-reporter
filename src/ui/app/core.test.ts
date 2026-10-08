import { describe, expect, it } from 'vitest';
import type { ReportTest } from '../../report-data/schema';
import { displayStatus, formatDuration, isFailing, titlePath } from './data';
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

describe('status helpers', () => {
  it('treats expected failures as passes and flaky outcomes as flaky', () => {
    expect([failed, timedOut, flaky, expectedFail, passed].map(displayStatus)).toEqual(['failed', 'timedOut', 'flaky', 'passed', 'passed']);
    expect([failed, timedOut, flaky, expectedFail, passed].map(isFailing)).toEqual([true, true, false, false, false]);
  });

  it('builds the title path with the project only when several projects ran', () => {
    expect(titlePath(flaky, false)).toEqual(['Search', 'Filters', 'k']);
    expect(titlePath(failed, true)).toEqual(['chromium', 'f']);
    const withFileSuite = t({ testId: 'w', file: 'parallel/test2.spec.ts', suites: ['parallel/test2.spec.ts', 'Header'] });
    expect(titlePath(withFileSuite, false)).toEqual(['Header', 'w']);
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

  it('puts a test in every tag group it carries and counts sum per mode', () => {
    const tagged = t({ testId: 'm', tags: ['@smoke', '@payments'] });
    const groups = groupTests([failed, tagged, passed], 'tag', data);
    expect(Object.fromEntries(groups.map((g) => [g.label, g.tests.map((x) => x.testId)]))).toEqual({
      '@smoke': ['f', 'm'],
      '@payments': ['m'],
      '(none)': ['p'],
    });
    for (const by of ['file', 'project', 'suite', 'status', 'grade', 'owner', 'none'] as const) {
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
      { view: 'queue', queue: 'flaky', q: '', run: 'run-123' },
      { view: 'insights', run: 'shard 1/2#3' },
    ];
    for (const r of routes) expect(parseHash(formatRoute(r))).toEqual(r);
  });

  it('falls back to the failures queue for unknown or empty hashes', () => {
    expect(parseHash('')).toEqual({ view: 'queue', queue: 'failures', q: '' });
    expect(parseHash('#/q/nope')).toEqual({ view: 'queue', queue: 'failures', q: '' });
    expect(parseHash('#/q/all?g=bogus')).toEqual({ view: 'queue', queue: 'all', q: '' });
  });
});
