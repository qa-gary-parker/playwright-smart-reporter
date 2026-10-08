import type { JsonExportData } from '../generators/json-exporter';
import { ruleLabels } from '../gates/quality-gate-reporter';
import { formatDuration } from '../utils/formatters';
import { failureLocation, isFailure, testLabel } from './annotations';

const LIST_LIMIT = 10;
const SLOWEST_LIMIT = 5;

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
    : `**Passed:** ${summary.passed} of ${summary.total} tests passed.`);
  out.push('');
  out.push(...table(
    ['Pass rate', 'Passed', 'Failed', 'Flaky', 'Skipped', 'Duration'],
    [[`${summary.passRate}%`, String(summary.passed), String(summary.failed), String(summary.flaky), String(summary.skipped), formatDuration(summary.duration)]],
  ));

  const gates = data.qualityGates;
  if (gates) {
    const checked = gates.rules.filter((r) => !r.skipped);
    const breached = checked.filter((r) => !r.passed);
    out.push('', gates.passed
      ? `**Quality gates: passed** (${checked.length} of ${checked.length} rules passed)`
      : `**Quality gates: failed** (${breached.length} of ${checked.length} rules breached)`);
    out.push('', ...table(['Rule', 'Actual', 'Threshold', 'Result'], gates.rules.map((r) => [
      ruleLabels[r.rule] ?? r.rule,
      r.actual,
      r.threshold,
      r.skipped ? 'Skipped' : r.passed ? 'Passed' : 'Failed',
    ])));
  }

  if (failures.length > 0) {
    // New failures (failed now, passed in the baseline run) are listed first and marked.
    const newIds = new Set((data.comparison?.changes.newFailures ?? []).map((t) => t.testId));
    const fresh = failures.filter((t) => newIds.has(t.testId));
    const ordered = [...fresh, ...failures.filter((t) => !newIds.has(t.testId))];
    out.push('', data.comparison ? `### Failures (${failures.length}, ${fresh.length} new)` : `### Failures (${failures.length})`, '');
    out.push(...table(['Test', 'Location'], ordered.slice(0, LIST_LIMIT).map((t) => {
      const loc = failureLocation(t, data.metadata.rootDir, opts.workspace);
      const label = newIds.has(t.testId) ? `**New** ${code(testLabel(t))}` : code(testLabel(t));
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
