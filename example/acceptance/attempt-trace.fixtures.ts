import { expect, test } from '@playwright/test';

// trace is a worker option, so it cannot be set per describe block in attempts.fixtures.ts.
test.use({ trace: 'on' });

// The first attempt's cart call gets a 500 and logs an error; the retry gets a 200 and then loads a promo.
test('loads the cart after a server error', async ({ page }, testInfo) => {
  await page.route('http://cart.test/**', (route) => {
    const url = route.request().url();
    if (url === 'http://cart.test/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<script>
          fetch('/api/cart').then(async (r) => {
            if (!r.ok) return console.error('cart failed: ' + r.status);
            await fetch('/api/promo');
            document.title = 'done';
          });
        </script>`,
      });
    }
    if (url === 'http://cart.test/api/cart') return route.fulfill({ status: testInfo.retry === 0 ? 500 : 200, json: { items: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('http://cart.test/');
  await expect(page).toHaveTitle('done', { timeout: 2000 });
});
