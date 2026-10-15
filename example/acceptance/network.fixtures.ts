import { test, expect } from '@playwright/test';

test.use({ trace: 'on' });

// One page, one image and three API calls, so the network log options have something to filter.
test('loads the dashboard', async ({ page }) => {
  await page.route('http://net.test/**', (route) => {
    const url = route.request().url();
    if (url === 'http://net.test/') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<img src="/logo.png"><script>
          (async () => { for (const u of ['/api/a', '/api/b', '/api/c']) await fetch(u); document.title = 'done'; })();
        </script>`,
      });
    }
    if (url.endsWith('.png')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('89504e470d0a1a0a', 'hex') });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('http://net.test/');
  await expect(page).toHaveTitle('done');
});
