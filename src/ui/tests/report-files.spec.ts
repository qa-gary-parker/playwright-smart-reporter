import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReportData } from '../../report-data/schema';
import { loadUiAssets, writeReport } from '../../report-data/writer';
import fixture from '../specimen/report-fixture.json';

// Writes real reports from the fixture with the built UI assets (dist/ui, made by npm run ui:specimen).
const OUT = path.resolve(__dirname, '../../../test-results/ui/report-files');

async function write(name: string, opts: { assetMode?: 'inline' | 'external'; cspSafe?: boolean }, data = fixture as unknown as ReportData) {
  const outputPath = path.join(OUT, name, 'smart-report.html');
  fs.rmSync(path.dirname(outputPath), { recursive: true, force: true });
  const result = await writeReport(data, { outputPath, assets: loadUiAssets(path.resolve(__dirname, '../../../dist/ui')), ...opts });
  return { outputPath, result };
}

test('an external-mode report opens over file:// with data from the companion script', async ({ page }) => {
  const { outputPath, result } = await write('external', { assetMode: 'external' });
  expect(result.mode).toBe('external');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(outputPath).href);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.locator('.pane__count')).toHaveText('13');
  expect(errors).toEqual([]);
});

test('a cspSafe report renders under a strict CSP and the app itself causes no violations', async ({ page }) => {
  const { outputPath } = await write('csp', { cspSafe: true });
  const html = fs.readFileSync(outputPath, 'utf8');
  expect(html).not.toMatch(/<script>|<style>/);
  // The 2.x trace viewer markup still carries inline style attributes; everything else must be clean.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __csp: string[] }).__csp = seen;
    document.addEventListener('securitypolicyviolation', (e) => {
      const el = e.target as Element | null;
      if (!el?.closest?.('#traceViewerModal')) seen.push(`${e.violatedDirective}: ${el?.outerHTML?.slice(0, 80) ?? e.blockedURI}`);
    });
  });
  // Serve the files with a strict CSP header so the browser enforces it.
  await page.route('http://report.test/**', async (route) => {
    const file = path.join(path.dirname(outputPath), new URL(route.request().url()).pathname.slice(1) || 'smart-report.html');
    const type = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html';
    await route.fulfill({
      body: fs.readFileSync(file),
      headers: { 'content-type': type, 'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'" },
    });
  });
  await page.goto('http://report.test/smart-report.html');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.locator('.pane__count')).toHaveText('13');
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test('the inline report opens over file:// with no failed requests', async ({ page }) => {
  const { outputPath, result } = await write('inline', { assetMode: 'inline' });
  expect(result.mode).toBe('inline');
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto(pathToFileURL(outputPath).href);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  expect(failed).toEqual([]);
});

test('the Live view times a finished run from its events, not from when the page read them', async ({ page }) => {
  const data = fixture as unknown as ReportData;
  const { outputPath } = await write('live', { assetMode: 'inline' }, { ...data, config: { ...data.config, live: { jsonlFile: 'live.jsonl' } } });
  const counters = { passed: 22, failed: 7, skipped: 3, flaky: 1, completed: 33, totalExpected: 33 };
  const events = [
    { event: 'start', timestamp: '2026-10-08T15:41:25.527Z', totalExpected: 33 },
    { event: 'complete', timestamp: '2026-10-08T15:41:58.276Z', duration: 32749, counters },
  ];
  await page.route('http://report.test/**', (route) =>
    new URL(route.request().url()).pathname === '/live.jsonl'
      ? route.fulfill({ body: events.map((e) => JSON.stringify(e)).join('\n') + '\n', contentType: 'application/x-ndjson' })
      : route.fulfill({ body: fs.readFileSync(outputPath), contentType: 'text/html' }),
  );
  await page.goto('http://report.test/smart-report.html#/live');
  await expect(page.locator('.live-status')).toHaveText('Completed');
  await expect(page.locator('.page__head > .mono')).toHaveText('32.7s');
});

test('the Live view sends its run filter to the server as files and a grep', async ({ page }) => {
  const data = fixture as unknown as ReportData;
  const { outputPath } = await write('live-run', { assetMode: 'inline' }, { ...data, config: { ...data.config, live: { jsonlFile: 'live.jsonl' } } });
  const bodies: unknown[] = [];
  await page.route('http://report.test/**', async (route) => {
    const req = route.request();
    const pathname = new URL(req.url()).pathname;
    if (pathname === '/run' && req.method() === 'POST') {
      bodies.push(req.postDataJSON());
      return route.fulfill({ json: { status: 'started' } });
    }
    if (pathname === '/live.jsonl') return route.fulfill({ body: '' });
    // serve replaces the placeholder when it runs with --run-command.
    return route.fulfill({ body: fs.readFileSync(outputPath, 'utf8').replace(/__RUN_ENABLED__/g, 'true'), contentType: 'text/html' });
  });
  await page.goto('http://report.test/smart-report.html#/live');
  await page.getByLabel('Filter which tests to run').fill('file:checkout.spec.ts tag:smoke tag:@critical saved card');
  await page.getByRole('button', { name: 'Run tests' }).click();
  // Every condition must hold, in any order: Playwright matches the title with the tags after it.
  await expect.poll(() => bodies).toEqual([{ files: ['checkout.spec.ts'], grep: '^(?=.*(?:@smoke|@critical))(?=.*saved)(?=.*card)' }]);
});

test('the palette suggests describe blocks as suite filters, not the file that starts each suite path', async ({ page }) => {
  // Test files that a custom testMatch picks up, named without .spec. or .test.
  const rename = (s: string) => s.replace('.spec.ts', '.e2e.ts');
  const data = fixture as unknown as ReportData;
  const tests = data.tests.map((t) => ({ ...t, file: rename(t.file), suites: t.suites?.map(rename) }));
  const { outputPath } = await write('suite-names', { assetMode: 'inline' }, { ...data, tests });
  await page.goto(pathToFileURL(outputPath).href);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search tests, views, filters, and actions' }).fill('suite:');
  await expect(page.getByRole('option').filter({ hasText: /^suite:/ })).toHaveText(['suite:Search functionality', 'suite:API Documentation']);
});
