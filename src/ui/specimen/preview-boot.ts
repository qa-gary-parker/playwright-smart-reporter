import type { ReportData } from '../../report-data/schema';
import fixture from './report-fixture.json';
import { summarizeA11y } from '../../analyzers/a11y-analyzer';
import { SYNTHETIC, SYNTHETIC_CLUSTER, SYNTHETIC_COVERAGE } from './synthetic';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'failures';
const data = JSON.parse(JSON.stringify(fixture)) as ReportData;
const syntheticCluster = { ...SYNTHETIC_CLUSTER, testIds: [...SYNTHETIC_CLUSTER.testIds] };
data.tests = [{ ...SYNTHETIC, clusterId: syntheticCluster.id }, ...data.tests];
data.clusters = [...data.clusters, syntheticCluster];
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
} else {
  // Cluster tracking as history gives it: the synthetic cluster is new, the others failed in the last 4 runs,
  // and a cluster of the baseline run went away.
  const runs = data.trends;
  for (const c of data.clusters) {
    const n = c.testIds.length;
    c.tracking = c === syntheticCluster
      ? { status: 'new', runs: 1, since: runs[runs.length - 1].timestamp, trend: runs.map((_, i) => (i === runs.length - 1 ? n : 0)) }
      : { status: 'recurring', runs: 4, since: runs[runs.length - 4].timestamp, sinceCommit: 'a1b2c3d4', trend: runs.map((_, i) => (i < runs.length - 4 ? 0 : n)) };
  }
  const recovered = data.tests.filter((t) => t.status === 'passed' && t.outcome === 'expected').slice(0, 2);
  data.resolvedClusters = [{ id: 'c0ffee0123456789', testIds: recovered.map((t) => t.testId) }];
}

// ?commits=on: where the recurring cluster and a new failure started, with the files changed in between for the failure.
if (params.get('commits') === 'on') {
  const range = {
    lastPassed: { commit: '9f8e7d6c', sha: '9f8e7d6c'.repeat(5) },
    firstFailed: { commit: 'a1b2c3d4', sha: 'a1b2c3d4'.repeat(5) },
    url: `https://github.com/acme/shop/compare/${'9f8e7d6c'.repeat(5)}...${'a1b2c3d4'.repeat(5)}`,
  };
  for (const c of data.clusters) if (c.tracking?.status === 'recurring') c.tracking.commits = range;
  const failure = data.tests.find((t) => t.testId === '[Desktop Chrome] demo.spec.ts::broken login - element not found')!;
  failure.signals = [...failure.signals, 'new-failure'];
  failure.commits = { ...range, suspects: ['src/login/form.tsx', 'tests/demo.spec.ts'] };
}

// ?off=gallery,trends turns those features off, as the reporter options would.
for (const feature of params.get('off')?.split(',') ?? []) (data.config.features as unknown as Record<string, boolean>)[feature] = false;

// ?exports=junit,pdf turns those export files on; ?base= sets the report file name.
for (const kind of params.get('exports')?.split(',') ?? []) (data.config.exports as unknown as Record<string, boolean>)[kind] = true;
if (params.get('base')) data.meta.outputBasename = params.get('base')!;

// ?ai=off: AI was switched off by enableAIRecommendations: false.
if (params.get('ai') === 'off') data.ai = { ...data.ai, analysisOff: true, summaryOff: true };

// ?gates=scoped: a named rule that failed and a scoped warn rule that was breached.
if (params.get('gates') === 'scoped') {
  data.gates = {
    passed: false,
    rules: [
      { rule: 'minPassRate', passed: false, actual: '90%', threshold: '≥ 100%', id: 'critical paths', scope: 'tag @critical' },
      { rule: 'maxFlakyRate', passed: false, actual: '50%', threshold: '≤ 2%', scope: 'project chromium', severity: 'warn' },
    ],
  };
}

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
