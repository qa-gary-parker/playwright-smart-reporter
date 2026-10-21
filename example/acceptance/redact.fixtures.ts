import { test } from '@playwright/test';

test.use({ trace: 'on' });

// The value of MY_API_TOKEN reaches stdout, a step title, a page URL, the console and the error.
// The email and "control text kept" are not secrets.
test('opens the account page', async ({ page }) => {
  const token = process.env.MY_API_TOKEN;
  console.log(`calling the API with ${token}`);
  await page.route('http://redact.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<script>console.error("rejected " + location.search)</script>' }),
  );
  await test.step(`open the page with ${token}`, async () => {
    await page.goto(`http://redact.test/account?t=${token}`);
  });
  throw new Error(`token ${token} rejected for qa.user@example.com, control text kept`);
});
