// One synthetic failure that carries every detail section the example run lacks:
// AI analysis, a code frame, network and console context, a causal timeline,
// four attempts, and a 40-line stack. Marked synthetic in its tags.
import type { ReportData, ReportTest } from '../../report-data/schema';

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
    '    - locator resolved to <h1 class="checkout__title">Payment declined</h1>',
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

const SNIPPET = [
  "  139 |     await page.getByRole('button', { name: 'Pay' }).click();",
  '  140 |',
  '  141 |     // Loyalty discount applies to subscription baskets only.',
  "> 142 |     await expect(page.getByRole('heading', { level: 1 })).toHaveText('Order confirmed');",
  '      |                                                          ^',
  "  143 |     await expect(page.getByTestId('discount-line')).toContainText('-10%');",
  '  144 |   });',
].join('\n');

const STEPS = [
  { title: 'Before Hooks', duration: 412, category: 'hook' },
  { title: "page.goto('/basket')", duration: 980, category: 'pw:api' },
  { title: "getByRole('button', { name: 'Checkout' }).click()", duration: 214, category: 'pw:api' },
  { title: "getByLabel('Saved card ending 4242').check()", duration: 88, category: 'pw:api' },
  { title: "getByRole('button', { name: 'Pay' }).click()", duration: 156, category: 'pw:api' },
  { title: "expect(getByRole('heading', { level: 1 })).toHaveText('Order confirmed')", duration: 5000, category: 'expect' },
  { title: 'After Hooks', duration: 61, category: 'hook' },
];

const NETWORK = [
  { method: 'GET', status: 200, url: '/api/basket', start: 420, duration: 84 },
  { method: 'GET', status: 200, url: '/api/cards?saved=true', start: 1500, duration: 121 },
  { method: 'POST', status: 200, url: '/api/loyalty/quote', start: 1720, duration: 233 },
  { method: 'POST', status: 502, url: '/api/payments/charge', start: 1860, duration: 3012 },
  { method: 'GET', status: 200, url: '/checkout/declined', start: 4890, duration: 47 },
];

let at = 0;
const laneSteps = STEPS.map((s) => {
  const step = { title: s.title, start: at, end: at + s.duration, category: s.category, failed: s.category === 'expect' };
  at += s.duration;
  return step;
});

export const SYNTHETIC_ID = 'synthetic::saved-card';

// fingerprintFailure(SYNTHETIC), precomputed: the fingerprint hashes with node:crypto, which the browser bundle lacks.
export const SYNTHETIC_CLUSTER = {
  id: 'ec46e12fcc6d2244',
  errorType: "toHaveText on getByRole('heading', { level: 1 }) at checkout/payments/saved-card.spec.ts:142",
  testIds: [SYNTHETIC_ID],
};

export const SYNTHETIC: ReportTest = {
  testId: SYNTHETIC_ID,
  title: 'pays with a saved card and applies the loyalty discount when the basket holds a subscription',
  file: 'checkout/payments/saved-card.spec.ts',
  line: 128,
  column: 3,
  project: 'Desktop Chrome',
  browser: 'chromium',
  suites: ['checkout/payments/saved-card.spec.ts', 'checkout', 'saved cards'],
  status: 'failed',
  outcome: 'unexpected',
  expectedStatus: 'passed',
  duration: 6412,
  retry: 3,
  error: STACK,
  errorSnippet: SNIPPET,
  errorLocation: { file: 'checkout/payments/saved-card.spec.ts', line: 142, column: 58 },
  steps: STEPS,
  attempts: [0, 1, 2, 3].map((retry) => ({
    retry,
    status: 'failed' as const,
    duration: 6300 + retry * 37,
    error: 'Error: expect(locator).toHaveText(expected) failed',
    steps: STEPS,
  })),
  history: Array.from({ length: 10 }, (_, i) => ({
    passed: i !== 9,
    duration: 1800 + ((i * 137) % 400) + (i === 9 ? 4600 : 0),
    timestamp: new Date(Date.UTC(2026, 7, 23 + i)).toISOString(),
    retry: i === 4 ? 1 : 0,
  })),
  tags: ['@payments', '@smoke', '@synthetic'],
  flakinessScore: 0.27,
  flakinessStatus: 'failing',
  flakinessRuns: 11,
  flakinessInterval: [0.1, 0.57],
  stabilityScore: { overall: 84, flakiness: 85, performance: 70, reliability: 90, grade: 'B', needsAttention: false },
  averageDuration: 1990,
  performanceMetrics: { averageDuration: 1990, currentDuration: 6412, percentChange: 222, absoluteChange: 4422, threshold: 0.2, isRegression: true, isImprovement: false, severity: 'high' },
  signals: ['new-failure', 'regression', 'slow'],
  attachments: { screenshots: [], videos: [], traces: ['./traces/saved-card-trace-0.zip'], custom: [] },
  networkLogs: {
    entries: NETWORK.map((n) => ({
      method: n.method,
      url: `https://shop.example.test${n.url}`,
      urlPath: n.url,
      status: n.status,
      statusText: n.status === 502 ? 'Bad Gateway' : 'OK',
      duration: n.duration,
      timestamp: new Date(Date.UTC(2026, 8, 1, 10, 34, 30) + n.start).toISOString(),
      requestSize: 0,
      responseSize: 0,
    })),
    // The trace had more requests than networkLogMaxEntries kept.
    totalRequests: NETWORK.length + 7,
    totalDuration: NETWORK.reduce((s, n) => s + n.duration, 0),
    summary: { byStatus: { 200: 4, 502: 1 }, byMethod: { GET: 3, POST: 2 }, slowest: null, errors: [] },
  },
  aiSuggestion:
    'The charge request to `/api/payments/charge` returned **502** after 3.0s, so the app rendered the declined page. The assertion failed because of the backend response, not the locator.\n\nThis test passed in 9 of the last 10 runs.\n\n- Check the payments service for this run before changing the test.\n- If the gateway is unstable in this environment, mock the charge call:\n\n```ts\nawait page.route(\'**/api/payments/charge\', (route) => route.fulfill({ json: { status: \'approved\' } }));\n```',
  a11y: {
    standard: 'WCAG2AA',
    timestamp: '2026-09-01T10:34:36.000Z',
    url: 'https://shop.example.test/checkout/declined',
    passes: 41,
    incomplete: 1,
    inapplicable: 47,
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        description: 'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/color-contrast',
        wcagTags: ['wcag2aa', 'wcag143'],
        nodes: [
          { target: ['.checkout__hint'], html: '<p class="checkout__hint">', failureSummary: 'Element has insufficient color contrast of 2.9' },
          { target: ['.fake-btn'], html: '<div class="fake-btn">', failureSummary: 'Element has insufficient color contrast of 3.1' },
        ],
      },
      {
        id: 'button-name',
        impact: 'critical',
        description: 'Ensure buttons have discernible text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.13/button-name',
        wcagTags: ['wcag2a', 'wcag412'],
        nodes: [{ target: ['button.retry'], html: '<button class="retry"></button>', failureSummary: 'Element does not have inner text' }],
      },
    ],
  },
  ...({
    timeline: {
      duration: at,
      lanes: {
        steps: laneSteps,
        network: NETWORK.map((n) => ({ start: n.start, end: n.start + n.duration, method: n.method, url: n.url, status: n.status })),
        console: [
          { at: 1960, level: 'warning', text: 'loyalty: quote expired before charge, retrying once' },
          { at: 4875, level: 'error', text: 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)' },
        ],
      },
      firstAnomaly: { kind: 'network-error', at: 4872, summary: 'POST /api/payments/charge returned 502 Bad Gateway', ref: { lane: 'network', index: 3 } },
    },
  } as object),
};

const MATH = `export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export function sign(n: number): -1 | 0 | 1 {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}`;

const FORMAT = `export function formatResult(label: string, value: number): string {
  return \`\${label}: \${value}\`;
}

export function shout(text: string): string {
  return text.toUpperCase();
}`;

const totals = (covered: number, total: number) => ({ covered, total, pct: total ? Math.floor((covered / total) * 10000) / 100 : 100 });

// Mirrors the numbers the example coverage app produces (example/coverage).
export const SYNTHETIC_COVERAGE: ReportData['coverage'] = {
  summary: { lines: totals(17, 21), functions: totals(3, 5), branches: totals(4, 4) },
  files: [
    { path: 'app/src/math.ts', lines: totals(10, 12), functions: totals(2, 3), branches: totals(3, 3), hits: [2, 2, 2, null, 0, 0, 1, null, 2, 2, 1, 1, 1], source: MATH },
    { path: 'app/src/format.ts', lines: totals(4, 6), functions: totals(1, 2), branches: totals(1, 1), hits: [1, 1, 1, null, 0, 0, 1], source: FORMAT },
    { path: 'app/src/main.ts', lines: totals(3, 3), functions: totals(0, 0), branches: totals(0, 0), hits: [1, 1, 1] },
  ],
};
