import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReportData } from '../../report-data/schema';
import { loadUiAssets, writeReport } from '../../report-data/writer';
import fixture from '../specimen/report-fixture.json';

// Writes real reports from the fixture with the built UI assets (dist/ui, made by npm run ui:specimen).
const OUT = path.resolve(__dirname, '../../../test-results/ui/report-files');

async function write(name: string, opts: { assetMode?: 'inline' | 'external'; cspSafe?: boolean }) {
  const outputPath = path.join(OUT, name, 'smart-report.html');
  fs.rmSync(path.dirname(outputPath), { recursive: true, force: true });
  const result = await writeReport(fixture as unknown as ReportData, { outputPath, assets: loadUiAssets(path.resolve(__dirname, '../../../dist/ui')), ...opts });
  return { outputPath, result };
}

test('an external-mode report opens over file:// with data from the companion script', async ({ page }) => {
  const { outputPath, result } = await write('external', { assetMode: 'external' });
  expect(result.mode).toBe('external');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(outputPath).href);
  await expect(page.locator('.pane__count')).toHaveText('13');
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
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
  await expect(page.locator('.pane__count')).toHaveText('13');
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test('the inline report opens over file:// with no failed requests', async ({ page }) => {
  const { outputPath, result } = await write('inline', { assetMode: 'inline' });
  expect(result.mode).toBe('inline');
  const failed: string[] = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  await page.goto(pathToFileURL(outputPath).href);
  await expect(page.getByRole('tree', { name: 'Failures' })).toBeVisible();
  expect(failed).toEqual([]);
});
