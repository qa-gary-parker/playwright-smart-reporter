import type { ReportData, ReportTest } from '../../report-data/schema';
import type { ClusterTracking } from '../../types';
import { isFailedTest } from '../../utils/flakiness';
import { computeRunStats } from '../../utils/run-stats';
import type { TestStatus } from '../components';

export type { ReportData, ReportTest };
export { formatPassRate } from '../../utils/run-stats';

// Playwright's verdict: a test.fail() test that passed is a failure.
export const isFailing: (t: ReportTest) => boolean = isFailedTest;

export function displayStatus(t: ReportTest): TestStatus {
  if (t.outcome === 'flaky') return 'flaky';
  if (t.outcome === 'unexpected' && t.status === 'passed') return 'failed';
  // test.fail() that failed as expected reads as a pass, as the 2.x counts did.
  if (t.outcome === 'expected' && (t.status === 'failed' || t.status === 'timedOut')) return 'passed';
  return t.status;
}

export function isFlaky(t: ReportTest): boolean {
  return displayStatus(t) === 'flaky' || t.signals.includes('flaky');
}

// Playwright's suite path starts with the file, which is not a suite name; the row already shows it as file:line.
export function suiteNames(t: ReportTest): string[] {
  return (t.suites ?? []).filter((s, i) => !(i === 0 && (s === t.file || t.file.endsWith(s))));
}

export function titlePath(t: ReportTest, multiProject: boolean): string[] {
  return [...(multiProject && t.project ? [t.project] : []), ...suiteNames(t), t.title];
}

export function location(t: ReportTest): string {
  return t.line ? `${t.file}:${t.line}` : t.file;
}

export function hasMultipleProjects(tests: ReportTest[]): boolean {
  return new Set(tests.map((t) => t.project).filter(Boolean)).size > 1;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

export function formatDate(iso: string | number, withTime = false): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' });
}

// Same weights and grade bands as the 2.x suite health gauge. With no pass rate (no test ran) there is no grade.
export function suiteHealth(s: { total: number; passRate: number | null; flaky: number; slow: number }) {
  const stability = s.total > 0 ? Math.max(0, 100 - (s.flaky / s.total) * 200) : 100;
  const perf = s.total > 0 ? Math.max(0, 100 - (s.slow / s.total) * 200) : 100;
  if (s.passRate === null) return { score: null, grade: 'n/a', pass: null, stability: Math.round(stability), perf: Math.round(perf) };
  const score = Math.round(s.passRate * 0.5 + stability * 0.3 + perf * 0.2);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  return { score, grade, pass: s.passRate, stability: Math.round(stability), perf: Math.round(perf) };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function clusterLabel(t: ClusterTracking): { text: string; title?: string } {
  if (t.status === 'new') return { text: 'New' };
  if (t.status === 'regressed') return { text: 'Regressed' };
  return { text: `Recurring, ${plural(t.runs, 'run')}`, title: `Since ${formatDate(t.since)}${t.sinceCommit ? ` at ${t.sinceCommit}` : ''}` };
}

// Quote separators and line breaks; prefix formula characters so spreadsheets show them as text.
export function csvCell(v: unknown): string {
  const raw = String(v ?? '');
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Each test lands in exactly one bucket, so the buckets add up to the total: passed leaves out flaky.
export function outcomeCounts(tests: ReportTest[]) {
  const { failed, flaky, passed, skipped } = computeRunStats(tests);
  return { failed, flaky, passed: passed - flaky, skipped };
}

// Three-run moving average, and runs more than two standard deviations from the mean.
// A null value (a run with no pass rate) has neither, and is left out of the window and the mean.
export function trendStats(values: Array<number | null>): { average: Array<number | null>; anomalies: boolean[] } {
  const average = values.map((_, i) => {
    const w = values.slice(Math.max(0, i - 2), i + 1);
    return i < 2 || w.some((v) => v === null) ? null : (w[2]! + w[1]! + w[0]!) / 3;
  });
  const known = values.filter((v): v is number => v !== null);
  const mean = known.reduce((a, b) => a + b, 0) / Math.max(known.length, 1);
  const sd = Math.sqrt(known.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(known.length, 1));
  const anomalies = values.map((v) => v !== null && known.length >= 5 && sd > 0 && Math.abs(v - mean) > 2 * sd);
  return { average, anomalies };
}

// Attachment paths are file paths: a # or % in a test title must not end or garble the URL.
export function fileHref(p: string): string {
  if (/^(data|blob|https?|file):/i.test(p)) return p;
  return p.split('/').map((seg) => (seg === '.' || seg === '..' ? seg : encodeURIComponent(seg))).join('/');
}
