import { test } from '../../dist/accessibility';

// Chromium: these exercise the accessibility fixture on a real page.
test.use({ smartReporterA11y: { enabled: true } });

test('closes its page', async ({ page }) => {
  await page.setContent('<html lang="en"><title>Closes</title><main><h1>Closes</h1></main></html>');
  await page.close();
});

test.describe('with a rule axe does not know', () => {
  test.use({ smartReporterA11y: { enabled: true, include: ['no-such-rule'] } });

  test('cannot be scanned', async ({ page }) => {
    await page.setContent('<html lang="en"><title>Unscannable</title><main><h1>Unscannable</h1></main></html>');
  });
});
