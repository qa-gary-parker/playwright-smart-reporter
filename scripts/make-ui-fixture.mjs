// Regenerates src/ui/specimen/report-fixture.json from a report written by the
// example suite (npm run build && npm run test:demo). Media is replaced with
// small placeholders so the fixture stays reviewable.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'example/smart-report.html'), 'utf8');
const start = html.indexOf('window.__SMART_DATA__=');
const end = html.indexOf(';</script>', start);
if (start < 0 || end < 0) throw new Error('example/smart-report.html has no inline report data');
const sandbox = { window: {} };
vm.runInNewContext(html.slice(start, end + 1), sandbox);
const data = sandbox.window.__SMART_DATA__;

const shot = (label) =>
  'data:image/svg+xml,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#e9e9e9"/><text x="320" y="205" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#6b6b6b">${label}</text></svg>`);

for (const t of data.tests) {
  if (t.attachments) {
    t.attachments.screenshots = t.attachments.screenshots.map((_, i) => shot(`${t.title} (${i + 1})`));
    t.attachments.videos = t.attachments.videos.map(() => './video.webm');
    t.attachments.traces = t.attachments.traces.map((_, i) => `./traces/trace-${i}.zip`);
  }
  delete t.screenshot;
  delete t.videoPath;
  delete t.tracePath;
  delete t.aiPrompt;
  if (t.networkLogs) t.networkLogs.entries = t.networkLogs.entries.slice(0, 8);
}
data.historySnapshots = undefined;
data.meta.ci = { provider: 'github', branch: 'main', commit: 'a1b2c3d4e5f6', buildId: '482' };
data.meta.generatedAt = '2026-09-01T10:36:10.000Z';
data.meta.startTime = Date.parse('2026-09-01T10:34:30.000Z');
data.meta.reporterVersion = '3.0.0';

// Error stacks carry absolute paths from the machine that ran the suite.
const prefix = new RegExp(`(file://)?${(root + path.sep).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
const out = path.join(root, 'src/ui/specimen/report-fixture.json');
writeFileSync(out, JSON.stringify(data, null, 1).replace(prefix, ''));
console.log(`${data.tests.length} tests -> ${path.relative(root, out)} (${(readFileSync(out).length / 1024).toFixed(0)} KB)`);
