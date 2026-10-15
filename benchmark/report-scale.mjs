// Measures report generation at scale with the built reporter (npm run build first).
// Usage: node benchmark/report-scale.mjs <tests> [outDir]
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { buildReportData } = require('../dist/report-data/builder.js');
const { loadUiAssets, writeReport } = require('../dist/report-data/writer.js');

const count = Number(process.argv[2] ?? 1000);
const outDir = process.argv[3] ?? mkdtempSync(path.join(os.tmpdir(), 'report-scale-'));
const screenshot = `data:image/png;base64,${'A'.repeat(48 * 1024)}`;
const stack = Array.from({ length: 30 }, (_, i) => `    at frame${i} (tests/spec-${i}.ts:${i + 1}:5)`).join('\n');

let peak = 0;
const sample = () => (peak = Math.max(peak, process.memoryUsage().rss));
const timer = setInterval(sample, 5);

const results = Array.from({ length: count }, (_, i) => {
  const failing = i % 10 === 0;
  return {
    testId: `[chromium] suite-${i % 200}.spec.ts::test ${i}`,
    title: `test ${i} does something reasonably descriptive`,
    file: `tests/suite-${i % 200}.spec.ts`,
    line: (i % 80) + 1,
    status: failing ? 'failed' : 'passed',
    outcome: failing ? 'unexpected' : 'expected',
    duration: 200 + (i % 3000),
    retry: failing ? 2 : 0,
    error: failing ? `Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('button')\n${stack}` : undefined,
    steps: Array.from({ length: 20 }, (_, s) => ({ title: `step ${s}`, duration: 10 + s, category: 'pw:api' })),
    history: Array.from({ length: 10 }, (_, h) => ({ passed: h % 7 !== 0, duration: 200 + h, timestamp: new Date(2026, 8, h + 1).toISOString() })),
    attachments: { screenshots: failing ? [screenshot] : [], videos: [], traces: [], custom: [] },
    tags: ['@smoke'],
  };
});

const started = performance.now();
const data = buildReportData({ results, history: { runs: [], tests: {}, summaries: [] }, startTime: Date.now() - 60_000, options: {}, outputBasename: 'smart-report' });
const result = await writeReport(data, { outputPath: path.join(outDir, 'smart-report.html'), assets: loadUiAssets(path.resolve('dist/ui')) });
sample();
clearInterval(timer);
console.log(JSON.stringify({ tests: count, ms: Math.round(performance.now() - started), peakRssMb: Math.round(peak / 1048576), dataMb: +(result.dataBytes / 1048576).toFixed(1), mode: result.mode, outDir }));
