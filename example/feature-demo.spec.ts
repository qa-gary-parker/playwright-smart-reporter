import { test, expect } from '@playwright/test';

// ============================================================================
// Feature Demo: Comprehensive showcase of Smart Reporter capabilities
//
// Run with: cd example && npx playwright test feature-demo.spec.ts
// ============================================================================

// --- Passing Tests -----------------------------------------------------------

test('homepage loads and displays heading', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

test('navigation links are present', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
});

// --- Failing Tests (triggers AI analysis + failure clustering) ---------------

test('missing element causes failure', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('#nonexistent-element')).toBeVisible({ timeout: 2000 });
});

test('incorrect text content causes failure', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toHaveText('This text does not exist', { timeout: 2000 });
});

// --- Skipped Test ------------------------------------------------------------

test.skip('feature not yet implemented', async ({ page }) => {
  await page.goto('https://playwright.dev');
  await expect(page.locator('#future-feature')).toBeVisible();
});

// --- Flaky Test (demonstrates retry detection) -------------------------------

test('flaky network-dependent check', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // Simulate flakiness: fail on first attempt, pass on retry
  if (test.info().retry === 0) {
    await expect(page.locator('#element-that-appears-later')).toBeVisible({ timeout: 1000 });
  } else {
    await expect(page.locator('h1')).toBeVisible();
  }
});

// --- Tagged Tests (for notification filtering) -------------------------------

test('@smoke homepage renders correctly', async ({ page }) => {
  test.info().annotations.push({ type: 'tag', description: '@smoke' });
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

test('@regression docs link navigates correctly', async ({ page }) => {
  test.info().annotations.push({ type: 'tag', description: '@regression' });
  await page.goto('https://playwright.dev');
  const docsLink = page.getByRole('link', { name: 'Docs' });
  await expect(docsLink).toBeVisible();
});

// --- Annotated Tests ---------------------------------------------------------

test('slow page load scenario', async ({ page }) => {
  test.slow();
  await page.waitForTimeout(2000);
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

test('known issue tracked in Jira', async ({ page }) => {
  test.info().annotations.push({ type: 'issue', description: 'PROJ-456' });
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

test('experimental feature behind flag', async ({ page }) => {
  test.info().annotations.push({ type: 'experimental', description: 'New search UI' });
  await page.goto('https://playwright.dev');
  await expect(page.locator('h1')).toBeVisible();
});

// --- Grouped Tests (describe blocks for suite organization) ------------------

test.describe('Search functionality', () => {
  test('search input is accessible', async ({ page }) => {
    await page.goto('https://playwright.dev');
    const searchButton = page.getByRole('button', { name: 'Search' });
    await expect(searchButton).toBeVisible();
  });

  test('search opens dialog', async ({ page }) => {
    await page.goto('https://playwright.dev');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.locator('.DocSearch-Modal')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('API Documentation', () => {
  test('API section is navigable', async ({ page }) => {
    await page.goto('https://playwright.dev/docs/api/class-playwright');
    await expect(page.locator('h1')).toContainText('Playwright');
  });
});

// --- Test Steps (demonstrates step-level reporting) --------------------------

test('multi-step user journey', async ({ page }) => {
  await test.step('Navigate to homepage', async () => {
    await page.goto('https://playwright.dev');
  });

  await test.step('Verify main heading', async () => {
    await expect(page.locator('h1')).toBeVisible();
  });

  await test.step('Check docs link', async () => {
    await expect(page.getByRole('link', { name: 'Docs' })).toBeVisible();
  });
});

// --- Network Activity (demonstrates network log capture) ---------------------

test('API request triggers network logging', async ({ page }) => {
  await page.goto('https://playwright.dev');
  // Any navigation generates network traffic that Smart Reporter captures
  // from trace files when enableNetworkLogs is true
  await expect(page.locator('h1')).toBeVisible();
});
