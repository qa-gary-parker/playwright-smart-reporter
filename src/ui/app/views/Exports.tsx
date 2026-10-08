import { Button, Dialog, Icon, Menu, MiniBar } from '../../components';
import { displayStatus, formatDate, formatDuration, isFailing } from '../data';
import { data, runTests, summaryOpen } from '../store';
import { copyText } from './Detail';

function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(): void {
  const header = ['Title', 'File', 'Line', 'Project', 'Status', 'Duration (ms)', 'Retries', 'Flakiness', 'Grade', 'Tags'];
  const rows = runTests.value.map((t) => [
    t.title,
    t.file,
    t.line ?? '',
    t.project ?? '',
    displayStatus(t),
    t.duration,
    t.retry,
    t.flakinessScore ?? '',
    t.stabilityScore?.grade ?? '',
    (t.tags ?? []).join(' '),
  ]);
  download(`test-results-${stamp()}.csv`, 'text/csv;charset=utf-8', [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
}

export function exportJson(): void {
  const d = data.value;
  const tests = runTests.value.map(({ attachments: _a, networkLogs: _n, ...t }) => t);
  download(`test-results-${stamp()}.json`, 'application/json', JSON.stringify({ meta: d.meta, summary: d.summary, tests }, null, 2));
}

export function summaryMarkdown(): string {
  const d = data.value;
  const s = d.summary;
  const failing = runTests.value.filter(isFailing);
  const lines = [
    `**Test run ${formatDate(d.meta.startTime, true)}**${d.meta.ci?.branch ? ` on \`${d.meta.ci.branch}\`` : ''}`,
    `${s.passed} passed · ${s.failed} failed · ${s.flaky} flaky · ${s.skipped} skipped · ${s.passRate}% pass rate · ${formatDuration(s.duration)}`,
  ];
  if (d.gates) lines.push(`Quality gate: ${d.gates.passed ? 'passed' : 'failed'}`);
  if (failing.length) {
    lines.push('', 'Failures:');
    for (const t of failing.slice(0, 10)) lines.push(`- ${t.title} (\`${t.file}${t.line ? `:${t.line}` : ''}\`)`);
    if (failing.length > 10) lines.push(`- and ${failing.length - 10} more`);
  }
  return lines.join('\n');
}

export function SummaryDialog() {
  const s = data.value.summary;
  return (
    <Dialog
      open={summaryOpen.value}
      onClose={() => (summaryOpen.value = false)}
      title="Summary card"
      footer={
        <>
          <Button onClick={() => (summaryOpen.value = false)}>Close</Button>
          <Button variant="primary" icon="copy" onClick={() => copyText(summaryMarkdown(), 'Summary copied')}>
            Copy as Markdown
          </Button>
        </>
      }
    >
      <div class="summary-card">
        <MiniBar
          segments={[
            { tone: 'pass', value: s.passed - s.flaky > 0 ? s.passed - s.flaky : s.passed, label: 'passed' },
            { tone: 'fail', value: s.failed, label: 'failed' },
            { tone: 'flaky', value: s.flaky, label: 'flaky' },
            { tone: 'skip', value: s.skipped, label: 'skipped' },
          ]}
        />
        <pre class="summary-card__text">{summaryMarkdown()}</pre>
      </div>
    </Dialog>
  );
}

export function ExportMenu() {
  const d = data.value;
  const base = d.meta.outputBasename;
  const items = [
    { id: 'summary', label: 'Summary card', icon: 'clipboard', kbd: 'e' },
    { id: 'json', label: 'Results as JSON', icon: 'braces' },
    { id: 'csv', label: 'Results as CSV', icon: 'table' },
    ...(d.config.exports.pdf
      ? [
          { id: 'pdf:', label: 'PDF report', icon: 'file-text', group: 'Files' },
          { id: 'pdf:-dark', label: 'PDF report, dark', icon: 'file-text', group: 'Files' },
          { id: 'pdf:-minimal', label: 'PDF report, minimal', icon: 'file-text', group: 'Files' },
        ]
      : []),
    ...(d.config.exports.json ? [{ id: 'file:-data.json', label: 'Full data (JSON)', icon: 'braces', group: 'Files' }] : []),
    ...(d.config.exports.junit ? [{ id: 'file:-junit.xml', label: 'JUnit XML', icon: 'file', group: 'Files' }] : []),
  ].map((it) => ({ group: 'Export', ...it }));
  return (
    <Menu
      label="Export"
      items={items}
      onSelect={(id) => {
        if (id === 'summary') summaryOpen.value = true;
        else if (id === 'json') exportJson();
        else if (id === 'csv') exportCsv();
        else if (id.startsWith('pdf:')) window.open(`./${base}${id.slice(4)}.pdf`, '_blank');
        else if (id.startsWith('file:')) window.open(`./${base}${id.slice(5)}`, '_blank');
      }}
    >
      <Icon name="download" />
      <span class="hide-narrow">Export</span>
    </Menu>
  );
}
