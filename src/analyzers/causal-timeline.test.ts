import { describe, expect, it } from 'vitest';
import type { StepData, TestHistoryEntry } from '../types';
import type { TraceContents } from '../collectors/trace-reader';
import { buildReportData } from '../report-data/builder';
import { buildCausalTimeline, findFailureMoment, stepDurationsOf, type FailureStep } from './causal-timeline';

const T0 = 1_700_000_000_000;
// Trace monotonic clock reads 5_000 at wall time T0 + 100.
const CLOCK = { wallTime: T0 + 100, monotonicTime: 5_000 };

function request(url: string, startOffset: number, time: number, response: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    startedDateTime: new Date(T0 + startOffset).toISOString(),
    time,
    request: { method: 'GET', url },
    response,
    _monotonicTime: CLOCK.monotonicTime + startOffset - 100,
    ...extra,
  };
}

function trace(resources: unknown[] = [], consoleEvents: Array<{ at: number; level: string; text: string }> = []): TraceContents {
  return {
    contexts: [{
      clock: CLOCK,
      resources,
      console: consoleEvents.map((e) => ({ time: T0 + e.at, level: e.level, text: e.text })),
    }],
  };
}

const step = (title: string, startTime: number, duration: number, category = 'test.step', failed = false): StepData =>
  ({ title, startTime, duration, category, ...(failed ? { failed: true } : {}) });

const passed = (stepDurations: Record<string, number>): TestHistoryEntry =>
  ({ passed: true, duration: 2_000, timestamp: '2026-10-01T00:00:00Z', stepDurations });

const STEPS = [
  step('open app', 140, 15),
  step('load orders', 160, 40),
  step('Expect "toHaveCount"', 210, 1_000, 'expect', true),
];

describe('buildCausalTimeline', () => {
  it('normalises steps, network and console onto ms offsets from the attempt start', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace(
        [request('http://app.test/api/orders', 170.4, 15.2, { status: 200 })],
        [{ at: 180, level: 'log', text: 'rendered' }],
      ),
    });

    expect(timeline).toEqual({
      duration: 1_210,
      lanes: {
        steps: [
          { title: 'open app', start: 140, end: 155, category: 'test.step' },
          { title: 'load orders', start: 160, end: 200, category: 'test.step' },
          { title: 'Expect "toHaveCount"', start: 210, end: 1_210, category: 'expect', failed: true },
        ],
        network: [{ start: 170, end: 186, method: 'GET', url: 'http://app.test/api/orders', status: 200 }],
        console: [{ at: 180, level: 'log', text: 'rendered' }],
      },
    });
  });

  it('flags a 5xx response as the first anomaly at the moment the response arrived', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace(
        [
          request('http://app.test/', 141, 5, { status: 200 }),
          request('http://app.test/api/orders', 170, 15, { status: 500 }),
        ],
        [{ at: 172, level: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' }],
      ),
    });

    expect(timeline.firstAnomaly).toEqual({
      kind: 'network-error',
      at: 185,
      summary: 'GET http://app.test/api/orders returned 500',
      ref: { lane: 'network', index: 1 },
    });
  });

  it('flags a request that failed outright, at its start because the trace records no failure time', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace([request('http://api.test/orders', 170, -1, { status: -1, _failureText: 'net::ERR_CONNECTION_REFUSED' })]),
    });

    expect(timeline.lanes.network).toEqual([
      { start: 170, end: 170, method: 'GET', url: 'http://api.test/orders', status: -1, failure: 'net::ERR_CONNECTION_REFUSED' },
    ]);
    expect(timeline.firstAnomaly).toEqual({
      kind: 'network-error',
      at: 170,
      summary: 'GET http://api.test/orders failed (net::ERR_CONNECTION_REFUSED)',
      ref: { lane: 'network', index: 0 },
    });
  });

  it('does not treat cancelled, test-aborted, client-error or in-flight requests as anomalies', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace([
        request('http://app.test/nav', 150, -1, { status: -1, _failureText: 'net::ERR_ABORTED' }),
        request('http://ads.test/pixel', 151, -1, { status: -1, _failureText: 'net::ERR_FAILED' }, { _wasAborted: true }),
        request('http://app.test/favicon.ico', 152, 3, { status: 404 }),
        request('http://app.test/api/slow', 160, -1, { status: -1 }),
      ]),
    });

    expect(timeline.firstAnomaly).toBeUndefined();
    expect('firstAnomaly' in timeline).toBe(false);
    expect(timeline.lanes.network[3]).toEqual({ start: 160, end: 1_210, method: 'GET', url: 'http://app.test/api/slow', status: -1 });
  });

  it('flags a console error or uncaught page error, but not warnings or network echoes', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace([], [
        { at: 150, level: 'warning', text: 'deprecated API' },
        { at: 160, level: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' },
        { at: 230, level: 'error', text: "Uncaught TypeError: Cannot read properties of undefined (reading 'map')\n    at render" },
      ]),
    });

    expect(timeline.firstAnomaly).toEqual({
      kind: 'console-error',
      at: 230,
      summary: "Console error: Uncaught TypeError: Cannot read properties of undefined (reading 'map')",
      ref: { lane: 'console', index: 2 },
    });
  });

  it('ignores anomalies at or after the failure moment', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_300,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace(
        [request('http://app.test/api/after', 1_190, 20, { status: 503 })],
        [{ at: 1_210, level: 'error', text: 'teardown error' }],
      ),
    });

    expect(timeline.firstAnomaly).toBeUndefined();
  });

  it('picks the earliest anomaly across lanes', () => {
    const timeline = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 1_150,
      steps: STEPS,
      failureAt: 1_210,
      trace: trace(
        [request('http://app.test/api/orders', 170, 300, { status: 500 })],
        [{ at: 400, level: 'error', text: 'later console error' }, { at: 199, level: 'error', text: 'earlier console error' }],
      ),
    });

    expect(timeline.firstAnomaly).toEqual({
      kind: 'console-error',
      at: 199,
      summary: 'Console error: earlier console error',
      ref: { lane: 'console', index: 0 },
    });
  });

  it('flags a test.step slower than 3x its historical average and 1s over it, at the moment it crossed that line', () => {
    const steps = [step('open app', 140, 12), step('load orders', 152, 3_042), step('open first order', 3_194, 908, 'test.step', true)];
    const history = [passed({ 'load orders': 38 }), passed({ 'load orders': 42 }), { ...passed({ 'load orders': 9_000 }), passed: false }];

    const timeline = buildCausalTimeline({ attemptStart: T0, attemptDuration: 4_017, steps, failureAt: 4_094, history });

    expect(timeline.firstAnomaly).toEqual({
      kind: 'slow-step',
      at: 1_192,
      summary: 'Step "load orders" took 3042ms against a historical average of 40ms (2 passing runs)',
      ref: { lane: 'steps', index: 1 },
    });
  });

  it('needs two passing samples and a real excess before calling a step slow', () => {
    const steps = [step('load orders', 152, 3_042), step('open first order', 3_194, 908, 'test.step', true)];

    const oneSample = buildCausalTimeline({ attemptStart: T0, attemptDuration: 4_017, steps, failureAt: 4_094, history: [passed({ 'load orders': 40 })] });
    const smallExcess = buildCausalTimeline({
      attemptStart: T0,
      attemptDuration: 4_017,
      steps: [step('load orders', 152, 1_040), step('open first order', 1_200, 908, 'test.step', true)],
      failureAt: 4_094,
      history: [passed({ 'load orders': 40 }), passed({ 'load orders': 40 })],
    });

    expect(oneSample.firstAnomaly).toBeUndefined();
    expect(smallExcess.firstAnomaly).toBeUndefined();
  });

  it('never calls the failing step itself slow', () => {
    const steps = [step('open first order', 100, 5_000, 'test.step', true)];
    const history = [passed({ 'open first order': 100 }), passed({ 'open first order': 100 })];

    const timeline = buildCausalTimeline({ attemptStart: T0, attemptDuration: 5_100, steps, failureAt: 5_100, history });

    expect(timeline.firstAnomaly).toBeUndefined();
  });

  it('builds a timeline with no anomaly when there is no trace and no history', () => {
    const timeline = buildCausalTimeline({ attemptStart: T0, attemptDuration: 1_150, steps: STEPS, failureAt: 1_210 });

    expect(timeline).toEqual({
      duration: 1_210,
      lanes: {
        steps: [
          { title: 'open app', start: 140, end: 155, category: 'test.step' },
          { title: 'load orders', start: 160, end: 200, category: 'test.step' },
          { title: 'Expect "toHaveCount"', start: 210, end: 1_210, category: 'expect', failed: true },
        ],
        network: [],
        console: [],
      },
    });
  });
});

describe('findFailureMoment', () => {
  const at = (offset: number) => new Date(T0 + offset);
  const s = (category: string, start: number, duration: number, error?: unknown, steps: FailureStep[] = []): FailureStep =>
    ({ category, startTime: at(start), duration, error, steps });

  it('is the end of the last failing step to start', () => {
    const steps = [
      s('hook', 1, 251),
      s('test.step', 269, 41),
      s('expect', 311, 1_017, { message: 'toHaveCount failed' }),
      s('hook', 1_328, 17),
    ];

    expect(findFailureMoment(steps, T0)).toBe(1_328);
  });

  it('is clipped to the start of teardown when a timed-out step ends after teardown began', () => {
    // Step and hook timings recorded from a real "Test timeout of 4000ms exceeded" run.
    const steps = [
      s('hook', 2, 140),
      s('test.step', 158, 3_044),
      s('test.step', 3_202, 911, { message: 'timeout' }, [s('pw:api', 3_202, 33), s('expect', 3_237, 876, { message: 'timeout' })]),
      s('hook', 4_094, 25),
      s('hook', 4_119, 19),
    ];

    expect(findFailureMoment(steps, T0)).toBe(4_094);
  });

  it('falls back to the start of teardown when no step carries the error', () => {
    const steps = [s('hook', 1, 100), s('test.step', 120, 50), s('hook', 900, 20)];

    expect(findFailureMoment(steps, T0)).toBe(900);
  });

  it('is undefined when the steps say nothing about the failure', () => {
    expect(findFailureMoment([], T0)).toBeUndefined();
  });
});

describe('stepDurationsOf', () => {
  it('records test.step durations by title, averaging repeated titles', () => {
    const steps = [step('login', 0, 100), step('page.goto', 0, 999, 'pw:api'), step('login', 200, 300), step('checkout', 600, 50)];

    expect(stepDurationsOf(steps)).toEqual({ login: 200, checkout: 50 });
  });

  it('returns undefined when the test has no test.step steps', () => {
    expect(stepDurationsOf([step('page.goto', 0, 10, 'pw:api')])).toBeUndefined();
  });
});

describe('report data contract', () => {
  it('carries a failed test timeline onto ReportTest.timeline', () => {
    const timeline = buildCausalTimeline({ attemptStart: T0, attemptDuration: 1_150, steps: STEPS, failureAt: 1_210 });

    const data = buildReportData({
      results: [{ testId: 't1', title: 't1', file: 'a.spec.ts', status: 'failed', outcome: 'unexpected', duration: 1_150, retry: 0, steps: STEPS, history: [], timeline }],
      history: { runs: [], tests: {}, summaries: [] },
      startTime: T0,
      options: {},
    });

    expect(data.tests[0].timeline).toEqual(timeline);
  });
});
