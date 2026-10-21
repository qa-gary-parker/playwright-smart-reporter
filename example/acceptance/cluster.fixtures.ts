import { test, expect, type Page } from '@playwright/test';

// Both clicks time out on this one line, so only the locator tells the two failures apart.
async function clickMissing(page: Page, selector: string) {
  await page.locator(selector).click({ timeout: 200 });
}

test('clicks the missing save button', async ({ page }) => {
  await clickMissing(page, '#save');
});

test('clicks the missing cancel button', async ({ page }) => {
  await clickMissing(page, '#cancel');
});

// One assertion line that fails with different numbers.
for (const cart of [1041, 2087]) {
  test(`cart ${cart} is empty`, () => {
    expect(cart * 3, `cart ${cart} holds ${cart * 3} items`).toBe(0);
  });
}

// BROKEN_DRAFTS names the drafts that fail this run, so a cluster can go away and come back between runs.
for (const draft of ['notes', 'title']) {
  test(`keeps the ${draft} draft`, () => {
    expect((process.env.BROKEN_DRAFTS ?? '').split(',').includes(draft), `lost the ${draft} draft`).toBe(false);
  });
}
