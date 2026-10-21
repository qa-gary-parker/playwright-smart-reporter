import { describe, expect, it } from 'vitest';
import type { TestResultData } from '../types';
import { environmentInsights, environmentRowKey } from './environment';

function result(title: string, project: string, browser: string, failed = false, slot?: number): TestResultData {
  return {
    testId: `[${project}] a.spec.ts::${title}`, title, file: 'a.spec.ts', project, browser,
    status: failed ? 'failed' : 'passed', outcome: failed ? 'unexpected' : 'expected', duration: 1, retry: 0, steps: [], history: [],
    ...(slot !== undefined && { attempts: [{ retry: 0, status: failed ? 'failed' : 'passed', duration: 1, steps: [], parallelIndex: slot }] }),
  };
}

const everywhere = (title: string, failIn: string[] = []) =>
  ['chromium', 'firefox', 'webkit'].map((p) => result(title, p, p, failIn.includes(p)));

describe('environmentInsights', () => {
  it('names the project a test fails in when it passes in every other one', () => {
    expect(environmentInsights([...everywhere('checkout', ['firefox']), ...everywhere('login'), ...everywhere('search', ['chromium', 'firefox'])], false)).toEqual([
      { dimension: 'project', value: 'firefox', testIds: ['[firefox] a.spec.ts::checkout'], text: '1 test fails on firefox only' },
    ]);
  });

  it('names the browser when it runs in several projects, and counts tests, not results', () => {
    const results = ['Desktop Firefox', 'Mobile Firefox', 'Desktop Chrome'].flatMap((p) => [
      result('cart', p, p.includes('Firefox') ? 'firefox' : 'chromium', p.includes('Firefox')),
      result('menu', p, p.includes('Firefox') ? 'firefox' : 'chromium', p.includes('Firefox')),
    ]);
    expect(environmentInsights(results, false)).toEqual([
      {
        dimension: 'browser',
        value: 'firefox',
        testIds: ['[Desktop Firefox] a.spec.ts::cart', '[Desktop Firefox] a.spec.ts::menu', '[Mobile Firefox] a.spec.ts::cart', '[Mobile Firefox] a.spec.ts::menu'],
        text: '2 tests fail on firefox only',
      },
    ]);
  });

  it('names the worker every failure ran on, unless the report is merged', () => {
    const results = [result('a', 'p', 'chromium', true, 1), result('b', 'p', 'chromium', true, 1), result('c', 'p', 'chromium', false, 0)];
    expect(environmentInsights(results, false)).toEqual([
      { dimension: 'worker', value: '1', testIds: ['[p] a.spec.ts::a', '[p] a.spec.ts::b'], text: 'All 2 failures ran on worker 1' },
    ]);
    expect(environmentInsights(results, true)).toEqual([]);
  });

  it('keys a test by its id without the project', () => {
    expect(environmentRowKey(result('checkout', 'firefox', 'firefox'))).toBe('a.spec.ts::checkout');
    expect(environmentRowKey({ testId: 'a.spec.ts::x' })).toBe('a.spec.ts::x');
  });
});
