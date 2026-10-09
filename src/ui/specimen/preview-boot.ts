import type { ReportData } from '../../report-data/schema';
import fixture from './report-fixture.json';
import { summarizeA11y } from '../../analyzers/a11y-analyzer';
import { SYNTHETIC, SYNTHETIC_COVERAGE } from './synthetic';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'failures';
const data = JSON.parse(JSON.stringify(fixture)) as ReportData;
const textCluster = data.clusters.find((c) => /toHaveText/.test(c.errorType));
data.tests = [{ ...SYNTHETIC, clusterId: textCluster?.id }, ...data.tests];
if (textCluster) textCluster.testIds = [SYNTHETIC.testId, ...textCluster.testIds];
data.a11y = summarizeA11y(data.tests);
data.coverage = SYNTHETIC_COVERAGE;

if (screen === 'green') {
  for (const t of data.tests) {
    if (t.outcome === 'unexpected') {
      t.status = 'passed';
      t.outcome = 'expected';
      t.error = undefined;
      t.signals = t.signals.filter((s) => s !== 'new-failure');
    }
  }
  data.clusters = [];
}

// ?off=gallery,trends turns those features off, as the reporter options would.
for (const feature of params.get('off')?.split(',') ?? []) (data.config.features as unknown as Record<string, boolean>)[feature] = false;

// ?exports=junit,pdf turns those export files on; ?base= sets the report file name.
for (const kind of params.get('exports')?.split(',') ?? []) (data.config.exports as unknown as Record<string, boolean>)[kind] = true;
if (params.get('base')) data.meta.outputBasename = params.get('base')!;

// ?scale=N clones the fixture up to N tests to exercise virtualization.
const scale = Number(params.get('scale') ?? 0);
if (scale > data.tests.length) {
  const base = data.tests;
  data.tests = Array.from({ length: scale }, (_, i) => {
    const t = base[i % base.length];
    // Uniform passing tests keep list order equal to index, so rows are checkable by position.
    return { ...t, testId: `scaled-${i}`, title: `${t.title} #${i}`, file: `scaled/${Math.floor(i / 50)}.spec.ts`, status: 'passed', outcome: 'expected', signals: [] };
  });
}

// One recorded run as a drilldown snapshot, so History can open a past run.
const past = data.trends[data.trends.length - 2];
if (past) {
  data.config.features.historyDrilldown = true;
  data.historySnapshots = {
    [past.runId]: {
      runId: past.runId,
      timestamp: past.timestamp,
      tests: Object.fromEntries(
        data.tests.slice(0, 12).map((t, i) => [
          t.testId,
          { testId: t.testId, title: t.title, file: t.file, status: i < 3 ? 'failed' : 'passed', duration: t.duration, retry: 0, steps: [] },
        ]),
      ),
    },
  };
}

window.__SMART_DATA__ = data;

try {
  localStorage.removeItem('smart-reporter:theme');
  localStorage.removeItem('smart-reporter:sections');
} catch {
  // storage may be unavailable
}
const mode = params.get('mode');
if (mode && mode !== 'system') document.documentElement.dataset.mode = mode;
const accent = params.get('accent');
if (accent && accent !== 'default') document.documentElement.dataset.accent = accent;

const test = params.get('test');
const HASH: Record<string, string> = {
  failures: '#/q/failures',
  flaky: '#/q/flaky',
  // No hash: the app picks the landing view itself.
  landing: '',
  green: '',
  all: '#/q/all',
  insights: '#/insights',
  history: `#/history/${params.get('tab') ?? 'trends'}`,
  gallery: '#/gallery',
  live: '#/live',
  a11y: '#/a11y',
  coverage: '#/coverage',
  keymap: '#/q/failures',
};
// An explicit hash is a deep link under test; keep it.
const target = HASH[screen] ?? '#/q/failures';
if (!location.hash && target) location.replace(`${target}${test ? `?test=${encodeURIComponent(test)}` : ''}`);
