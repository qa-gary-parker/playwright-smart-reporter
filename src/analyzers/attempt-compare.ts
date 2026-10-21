import type { AttemptData, AttemptDiff, AttemptRequestDiff, StepData } from '../types';
import { formatDuration } from '../utils/formatters';

// Pure, so the report UI bundles it too.

export interface StepRow {
  a?: number; // index in the first attempt's steps; absent when only the second attempt has the step
  b?: number;
  differs: boolean;
}

// Above this many LCS cells, the steps between the common start and end are paired by position.
const MAX_ALIGN_CELLS = 1_000_000;

export function stepPath(steps: StepData[], i: number): string[] {
  const path = [steps[i].title];
  // parent always points backwards in pre-order; anything else is bad data, so stop there
  for (let j = i, p = steps[j].parent; p !== undefined && p >= 0 && p < j; j = p, p = steps[j].parent) {
    path.unshift(steps[p].title);
  }
  return path;
}

function stepDiffers(x: StepData, y: StepData): boolean {
  return !!x.failed !== !!y.failed || Math.max(x.duration, y.duration) > 2 * Math.max(1, Math.min(x.duration, y.duration));
}

/** Pairs the steps of two attempts by title path (longest common subsequence), so an extra step shifts nothing. */
export function alignSteps(a: StepData[], b: StepData[]): StepRow[] {
  const key = (steps: StepData[]) => steps.map((_, i) => stepPath(steps, i).join('\u0000'));
  const [ka, kb] = [key(a), key(b)];
  const pairs: Array<[number | undefined, number | undefined]> = [];

  let start = 0;
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) pairs.push([start, start++]);
  let [endA, endB] = [ka.length, kb.length];
  while (endA > start && endB > start && ka[endA - 1] === kb[endB - 1]) [endA, endB] = [endA - 1, endB - 1];

  const [n, m] = [endA - start, endB - start];
  if (n * m > MAX_ALIGN_CELLS) {
    for (let k = 0; k < Math.max(n, m); k++) pairs.push([k < n ? start + k : undefined, k < m ? start + k : undefined]);
  } else {
    // lcs[i * (m + 1) + j]: length of the common subsequence of ka[start + i..endA) and kb[start + j..endB)
    const lcs = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i * (m + 1) + j] = ka[start + i] === kb[start + j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
      }
    }
    let [i, j] = [0, 0];
    while (i < n || j < m) {
      if (i < n && j < m && ka[start + i] === kb[start + j]) pairs.push([start + i++, start + j++]);
      else if (j >= m || (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) pairs.push([start + i++, undefined]);
      else pairs.push([undefined, start + j++]);
    }
  }
  for (let k = 0; endA + k < ka.length; k++) pairs.push([endA + k, endB + k]);

  return pairs.map(([i, j]) => ({
    ...(i !== undefined && { a: i }),
    ...(j !== undefined && { b: j }),
    differs: i === undefined || j === undefined || ka[i] !== kb[j] || stepDiffers(a[i], b[j]),
  }));
}

const said = (a: AttemptData) => (a.status === 'timedOut' ? 'timed out' : a.status);

/** The attempts that did not end with the expected status, and the last one that did. A test.fail() attempt that passed did not. */
export function pickAttempts(attempts: AttemptData[], expected: AttemptData['status'] = 'passed'): { missed: AttemptData[]; met?: AttemptData } {
  const ran = (a: AttemptData) => a.status === 'passed' || a.status === 'failed' || a.status === 'timedOut';
  return { missed: attempts.filter((a) => ran(a) && a.status !== expected), met: [...attempts].reverse().find((a) => a.status === expected) };
}

// The innermost failed step under the first failed top-level branch.
function failedStepIndex(steps: StepData[]): number {
  const first = steps.findIndex((s) => s.failed);
  let best = first;
  for (let i = first + 1; first >= 0 && i < steps.length && (steps[i].depth ?? 0) > (steps[first].depth ?? 0); i++) {
    if (steps[i].failed && (steps[i].depth ?? 0) > (steps[best].depth ?? 0)) best = i;
  }
  return best;
}

/**
 * One line on where the attempts went different ways: the first attempt that missed the expected status
 * against the last one that got it, or each attempt that missed it.
 */
export function divergenceSummary(attempts: AttemptData[], expected?: AttemptData['status']): string | undefined {
  const { missed, met } = pickAttempts(attempts, expected);
  if (missed.length === 0) return undefined;
  const at = (a: AttemptData) => {
    const i = failedStepIndex(a.steps);
    return i < 0 ? undefined : { i, path: stepPath(a.steps, i).join(' › '), took: formatDuration(a.steps[i].duration) };
  };

  if (met) {
    const [f, step] = [missed[0], at(missed[0])];
    if (!step) return `Attempt ${f.retry + 1} ${said(f)} after ${formatDuration(f.duration)}; attempt ${met.retry + 1} ${said(met)} in ${formatDuration(met.duration)}`;
    const b = alignSteps(f.steps, met.steps).find((r) => r.a === step.i)?.b;
    const took = b === undefined ? undefined : formatDuration(met.steps[b].duration);
    const there = !took ? `${said(met)} without it` : met.status === 'passed' ? `passed it in ${took}` : `ran it in ${took} and ${said(met)}`;
    return `Attempt ${f.retry + 1} ${said(f)} at step '${step.path}' after ${step.took}; attempt ${met.retry + 1} ${there}`;
  }

  const steps = missed.map(at);
  if (missed.length < 2 || steps.every((s) => !s)) return undefined;
  if (steps.every((s) => s && s.path === steps[0]!.path)) return `Every attempt failed at step '${steps[0]!.path}'`;
  const line = missed
    .map((a, k) => `attempt ${a.retry + 1} ${said(a)} ${steps[k] ? `at step '${steps[k]!.path}' after ${steps[k]!.took}` : `after ${formatDuration(a.duration)}`}`)
    .join('; ');
  return line[0].toUpperCase() + line.slice(1);
}

// One attempt's requests (first browser context, after the network log filters) and console messages.
export interface AttemptEvidence {
  network?: Array<{ method: string; url: string; status: number }>;
  console: Array<{ level: string; text: string }>;
}

const MAX_DIFF_ROWS = 50;
const MAX_TEXT = 500;
const MAX_URL = 2_048;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

type Request = NonNullable<AttemptEvidence['network']>[number];

/**
 * Requests and console problems that differ between two attempts. Repeated requests pair up in order.
 * Compares the text as recorded; redact masks only the rows kept, before they are cut.
 */
export function diffAttemptEvidence(failed: AttemptEvidence, passed: AttemptEvidence, redact = (text: string) => text): Pick<AttemptDiff, 'network' | 'console'> {
  const diff: Pick<AttemptDiff, 'network' | 'console'> = {};
  if (failed.network && passed.network) {
    const key = (r: Request) => `${r.method} ${r.url}`;
    const queues = new Map<string, Request[]>();
    for (const r of passed.network) {
      const queue = queues.get(key(r));
      if (queue) queue.push(r);
      else queues.set(key(r), [r]);
    }
    const paired = new Set<Request>();
    const rows: Array<[Request, Pick<AttemptRequestDiff, 'failed' | 'passed'>]> = [];
    for (const r of failed.network) {
      const twin = queues.get(key(r))?.shift();
      if (twin) paired.add(twin);
      if (twin?.status !== r.status) rows.push([r, { failed: r.status, ...(twin && { passed: twin.status }) }]);
    }
    for (const r of passed.network) if (!paired.has(r)) rows.push([r, { passed: r.status }]);
    diff.network = rows.slice(0, MAX_DIFF_ROWS).map(([r, statuses]) => ({ method: r.method, url: cut(redact(r.url), MAX_URL), ...statuses }));
  }
  const problem = (c: { level: string }) => /^(error|warn)/i.test(c.level);
  const line = (c: { level: string; text: string }) => `${c.level} ${c.text}`;
  const seen = new Map<string, number>();
  for (const c of passed.console) if (problem(c)) seen.set(line(c), (seen.get(line(c)) ?? 0) + 1);
  const only: AttemptEvidence['console'] = [];
  for (const c of failed.console) {
    if (!problem(c)) continue;
    const n = seen.get(line(c)) ?? 0;
    if (n > 0) seen.set(line(c), n - 1);
    else only.push(c);
  }
  diff.console = only.slice(0, MAX_DIFF_ROWS).map((c) => ({ level: c.level, text: cut(redact(c.text), MAX_TEXT) }));
  return diff;
}

/** The first attempt that missed the expected status and has a trace, against the last one that got it; without both traces, which attempts lack one. */
export function compareAttemptTraces(
  attempts: AttemptData[],
  traces: Map<number, AttemptEvidence | null>,
  redact?: (text: string) => string,
  expected?: AttemptData['status'],
): AttemptDiff | undefined {
  const { missed, met: p } = pickAttempts(attempts, expected);
  const f = missed.find((a) => traces.get(a.retry)) ?? missed[0];
  if (!f || !p) return undefined;
  const [ef, ep] = [traces.get(f.retry), traces.get(p.retry)];
  if (!ef || !ep) return { failed: f.retry, passed: p.retry, missingTrace: [f, p].filter((a) => !traces.get(a.retry)).map((a) => a.retry) };
  return { failed: f.retry, passed: p.retry, ...diffAttemptEvidence(ef, ep, redact) };
}
