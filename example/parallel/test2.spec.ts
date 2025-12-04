import { test, expect } from '@playwright/test';

test('h2 should be visible', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h2')).toBeVisible();
});
