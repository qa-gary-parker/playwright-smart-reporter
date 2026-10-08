import type {
  CausalTimeline,
  StepData,
  TestHistoryEntry,
  TimelineAnomaly,
  TimelineConsoleEvent,
  TimelineRequest,
  TimelineStep,
} from '../types';
import { resourceStartTime, type TraceContents } from '../collectors/trace-reader';

// A test.step is "slow" when it runs longer than both FACTOR x and MIN_EXCESS ms over
// the mean of its durations in at least MIN_SAMPLES previous passing runs.
export const SLOW_STEP_FACTOR = 3;
export const SLOW_STEP_MIN_EXCESS_MS = 1_000;
export const SLOW_STEP_MIN_SAMPLES = 2;

const MAX_LANE_ITEMS = 1_000;
const MAX_TEXT = 500;
const MAX_URL = 2_048;

// Client-side cancellations (navigation away, Chromium/Firefox/WebKit wording) are not failures.
const CANCELLED = /ERR_ABORTED|NS_BINDING_ABORTED|cancell?ed/i;
// Chromium repeats every failed or 4xx/5xx load as a console error; the network lane already has it.
const NETWORK_ECHO = 'Failed to load resource:';

/** The subset of Playwright's TestStep that findFailureMoment reads. */
export interface FailureStep {
  category: string;
  startTime: Date;
  duration: number;
  error?: unknown;
  steps: FailureStep[];
}

export interface CausalTimelineInput {
  attemptStart: number;            // epoch ms, TestResult.startTime
  attemptDuration: number;         // TestResult.duration
  steps: StepData[];               // startTime already an offset from attemptStart
  failureAt?: number;              // offset of the failure moment, see findFailureMoment
  trace?: TraceContents;
  history?: TestHistoryEntry[];    // this test's history before the current run
}

/**
 * Offset of the moment the attempt failed: the end of the last failing step to start,
 * clipped to the start of teardown. A timed-out step is only closed after teardown has
 * begun, so its recorded end would let teardown noise count as "before the failure".
 */
export function findFailureMoment(steps: FailureStep[], attemptStart: number): number | undefined {
  let failing: FailureStep | undefined;
  const visit = (list: FailureStep[]) => {
    for (const step of list) {
      if (step.error && (!failing || step.startTime.getTime() >= failing.startTime.getTime())) failing = step;
      visit(step.steps ?? []);
    }
  };
  visit(steps);

  const bodyStart = failing
    ? failing.startTime.getTime()
    : Math.max(...steps.filter((s) => s.category !== 'hook').map((s) => s.startTime.getTime()));
  if (!Number.isFinite(bodyStart)) return undefined;
  const teardown = steps
    .filter((s) => s.category === 'hook' && s.startTime.getTime() >= bodyStart)
    .map((s) => s.startTime.getTime() - attemptStart);
  const teardownStart = teardown.length > 0 ? Math.min(...teardown) : undefined;

  if (!failing) return teardownStart;
  const failingEnd = failing.startTime.getTime() - attemptStart + failing.duration;
  return teardownStart === undefined ? failingEnd : Math.min(failingEnd, teardownStart);
}

/** Per-run test.step durations to keep in history; repeated titles are averaged. */
export function stepDurationsOf(steps: StepData[]): Record<string, number> | undefined {
  const byTitle = new Map<string, number[]>();
  for (const step of steps) {
    if (step.category !== 'test.step') continue;
    byTitle.set(step.title, [...(byTitle.get(step.title) ?? []), step.duration]);
  }
  if (byTitle.size === 0) return undefined;
  return Object.fromEntries([...byTitle].map(([title, durations]) => [title, Math.round(mean(durations))]));
}

/**
 * Lays a failed attempt's steps, network and console on one axis and suggests the
 * earliest anomaly before the failure. The anomaly is a heuristic, never a diagnosis.
 */
export function buildCausalTimeline(input: CausalTimelineInput): CausalTimeline {
  const { attemptStart } = input;

  const steps: TimelineStep[] = input.steps
    .filter((s) => typeof s.startTime === 'number')
    .map((s) => ({
      title: s.title,
      start: s.startTime!,
      end: s.startTime! + s.duration,
      category: s.category,
      ...(s.failed ? { failed: true } : {}),
    }));

  const aborted = new Set<TimelineRequest>();
  const inFlight = new Set<TimelineRequest>();
  let network: TimelineRequest[] = [];
  const consoleEvents: TimelineConsoleEvent[] = [];
  for (const context of input.trace?.contexts ?? []) {
    for (const snapshot of context.resources) {
      if (!snapshot?.request) continue;
      const startWall = resourceStartTime(snapshot, context.clock);
      if (startWall === undefined) continue;
      const failure = typeof snapshot.response?._failureText === 'string' ? snapshot.response._failureText : undefined;
      const finished = typeof snapshot.time === 'number' && snapshot.time >= 0;
      const start = Math.round(startWall - attemptStart);
      const item: TimelineRequest = {
        start,
        end: finished ? Math.round(startWall + snapshot.time - attemptStart) : start,
        method: String(snapshot.request.method ?? 'GET'),
        url: truncate(String(snapshot.request.url ?? ''), MAX_URL),
        status: typeof snapshot.response?.status === 'number' ? snapshot.response.status : -1,
        ...(failure ? { failure } : {}),
      };
      if (snapshot._wasAborted) aborted.add(item);
      if (!finished && !failure) inFlight.add(item);
      network.push(item);
    }
    for (const event of context.console) {
      consoleEvents.push({ at: Math.round(event.time - attemptStart), level: event.level, text: truncate(event.text, MAX_TEXT) });
    }
  }
  network = network.sort((a, b) => a.start - b.start).slice(0, MAX_LANE_ITEMS);
  const consoleLane = consoleEvents.sort((a, b) => a.at - b.at).slice(0, MAX_LANE_ITEMS);

  // A loop rather than Math.max(...spread): step lists can exceed the argument limit.
  let duration = input.attemptDuration;
  for (const t of [...steps.map((s) => s.end), ...network.map((r) => r.end), ...consoleLane.map((c) => c.at)]) {
    if (t > duration) duration = t;
  }
  for (const request of network) if (inFlight.has(request)) request.end = duration;

  const cutoff = input.failureAt ?? duration;
  const candidates: TimelineAnomaly[] = [];

  network.forEach((r, index) => {
    if (r.status >= 500) {
      candidates.push({ kind: 'network-error', at: r.end, summary: `${r.method} ${r.url} returned ${r.status}`, ref: { lane: 'network', index } });
    } else if (r.failure && !aborted.has(r) && !CANCELLED.test(r.failure)) {
      candidates.push({ kind: 'network-error', at: r.start, summary: `${r.method} ${r.url} failed (${r.failure})`, ref: { lane: 'network', index } });
    }
  });

  consoleLane.forEach((c, index) => {
    if (c.level !== 'error' || c.text.startsWith(NETWORK_ECHO)) return;
    candidates.push({ kind: 'console-error', at: c.at, summary: `Console error: ${truncate(c.text.split('\n')[0], 200)}`, ref: { lane: 'console', index } });
  });

  steps.forEach((s, index) => {
    if (s.category !== 'test.step' || s.failed) return;
    const samples = (input.history ?? [])
      .filter((h) => h.passed && !h.skipped && typeof h.stepDurations?.[s.title] === 'number')
      .map((h) => h.stepDurations![s.title]);
    if (samples.length < SLOW_STEP_MIN_SAMPLES) return;
    const average = mean(samples);
    const threshold = Math.max(average * SLOW_STEP_FACTOR, average + SLOW_STEP_MIN_EXCESS_MS);
    const took = s.end - s.start;
    if (took <= threshold) return;
    candidates.push({
      kind: 'slow-step',
      at: Math.round(s.start + threshold),
      summary: `Step "${s.title}" took ${took}ms against a historical average of ${Math.round(average)}ms (${samples.length} passing runs)`,
      ref: { lane: 'steps', index },
    });
  });

  // Candidates are pushed network, console, steps, so a stable sort keeps that order on ties.
  const firstAnomaly = candidates.filter((c) => c.at < cutoff).sort((a, b) => a.at - b.at)[0];

  return {
    duration,
    lanes: { steps, network, console: consoleLane },
    ...(firstAnomaly ? { firstAnomaly } : {}),
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
