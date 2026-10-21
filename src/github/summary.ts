import type { JsonExportData } from '../generators/json-exporter';
import type { CommitRange } from '../types';
import { isWarning, ruleLabel } from '../gates/quality-gate-reporter';
import { formatDuration } from '../utils/formatters';
import { formatPassRate } from '../utils/run-stats';
import { failureLocation, isFailure, testLabel } from './annotations';

const LIST_LIMIT = 10;
const SLOWEST_LIMIT = 5;
const SUSPECT_LIMIT = 5;

// Code spans stop @mentions, #refs and HTML in test titles from rendering; pipes still need escaping inside tables.
function code(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ');
  const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longestRun + 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`.replace(/\|/g, '\\|');
}

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
}

// Where a new failure started, and the files changed since it last passed
function commitsLine(c: CommitRange): string {
  const to = code(c.firstFailed.commit);
  const same = c.lastPassed?.commit === c.firstFailed.commit;
  const at = same
    ? `No code change: last passed and first failed at ${to}`
    : `${c.lastPassed ? `Last passed at ${code(c.lastPassed.commit)}, first` : 'First'} failed at ${to}`;
  const link = c.url ? ` ([${c.lastPassed && !same ? 'compare' : 'commit'}](${c.url}))` : '';
  const files = c.suspects ?? [];
  const extra = files.length > SUSPECT_LIMIT ? `, and ${files.length - SUSPECT_LIMIT} more` : '';
  return `<br>${at}${link}${files.length ? `<br>Changed: ${files.slice(0, SUSPECT_LIMIT).map(code).join(', ')}${extra}` : ''}`;
}

function more(total: number): string[] {
  return total > LIST_LIMIT ? ['', `And ${total - LIST_LIMIT} more in the full report.`] : [];
}

export interface SummaryOptions {
  reportUrl?: string;
  workspace: string;
}

export function renderSummary(data: JsonExportData, opts: SummaryOptions): string {
  const { summary } = data;
  const failures = data.tests.filter(isFailure);
  const out: string[] = [];

  out.push('## Playwright Smart Reporter', '');
  out.push(summary.failed > 0
    ? `**Failed:** ${summary.failed} of ${summary.total} tests failed.`
    : summary.total === 0
      ? '**No tests ran.**'
      : summary.passed === 0
        ? `**Skipped:** all ${summary.total} tests were skipped.`
        : `**Passed:** ${summary.passed} of ${summary.total} tests passed.`);
  out.push('');
  out.push(...table(
    ['Pass rate', 'Passed', 'Failed', 'Flaky', 'Skipped', 'Duration'],
    [[formatPassRate(summary.passRate), String(summary.passed), String(summary.failed), String(summary.flaky), String(summary.skipped), formatDuration(summary.duration)]],
  ));

  const base = data.comparison?.baselineRun.ciInfo;
  const baseAt = [base?.branch, base?.commit].filter((s): s is string => !!s).map(code).join(' @ ');
  if (baseAt) out.push('', `**Baseline run:** ${baseAt}`);

  const gates = data.qualityGates;
  if (gates) {
    const checked = gates.rules.filter((r) => !r.skipped);
    const warnings = checked.filter(isWarning).length;
    const breached = checked.filter((r) => !r.passed).length - warnings;
    const warningText = `${warnings} warning${warnings === 1 ? '' : 's'}`;
    out.push('', gates.passed
      ? `**Quality gates: passed${warnings ? ` with ${warningText}` : ''}** (${checked.length - warnings} of ${checked.length} rules passed)`
      : `**Quality gates: failed** (${breached} of ${checked.length} rules breached${warnings ? `, ${warningText}` : ''})`);
    out.push('', ...table(['Rule', 'Actual', 'Threshold', 'Result'], gates.rules.map((r) => [
      ruleLabel(r),
      r.actual,
      r.threshold,
      r.skipped ? 'Skipped' : r.passed ? 'Passed' : isWarning(r) ? 'Warning' : 'Failed',
    ])));
  }

  if (failures.length > 0) {
    // New failures and failing new tests are listed first and marked, as noNewFailures counts both.
    const newIds = new Set([...(data.comparison?.changes.newFailures ?? []), ...(data.comparison?.changes.newTests ?? [])].map((t) => t.testId));
    const absentIds = new Set((data.comparison?.changes.notInBaseline ?? []).map((t) => t.testId));
    const fresh = failures.filter((t) => newIds.has(t.testId));
    const absent = failures.filter((t) => absentIds.has(t.testId)).length;
    const ordered = [...fresh, ...failures.filter((t) => !newIds.has(t.testId))];
    out.push('', data.comparison
      ? `### Failures (${failures.length}, ${fresh.length} new${absent ? `, ${absent} not in baseline` : ''})`
      : `### Failures (${failures.length})`, '');
    out.push(...table(['Test', 'Location'], ordered.slice(0, LIST_LIMIT).map((t) => {
      const loc = failureLocation(t, data.metadata.rootDir, opts.workspace);
      const mark = newIds.has(t.testId) ? '**New** ' : absentIds.has(t.testId) ? '**Not in baseline** ' : '';
      const label = `${mark}${code(testLabel(t))}${t.commits ? commitsLine(t.commits) : ''}`;
      return [label, code(loc.line !== undefined ? `${loc.file}:${loc.line}` : loc.file)];
    })), ...more(ordered.length));
  }

  const flaky = data.tests.filter((t) => t.outcome === 'flaky');
  if (flaky.length > 0) {
    out.push('', `### Flaky tests (${flaky.length})`, '', ...table(['Test', 'Passed on retry'], flaky.slice(0, LIST_LIMIT).map((t) => [
      code(testLabel(t)), String(t.retry),
    ])), ...more(flaky.length));
  }

  const slowest = data.tests
    .filter((t) => t.status !== 'skipped')
    .sort((a, b) => b.duration - a.duration)
    .slice(0, SLOWEST_LIMIT);
  if (slowest.length > 0) {
    out.push('', '### Slowest tests', '', ...table(['Test', 'Duration'], slowest.map((t) => [code(testLabel(t)), formatDuration(t.duration)])));
  }

  if (opts.reportUrl) out.push('', `[Open the full report](${opts.reportUrl})`);
  return `${out.join('\n')}\n`;
}
