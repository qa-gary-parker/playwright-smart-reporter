import type { AttemptData, StepData } from '../types';
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

const isFailedAttempt = (a: AttemptData) => a.status === 'failed' || a.status === 'timedOut';
const ended = (a: AttemptData) => (a.status === 'timedOut' ? 'timed out' : 'failed');

// The innermost failed step under the first failed top-level branch.
function failedStepIndex(steps: StepData[]): number {
  const first = steps.findIndex((s) => s.failed);
  let best = first;
  for (let i = first + 1; first >= 0 && i < steps.length && (steps[i].depth ?? 0) > (steps[first].depth ?? 0); i++) {
    if (steps[i].failed && (steps[i].depth ?? 0) > (steps[best].depth ?? 0)) best = i;
  }
  return best;
}

/** One line on where the attempts went different ways: the first failed attempt against the passing one, or each failed attempt. */
export function divergenceSummary(attempts: AttemptData[]): string | undefined {
  const failed = attempts.filter(isFailedAttempt);
  const passed = [...attempts].reverse().find((a) => a.status === 'passed');
  if (failed.length === 0) return undefined;
  const at = (a: AttemptData) => {
    const i = failedStepIndex(a.steps);
    return i < 0 ? undefined : { i, path: stepPath(a.steps, i).join(' › '), took: formatDuration(a.steps[i].duration) };
  };

  if (passed) {
    const [f, step] = [failed[0], at(failed[0])];
    if (!step) return `Attempt ${f.retry + 1} ${ended(f)} after ${formatDuration(f.duration)}; attempt ${passed.retry + 1} passed in ${formatDuration(passed.duration)}`;
    const b = alignSteps(f.steps, passed.steps).find((r) => r.a === step.i)?.b;
    const there = b === undefined ? 'passed without it' : `passed it in ${formatDuration(passed.steps[b].duration)}`;
    return `Attempt ${f.retry + 1} ${ended(f)} at step '${step.path}' after ${step.took}; attempt ${passed.retry + 1} ${there}`;
  }

  const steps = failed.map(at);
  if (failed.length < 2 || steps.every((s) => !s)) return undefined;
  if (steps.every((s) => s && s.path === steps[0]!.path)) return `Every attempt failed at step '${steps[0]!.path}'`;
  const line = failed
    .map((a, k) => `attempt ${a.retry + 1} ${ended(a)} ${steps[k] ? `at step '${steps[k]!.path}' after ${steps[k]!.took}` : `after ${formatDuration(a.duration)}`}`)
    .join('; ');
  return line[0].toUpperCase() + line.slice(1);
}
