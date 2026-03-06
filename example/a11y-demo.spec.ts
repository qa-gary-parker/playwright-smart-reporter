import { test } from '../dist/accessibility';
import { expect } from '@playwright/test';
import * as path from 'path';

test('page with deliberate a11y violations', async ({ page }) => {
  const filePath = path.resolve(__dirname, 'a11y-bad-page.html');
  await page.goto(`file://${filePath}`);
  await expect(page.locator('h1')).toBeVisible();
});

test('playwright.dev homepage accessibility', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

test('example.com accessibility', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page.locator('h1')).toBeVisible();
});
