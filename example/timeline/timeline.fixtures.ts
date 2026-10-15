import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// TIMELINE_MODE=baseline makes every test pass at normal speed, which seeds the
// step-duration history that slow-step detection compares against.
const BASELINE = process.env.TIMELINE_MODE === 'baseline';
const ORIGIN = 'http://timeline.test';
const APP = fs.readFileSync(path.join(__dirname, 'app.html'), 'utf8');
const ORDERS = { items: [{ id: 1, name: 'Desk' }, { id: 2, name: 'Lamp' }, { id: 3, name: 'Chair' }] };

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openApp(page: Page) {
  await page.route(`${ORIGIN}/**`, (route) =>
    route.request().url() === `${ORIGIN}/`
      ? route.fulfill({ contentType: 'text/html', body: APP })
      : route.fulfill({ status: 404, body: '' }),
  );
  await test.step('open app', async () => {
    await page.goto(`${ORIGIN}/`);
  });
}

async function loadOrders(page: Page) {
  await test.step('load orders', async () => {
    await Promise.all([page.waitForResponse('**/api/orders'), page.click('#load')]);
  });
}

test('orders API returns 500', async ({ page }) => {
  await openApp(page);
  await page.route('**/api/orders', (route) =>
    BASELINE ? route.fulfill({ json: ORDERS }) : route.fulfill({ status: 500, json: { error: 'database unavailable' } }),
  );
  await loadOrders(page);
  await expect(page.locator('#orders li')).toHaveCount(3, { timeout: 1000 });
});

test('orders payload throws a TypeError', async ({ page }) => {
  await openApp(page);
  await page.route('**/api/orders', (route) => route.fulfill({ json: BASELINE ? ORDERS : { orders: null } }));
  await loadOrders(page);
  await expect(page.locator('#status')).toHaveText('3 orders', { timeout: 1000 });
});

test('slow orders API exhausts the test timeout', async ({ page }) => {
  test.setTimeout(4000);
  await openApp(page);
  await page.route('**/api/orders', async (route) => {
    if (!BASELINE) await delay(3000);
    await route.fulfill({ json: ORDERS });
  });
  await page.route('**/api/orders/1', async (route) => {
    await delay(1500);
    await route.fulfill({ json: ORDERS.items[0] });
  });
  await loadOrders(page);
  await test.step('open first order', async () => {
    await page.click('#orders li >> nth=0');
    await expect(page.locator('#detail')).toHaveText('Order 1: Desk', { timeout: 10_000 });
  });
});

test('heading assertion fails with nothing unusual before it', async ({ page }) => {
  await openApp(page);
  await page.route('**/api/orders', (route) => route.fulfill({ json: ORDERS }));
  await loadOrders(page);
  await expect(page.locator('h1')).toHaveText(BASELINE ? 'Orders' : 'Invoices', { timeout: 1000 });
});
