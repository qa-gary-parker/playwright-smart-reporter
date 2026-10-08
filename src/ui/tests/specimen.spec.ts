import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ACCENT_NAMES } from '../styles/tokens';

const DIR = path.resolve(__dirname, '../../../.ui-specimen');
const url = (file: string, query = '') => pathToFileURL(path.join(DIR, file)).href + query;

function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

async function loadedFaces(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), status: f.status }));
  });
}

test.describe('fonts', () => {
  test('bundled fonts load with no network access', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) external.push(r.url());
    });
    await page.route(/^https?:\/\//, (route) => route.abort());
    await page.goto(url('index.html', '?mode=light'));
    const faces = await loadedFaces(page);
    expect(faces).toContainEqual({ family: 'Geist', status: 'loaded' });
    expect(faces).toContainEqual({ family: 'Geist Mono', status: 'loaded' });
    expect(external).toEqual([]);
  });

  test('cspSafe page declares no font faces', async ({ page }) => {
    await page.goto(url('csp.html', '?mode=light'));
    // document.fonts lists every @font-face rule, loaded or not.
    expect(await loadedFaces(page)).toEqual([]);
  });
});

for (const mode of ['light', 'dark', 'hc']) {
  test(`axe finds no serious or critical violations in ${mode} mode`, async ({ page }) => {
    await page.goto(url('index.html', `?mode=${mode}`));
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(blocking).toEqual([]);
  });
}

test.describe('interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(url('index.html', '?mode=light'));
  });

  test('keyboard focus shows a 2px ring in the accent colour', async ({ page }) => {
    await page.getByRole('button', { name: 'Primary', exact: true }).first().focus();
    await page.keyboard.press('Tab');
    const focused = page.getByRole('button', { name: 'Secondary', exact: true }).first();
    await expect(focused).toBeFocused();
    const accent = hexToRgb(await cssVar(page, '--accent'));
    await expect(focused).toHaveCSS('outline-style', 'solid');
    await expect(focused).toHaveCSS('outline-width', '2px');
    await expect(focused).toHaveCSS('outline-color', accent);
  });

  test('accent preset changes the accent and nothing else', async ({ page }) => {
    const bg = await cssVar(page, '--bg');
    await page.goto(url('index.html', '?mode=light&accent=forest'));
    expect(await cssVar(page, '--accent')).toBe('#1f7a55');
    expect(await cssVar(page, '--bg')).toBe(bg);
  });

  test('arrow keys move tab selection and focus', async ({ page }) => {
    const tabs = page.getByRole('tablist', { name: 'History' });
    await tabs.getByRole('tab', { name: 'Trends' }).focus();
    await page.keyboard.press('ArrowRight');
    const compare = tabs.getByRole('tab', { name: /Compare/ });
    await expect(compare).toHaveAttribute('aria-selected', 'true');
    await expect(compare).toBeFocused();
    await expect(tabs.getByRole('tab', { name: 'Trends' })).toHaveAttribute('aria-selected', 'false');
  });

  test('clicking a row moves the selection', async ({ page }) => {
    const list = page.getByRole('tree', { name: 'Tests' });
    const first = list.getByRole('treeitem').filter({ hasText: 'pays with saved card' });
    const second = list.getByRole('treeitem').filter({ hasText: 'applies coupon' });
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await first.click();
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(second).toHaveAttribute('aria-selected', 'false');
  });

  test('group header collapses its rows', async ({ page }) => {
    const list = page.getByRole('tree', { name: 'Tests' });
    const header = list.getByRole('treeitem', { name: /toBeVisible timeout/, level: 1 });
    const rows = list.getByRole('treeitem', { level: 2 });
    await expect(rows).toHaveCount(5);
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(rows).toHaveCount(2);
    await header.focus();
    await page.keyboard.press('ArrowRight');
    await expect(header).toHaveAttribute('aria-expanded', 'true');
    await expect(rows).toHaveCount(5);
  });

  test('menu opens on the checked item, moves with arrows, and returns focus on Escape', async ({ page }) => {
    const trigger = page.getByRole('button', { name: 'Theme' });
    await trigger.click();
    const menu = page.getByRole('menu', { name: 'Theme' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('dialog closes on Escape and on backdrop click', async ({ page }) => {
    const open = page.getByRole('button', { name: 'Open dialog' });
    const dialog = page.getByRole('dialog', { name: 'Export summary' });
    await open.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await open.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(dialog).toBeHidden();
  });

  test('split pane separator resizes with arrow keys within its bounds', async ({ page }) => {
    const handle = page.getByRole('separator', { name: 'Resize list' });
    await expect(handle).toHaveAttribute('aria-valuenow', '280');
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '296');
    await page.keyboard.press('End');
    await expect(handle).toHaveAttribute('aria-valuenow', '480');
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', '480');
  });

  test('counts read as one phrase without repeating the status', async ({ page }) => {
    const example = page.locator('.spec-example').filter({ hasText: 'Counts' });
    await expect(example.locator('.count').first()).toHaveText('13 failed');
    await expect(example.locator('.count').first().getByRole('img')).toHaveCount(0);
  });

  test('reduced motion removes transitions', async ({ page }) => {
    const chev = page.locator('.chev').first();
    await expect(chev).toHaveCSS('transition-duration', '0.1s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(chev).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('screenshots', () => {
  test.skip(process.platform !== 'linux', 'Baselines are Linux-only. Run npm run test:ui:docker.');

  for (const mode of ['light', 'dark', 'hc']) {
    test(`specimen ${mode}`, async ({ page }) => {
      await page.goto(url('index.html', `?mode=${mode}`));
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`specimen-${mode}.png`, { fullPage: true });
    });
  }

  for (const accent of ACCENT_NAMES) {
    for (const mode of ['light', 'dark']) {
      test(`accent ${accent} ${mode}`, async ({ page }) => {
        await page.goto(url('index.html', `?mode=${mode}&accent=${accent}`));
        await page.evaluate(() => document.fonts.ready);
        await expect(page.getByTestId('accent-sample')).toHaveScreenshot(`accent-${accent}-${mode}.png`);
      });
    }
  }
});
