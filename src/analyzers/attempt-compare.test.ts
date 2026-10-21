import { describe, expect, it } from 'vitest';
import type { AttemptData, StepData } from '../types';
import { alignSteps, compareAttemptTraces, diffAttemptEvidence, divergenceSummary, stepPath, type AttemptEvidence } from './attempt-compare';

const step = (title: string, duration: number, over: Partial<StepData> = {}): StepData => ({ title, duration, category: 'test.step', ...over });
const attempt = (retry: number, status: AttemptData['status'], duration: number, steps: StepData[]): AttemptData => ({ retry, status, duration, steps });

// checkout > pay fails after 3.2s in the first attempt
const FAILED_STEPS = [
  step('open shop', 500),
  step('log in', 800),
  step('checkout', 3300, { failed: true }),
  step('pay', 3200, { parent: 2, depth: 1, failed: true }),
];
// the passing attempt has one more step, before log in
const PASSED_STEPS = [
  step('open shop', 500),
  step('accept cookies', 100),
  step('log in', 800),
  step('checkout', 450),
  step('pay', 400, { parent: 3, depth: 1 }),
];

describe('stepPath', () => {
  it('lists the titles from the top-level step down to the step', () => {
    expect(stepPath(FAILED_STEPS, 3)).toEqual(['checkout', 'pay']);
    expect(stepPath(FAILED_STEPS, 1)).toEqual(['log in']);
  });
});

describe('alignSteps', () => {
  it('pairs steps by title path, so a step inserted in the passing attempt marks only that step', () => {
    const same = FAILED_STEPS.map((s) => ({ ...s, failed: undefined }));
    const inserted = [same[0], step('accept cookies', 100), same[1], { ...same[2], parent: undefined }, { ...same[3], parent: 3 }];

    expect(alignSteps(same, inserted)).toEqual([
      { a: 0, b: 0, differs: false },
      { b: 1, differs: true },
      { a: 1, b: 2, differs: false },
      { a: 2, b: 3, differs: false },
      { a: 3, b: 4, differs: false },
    ]);
  });

  it('marks a step that failed in one attempt only, and one more than twice as slow', () => {
    expect(alignSteps(FAILED_STEPS, PASSED_STEPS).map((r) => r.differs)).toEqual([false, true, false, true, true]);
  });

  it('does not pair steps that share a title under different parents', () => {
    const a = [step('setup', 10), step('click', 5, { parent: 0, depth: 1 })];
    const b = [step('teardown', 10), step('click', 5, { parent: 0, depth: 1 })];

    expect(alignSteps(a, b)).toEqual([
      { a: 0, differs: true },
      { a: 1, differs: true },
      { b: 0, differs: true },
      { b: 1, differs: true },
    ]);
  });

  it('pairs repeated steps in order and leaves the extra one unpaired', () => {
    const a = [step('poll', 10), step('poll', 10), step('done', 10)];
    const b = [step('poll', 10), step('poll', 10), step('poll', 10), step('done', 10)];

    expect(alignSteps(a, b)).toEqual([
      { a: 0, b: 0, differs: false },
      { a: 1, b: 1, differs: false },
      { b: 2, differs: true },
      { a: 2, b: 3, differs: false },
    ]);
  });

  it('pairs by position past a million comparisons, marking the pairs whose title paths differ', () => {
    const common = Array.from({ length: 1000 }, (_, i) => step(`step ${i}`, 10));
    const rows = alignSteps([step('a first', 10), ...common, step('a last', 10)], [step('b first', 10), ...common, step('b last', 10)]);

    expect(rows.length).toBe(1002);
    expect(rows.filter((r) => r.differs)).toEqual([
      { a: 0, b: 0, differs: true },
      { a: 1001, b: 1001, differs: true },
    ]);
  });
});

describe('divergenceSummary', () => {
  it('names the step the failed attempt failed at and how long the passing attempt took for it', () => {
    expect(divergenceSummary([attempt(0, 'failed', 4800, FAILED_STEPS), attempt(1, 'passed', 2300, PASSED_STEPS)])).toBe(
      "Attempt 1 failed at step 'checkout › pay' after 3.2s; attempt 2 passed it in 400ms",
    );
  });

  it('says the passing attempt passed without the step when it has no such step', () => {
    expect(divergenceSummary([attempt(0, 'timedOut', 30000, FAILED_STEPS), attempt(1, 'passed', 1300, PASSED_STEPS.slice(0, 3))])).toBe(
      "Attempt 1 timed out at step 'checkout › pay' after 3.2s; attempt 2 passed without it",
    );
  });

  it('compares the whole attempts when no step is marked as failed', () => {
    const steps = FAILED_STEPS.map((s) => ({ ...s, failed: undefined }));
    expect(divergenceSummary([attempt(0, 'timedOut', 30000, steps), attempt(1, 'failed', 900, []), attempt(2, 'passed', 1200, PASSED_STEPS)])).toBe(
      'Attempt 1 timed out after 30.0s; attempt 3 passed in 1.2s',
    );
  });

  it('says every attempt failed at the same step when no attempt passed', () => {
    expect(divergenceSummary([0, 1, 2].map((r) => attempt(r, 'failed', 4800, FAILED_STEPS)))).toBe("Every attempt failed at step 'checkout › pay'");
  });

  it('lists where each attempt failed when no attempt passed and they failed at different steps', () => {
    const atLogin = [step('open shop', 500), step('log in', 1000, { failed: true })];
    expect(divergenceSummary([attempt(0, 'failed', 4800, FAILED_STEPS), attempt(1, 'failed', 1500, atLogin), attempt(2, 'timedOut', 30000, [])])).toBe(
      "Attempt 1 failed at step 'checkout › pay' after 3.2s; attempt 2 failed at step 'log in' after 1.0s; attempt 3 timed out after 30.0s",
    );
  });

  it('for test.fail(), puts the attempt that passed against the attempt that failed as expected', () => {
    expect(divergenceSummary([attempt(0, 'passed', 1200, PASSED_STEPS), attempt(1, 'failed', 4800, FAILED_STEPS)], 'failed')).toBe(
      'Attempt 1 passed after 1.2s; attempt 2 failed in 4.8s',
    );
    expect(divergenceSummary([attempt(0, 'timedOut', 30000, FAILED_STEPS), attempt(1, 'failed', 900, PASSED_STEPS)], 'failed')).toBe(
      "Attempt 1 timed out at step 'checkout › pay' after 3.2s; attempt 2 ran it in 400ms and failed",
    );
  });

  it('has no summary for one attempt, or for failed attempts without any failed step', () => {
    expect(divergenceSummary([attempt(0, 'failed', 4800, FAILED_STEPS)])).toBeUndefined();
    expect(divergenceSummary([attempt(0, 'failed', 6100, []), attempt(1, 'failed', 6200, [])])).toBeUndefined();
  });
});

const req = (url: string, status: number, method = 'GET') => ({ method, url: `http://shop.test${url}`, status });

describe('diffAttemptEvidence', () => {
  it('lists requests made in one attempt only and requests whose status differs, failed attempt first', () => {
    const failed: AttemptEvidence = { network: [req('/', 200), req('/api/cart', 500), req('/api/log', 204, 'POST')], console: [] };
    const passed: AttemptEvidence = { network: [req('/', 200), req('/api/cart', 200), req('/api/promo', 200)], console: [] };

    expect(diffAttemptEvidence(failed, passed)).toEqual({
      network: [
        { method: 'GET', url: 'http://shop.test/api/cart', failed: 500, passed: 200 },
        { method: 'POST', url: 'http://shop.test/api/log', failed: 204 },
        { method: 'GET', url: 'http://shop.test/api/promo', passed: 200 },
      ],
      console: [],
    });
  });

  it('pairs a repeated request in order, so only the extra call is listed', () => {
    const failed: AttemptEvidence = { network: [req('/api/poll', 200), req('/api/poll', 503), req('/api/poll', 200)], console: [] };
    const passed: AttemptEvidence = { network: [req('/api/poll', 200), req('/api/poll', 200)], console: [] };

    expect(diffAttemptEvidence(failed, passed).network).toEqual([
      { method: 'GET', url: 'http://shop.test/api/poll', failed: 503, passed: 200 },
      { method: 'GET', url: 'http://shop.test/api/poll', failed: 200 },
    ]);
  });

  it('lists console errors and warnings that only the failed attempt logged', () => {
    const failed: AttemptEvidence = {
      console: [
        { level: 'log', text: 'booted' },
        { level: 'error', text: 'Uncaught TypeError: cart is undefined' },
        { level: 'warning', text: 'slow response' },
        { level: 'error', text: 'ads blocked' },
      ],
    };
    const passed: AttemptEvidence = { console: [{ level: 'error', text: 'ads blocked' }, { level: 'error', text: 'only when passing' }] };

    expect(diffAttemptEvidence(failed, passed)).toEqual({
      console: [
        { level: 'error', text: 'Uncaught TypeError: cart is undefined' },
        { level: 'warning', text: 'slow response' },
      ],
    });
  });

  it('keeps at most 50 rows of each kind and cuts long text', () => {
    const failed: AttemptEvidence = {
      network: Array.from({ length: 60 }, (_, i) => req(`/api/${i}`, 200)),
      console: Array.from({ length: 60 }, (_, i) => ({ level: 'error', text: `${i} ${'x'.repeat(600)}` })),
    };
    const diff = diffAttemptEvidence(failed, { network: [], console: [] });

    expect([diff.network?.length, diff.console?.length, diff.console?.[0].text.length]).toEqual([50, 50, 501]);
  });
});

describe('compareAttemptTraces', () => {
  const evidence: AttemptEvidence = { network: [req('/api/cart', 500)], console: [] };
  const attempts = [attempt(0, 'failed', 900, []), attempt(1, 'passed', 400, [])];

  it('names the attempts that have no trace instead of comparing', () => {
    expect(compareAttemptTraces(attempts, new Map([[0, evidence], [1, null]]))).toEqual({ failed: 0, passed: 1, missingTrace: [1] });
    expect(compareAttemptTraces(attempts, new Map([[0, null], [1, null]]))).toEqual({ failed: 0, passed: 1, missingTrace: [0, 1] });
  });

  it('compares the first failed attempt that has a trace with the passing attempt', () => {
    const three = [attempt(0, 'failed', 900, []), attempt(1, 'timedOut', 900, []), attempt(2, 'passed', 400, [])];
    expect(compareAttemptTraces(three, new Map([[0, null], [1, evidence], [2, { network: [req('/api/cart', 200)], console: [] }]]))).toEqual({
      failed: 1,
      passed: 2,
      network: [{ method: 'GET', url: 'http://shop.test/api/cart', failed: 500, passed: 200 }],
      console: [],
    });
  });

  it('compares the text as recorded, then masks what it keeps before cutting it', () => {
    const redact = (text: string) => text.split('tok-1234').join('[REDACTED]');
    const failed: AttemptEvidence = { network: [req('/api/cart?t=tok-1234', 500)], console: [{ level: 'error', text: `${'x'.repeat(496)}tok-1234` }] };
    const passed: AttemptEvidence = { network: [req('/api/cart?t=tok-1234', 200)], console: [] };

    expect(compareAttemptTraces(attempts, new Map([[0, failed], [1, passed]]), redact)).toEqual({
      failed: 0,
      passed: 1,
      network: [{ method: 'GET', url: 'http://shop.test/api/cart?t=[REDACTED]', failed: 500, passed: 200 }],
      console: [{ level: 'error', text: `${'x'.repeat(496)}[RED…` }],
    });
  });

  it('for test.fail(), compares the attempt that passed with the attempt that failed as expected', () => {
    const passedFirst = [attempt(0, 'passed', 400, []), attempt(1, 'failed', 900, [])];
    expect(compareAttemptTraces(passedFirst, new Map([[0, evidence], [1, null]]), undefined, 'failed')).toEqual({ failed: 0, passed: 1, missingTrace: [1] });
  });

  it('has nothing to compare without a failed and a passing attempt', () => {
    expect(compareAttemptTraces([attempt(0, 'failed', 900, []), attempt(1, 'failed', 900, [])], new Map([[0, evidence], [1, evidence]]))).toBeUndefined();
  });
});
