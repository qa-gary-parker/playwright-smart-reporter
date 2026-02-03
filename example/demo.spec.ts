import { test, expect } from '@playwright/test';

// ============================================================================
// Demo tests showcasing Smart Reporter features
// ============================================================================

// 1. A test that always passes (baseline)
test('homepage loads successfully', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 2. A test that always fails (triggers AI analysis)
test('broken login - element not found', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // This will fail - no such element exists
  await expect(page.locator('#login-button-that-does-not-exist')).toBeVisible({
    timeout: 2000,
  });
});

// 3. A test marked as @slow with the annotation (shows slow badge)
test('slow navigation test', async ({ page }) => {
  test.slow(); // Mark this test as slow - shows 🐢 badge
  // Artificial delay to simulate slow test
  await page.waitForTimeout(3000);
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 4. A flaky test (50% chance of failure - demonstrates flakiness detection)
test('flaky behavior - random failure', async ({ page }) => {
  await page.goto('https://playwright.dev');

  // 50% chance of failure
  if (Math.random() > 0.5) {
    // This will fail
    await expect(
      page.locator('#element-that-randomly-appears')
    ).toBeVisible({ timeout: 1000 });
  } else {
    // This will pass
    await expect(page.locator('h1')).toBeVisible();
  }
});

// 5. A skipped test with reason (shows skip badge)
test.skip('skipped test - not implemented yet', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // TODO: Implement this test
});

// 6. A test with @fixme annotation (shows fixme badge)
test('known issue - needs fixing', async ({ page }) => {
  test.fixme(); // Mark as needing fix - shows 🔧 badge
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 7. A test with custom annotation (shows custom badge)
test('feature behind flag @experimental', async ({ page }) => {
  test.info().annotations.push({ type: 'experimental', description: 'New feature in beta' });
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 8. A test with issue tracking annotation
test('regression test for bug #123', async ({ page }) => {
  test.info().annotations.push({ type: 'issue', description: 'JIRA-123' });
  await page.goto('https://playwright.dev');
  const docsLink = page.getByRole('link', { name: 'Docs' });
  await expect(docsLink).toBeVisible();
});

// 9. A test with multiple annotations
test('critical path with multiple concerns', async ({ page }) => {
  test.slow(); // This test is known to be slow
  test.info().annotations.push({ type: 'critical', description: 'Core user flow' });
  test.info().annotations.push({ type: 'owner', description: 'team-platform' });
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// 10. Test with custom test.step to show step filtering
test('documentation link works', async ({ page }) => {
  await test.step('Navigate to Playwright homepage', async () => {
    await page.goto('https://playwright.dev');
  });

  await test.step('Verify docs link is visible', async () => {
    const docsLink = page.getByRole('link', { name: 'Docs' });
    await expect(docsLink).toBeVisible();
  });
});
