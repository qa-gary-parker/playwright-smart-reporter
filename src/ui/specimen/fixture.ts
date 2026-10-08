// Screen fixture for D2. Real tests come from the example suite (fixture.json).
// One synthetic test carries the sections the example run lacks: AI analysis,
// network, console, code frame, a 40-line stack, and 3 retries.
import type { CodeLine, Signal, TestStatus } from '../components';
import raw from './fixture.json';

export interface Step {
  title: string;
  duration: number;
  category?: string | null;
  failed?: boolean;
}

export interface Run {
  status: TestStatus;
  duration: number;
  timestamp: string;
}

export interface NetworkEntry {
  method: string;
  status: number;
  url: string;
  duration: number;
}

export interface FxTest {
  id: string;
  path: string[];
  file: string;
  line?: number;
  project: string;
  status: TestStatus;
  duration: number;
  attempts: number;
  error?: string;
  expected?: string;
  received?: string;
  steps: Step[];
  history: Run[];
  tags: string[];
  flakiness: number;
  grade?: string;
  avgDuration?: number;
  signals: Signal[];
  cluster?: string;
  attachments: { screenshots: number; videos: number; traces: number };
  code?: { file: string; lines: CodeLine[]; highlight: number; column: number };
  network?: NetworkEntry[];
  console?: Array<{ level: 'error' | 'warning' | 'log'; text: string }>;
  ai?: string;
  synthetic?: boolean;
}

export interface RunSummary {
  timestamp: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  slow: number;
  duration: number;
  passRate: number;
}

type RawTest = (typeof raw.tests)[number];

const multiProject = new Set(raw.tests.map((t) => t.project)).size > 1;

function statusOf(t: RawTest): TestStatus {
  if (t.outcome === 'flaky') return 'flaky';
  return t.status as TestStatus;
}

function clusterOf(error: string | null | undefined): string | undefined {
  if (!error) return undefined;
  const matcher = error.match(/expect\(.*?\)\.(\w+)\(/)?.[1];
  return matcher ? `${matcher} failed` : error.split('\n')[0].slice(0, 60);
}

function adapt(t: RawTest): FxTest {
  const status = statusOf(t);
  const history: Run[] = t.history.map((h) => ({
    status: h.skipped ? 'skipped' : h.passed ? (h.retry > 0 ? 'flaky' : 'passed') : 'failed',
    duration: h.duration,
    timestamp: h.timestamp,
  }));
  const failing = status === 'failed' || status === 'timedOut';
  const signals: Signal[] = [];
  const prev = history[history.length - 2];
  if (failing && prev && prev.status !== 'failed') signals.push('new-failure');
  if (t.isRegression) signals.push('regression');
  if (t.flakinessScore !== null && t.flakinessScore > 0.1 && t.flakinessScore < 1) signals.push('flaky');
  if (t.duration >= 5000) signals.push('slow');
  const diff = t.error?.match(/Expected[^:\n]*: ([^\n]*)\nReceived[^:\n]*: ([^\n]*)/);
  return {
    id: t.id,
    path: multiProject ? [t.project, t.title] : [t.title],
    file: t.file,
    line: Number(t.error?.match(/\.spec\.ts:(\d+):\d+/)?.[1]) || undefined,
    project: t.project,
    status,
    duration: t.duration,
    attempts: t.retry + 1,
    error: t.error ?? undefined,
    expected: diff?.[1],
    received: diff?.[2],
    steps: t.steps,
    history,
    tags: t.tags,
    flakiness: t.flakinessScore ?? 0,
    grade: t.grade ?? undefined,
    avgDuration: t.averageDuration ?? undefined,
    signals,
    cluster: failing ? clusterOf(t.error) : undefined,
    attachments: t.attachments,
  };
}

const STACK = [
  'Error: expect(locator).toHaveText(expected) failed',
  '',
  "Locator: getByRole('heading', { level: 1 })",
  'Expected string: "Order confirmed"',
  'Received string: "Payment declined"',
  'Timeout: 5000ms',
  '',
  'Call log:',
  '  - Expect "toHaveText" with timeout 5000ms',
  "  - waiting for getByRole('heading', { level: 1 })",
  ...Array.from({ length: 9 }, (_, i) => [
    `    - locator resolved to <h1 class="checkout__title">Payment declined</h1>`,
    `    - unexpected value "Payment declined" (attempt ${i + 1})`,
  ]).flat(),
  '',
  '    at checkout/payments/saved-card.spec.ts:142:58',
  '    at checkout/payments/fixtures.ts:31:5',
  '    at Proxy.<anonymous> (checkout/payments/fixtures.ts:12:7)',
  '    at TestRunner.runTest (node_modules/@playwright/test/lib/worker/workerMain.js:391:9)',
  '    at WorkerMain._runTest (node_modules/@playwright/test/lib/worker/workerMain.js:342:5)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
  '    at async WorkerMain.runTestGroup (node_modules/@playwright/test/lib/worker/workerMain.js:209:7)',
  '    at async Promise.all (index 0)',
].join('\n');

const SYNTHETIC: FxTest = {
  id: 'synthetic::saved-card',
  synthetic: true,
  path: ['checkout', 'saved cards', 'pays with a saved card and applies the loyalty discount when the basket holds a subscription'],
  file: 'checkout/payments/saved-card.spec.ts',
  line: 142,
  project: 'Desktop Chrome',
  status: 'failed',
  duration: 6412,
  attempts: 4,
  error: STACK,
  expected: '"Order confirmed"',
  received: '"Payment declined"',
  steps: [
    { title: 'Before hooks', duration: 412, category: 'hook' },
    { title: "page.goto('/basket')", duration: 980, category: 'pw:api' },
    { title: "getByRole('button', { name: 'Checkout' }).click()", duration: 214, category: 'pw:api' },
    { title: "getByLabel('Saved card ending 4242').check()", duration: 88, category: 'pw:api' },
    { title: "getByRole('button', { name: 'Pay' }).click()", duration: 156, category: 'pw:api' },
    { title: "expect(getByRole('heading', { level: 1 })).toHaveText('Order confirmed')", duration: 5000, category: 'expect', failed: true },
    { title: 'After hooks', duration: 61, category: 'hook' },
  ],
  history: Array.from({ length: 20 }, (_, i): Run => ({
    status: i === 19 ? 'failed' : i === 7 || i === 13 ? 'flaky' : 'passed',
    duration: 1800 + ((i * 137) % 400) + (i === 19 ? 4600 : 0),
    timestamp: new Date(Date.UTC(2026, 7, 13 + i)).toISOString(),
  })),
  tags: ['@payments', '@smoke'],
  flakiness: 0.15,
  grade: 'B',
  avgDuration: 1990,
  signals: ['new-failure', 'regression', 'slow'],
  cluster: 'toHaveText failed',
  attachments: { screenshots: 1, videos: 1, traces: 1 },
  code: {
    file: 'checkout/payments/saved-card.spec.ts',
    highlight: 142,
    column: 58,
    lines: [
      { n: 138, text: "    await page.getByLabel('Saved card ending 4242').check();" },
      { n: 139, text: "    await page.getByRole('button', { name: 'Pay' }).click();" },
      { n: 140, text: '' },
      { n: 141, text: '    // Loyalty discount applies to subscription baskets only.' },
      { n: 142, text: "    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order confirmed');" },
      { n: 143, text: "    await expect(page.getByTestId('discount-line')).toContainText('-10%');" },
      { n: 144, text: '  });' },
    ],
  },
  network: [
    { method: 'GET', status: 200, url: '/api/basket', duration: 84 },
    { method: 'GET', status: 200, url: '/api/cards?saved=true', duration: 121 },
    { method: 'POST', status: 200, url: '/api/loyalty/quote', duration: 233 },
    { method: 'POST', status: 502, url: '/api/payments/charge', duration: 3012 },
    { method: 'GET', status: 200, url: '/checkout/declined', duration: 47 },
  ],
  console: [
    { level: 'error', text: 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)' },
    { level: 'warning', text: 'loyalty: quote expired before charge, retrying once' },
  ],
  ai: 'The charge request to /api/payments/charge returned 502 after 3.0s, so the app rendered the declined page. The assertion failed because of the backend response, not the locator. This test passed in 18 of the last 19 runs. Check the payments service for this run before changing the test. If the gateway is expected to be unstable in this environment, mock /api/payments/charge in the test.',
};

const tests = [SYNTHETIC, ...raw.tests.map(adapt)];

export const FIXTURE = {
  stats: raw.stats,
  summaries: raw.summaries as RunSummary[],
  tests,
  run: { branch: 'main', commit: 'a1b2c3d', ci: 'GitHub Actions #482', timestamp: '2026-09-01T10:34:30.164Z', duration: raw.stats.totalDuration },
};

// The same run with every failure turned green, for the all-passed landing.
export const GREEN_FIXTURE = {
  ...FIXTURE,
  tests: tests.map((t) =>
    t.status === 'failed' || t.status === 'timedOut'
      ? { ...t, status: 'passed' as TestStatus, signals: t.signals.filter((s) => s !== 'new-failure'), cluster: undefined, error: undefined }
      : t,
  ),
};

export type Fixture = typeof FIXTURE;
