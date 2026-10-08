import type { CodeLine } from '../components';
import { displayStatus, formatDuration, isFailing, location, type ReportTest } from './data';

export interface Timeline {
  duration: number;
  lanes: {
    steps: Array<{ title: string; start: number; end: number; category: string; failed?: boolean }>;
    network: Array<{ start: number; end: number; method: string; url: string; status: number }>;
    console: Array<{ at: number; level: string; text: string }>;
  };
  firstAnomaly?: { kind: 'network-error' | 'console-error' | 'slow-step'; at: number; summary: string; ref: { lane: 'network' | 'console' | 'steps'; index: number } };
}

export function timelineOf(t: ReportTest): Timeline | undefined {
  return (t as ReportTest & { timeline?: Timeline }).timeline;
}

export function parseExpectation(error?: string): { expected: string; received: string } | undefined {
  if (!error) return undefined;
  const expected = error.match(/^\s*Expected(?: [a-z ]+)?: (.+)$/m)?.[1];
  const received = error.match(/^\s*Received(?: [a-z ]+)?: (.+)$/m)?.[1];
  return expected !== undefined && received !== undefined ? { expected, received } : undefined;
}

export function parseSnippet(snippet?: string): { lines: CodeLine[]; highlight?: number; column?: number } | undefined {
  if (!snippet) return undefined;
  const lines: CodeLine[] = [];
  let highlight: number | undefined;
  let column: number | undefined;
  for (const raw of snippet.split('\n')) {
    const code = raw.match(/^(\s*>)?\s*(\d+) \|(?: (.*))?$/);
    if (code) {
      const n = Number(code[2]);
      lines.push({ n, text: code[3] ?? '' });
      if (code[1]) highlight = n;
      continue;
    }
    const caret = raw.match(/^\s*\| (\s*)\^/);
    if (caret) column = caret[1].length + 1;
  }
  return lines.length ? { lines, highlight, column } : undefined;
}

// Index of the step that failed: the timeline knows; otherwise the last assertion or API step.
export function failingStepIndex(t: ReportTest): number {
  if (!isFailing(t)) return -1;
  const timeline = timelineOf(t);
  if (timeline) {
    const i = timeline.lanes.steps.findIndex((s) => s.failed);
    if (i >= 0) {
      const title = timeline.lanes.steps[i].title;
      const match = t.steps.findIndex((s) => s.title === title);
      if (match >= 0) return match;
    }
  }
  for (let i = t.steps.length - 1; i >= 0; i--) {
    if (t.steps[i].category === 'expect' || t.steps[i].category === 'pw:api') return i;
  }
  return t.steps.length - 1;
}

export function failureSummary(t: ReportTest, path: string[], run?: { branch?: string; commit?: string }): string {
  const head = `**${displayStatus(t).toUpperCase()}** ${path.join(' › ')}`;
  const where = [`\`${location(t)}\``, t.project, formatDuration(t.duration), t.retry > 0 ? `${t.retry + 1} attempts` : '']
    .filter(Boolean)
    .join(' · ');
  const error = (t.error ?? '').split('\n').filter((l) => !/^\s+at /.test(l)).slice(0, 12).join('\n').trim();
  const ctx = run?.branch || run?.commit ? `\nRun: ${[run.branch, run.commit].filter(Boolean).join(' @ ')}` : '';
  return `${head}\n${where}${error ? `\n\`\`\`\n${error}\n\`\`\`` : ''}${ctx}`;
}
