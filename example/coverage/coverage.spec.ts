import { pathToFileURL } from 'url';
import * as path from 'path';
import { test, expect } from 'playwright-smart-reporter/coverage';

// Keep these calls in step with run-in-node.mjs, which replays them under c8 for comparison.
const appUrl = pathToFileURL(path.join(__dirname, 'app', 'index.html')).href;

test('adds and classifies a positive number', async ({ page }) => {
  await page.goto(appUrl);
  expect(await page.evaluate(() => (window as any).add(2, 3))).toBe(5);
  expect(await page.evaluate(() => (window as any).sign(5))).toBe('non-negative');
});

test('formats a result and classifies a negative number', async ({ page }) => {
  await page.goto(appUrl);
  expect(await page.evaluate(() => (window as any).formatResult('sum', 5))).toBe('sum: 5');
  expect(await page.evaluate(() => (window as any).sign(-1))).toBe('negative');
});
