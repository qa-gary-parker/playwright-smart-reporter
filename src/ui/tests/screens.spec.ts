import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = path.resolve(__dirname, '../../../.ui-specimen');
const url = (query: string) => pathToFileURL(path.join(DIR, 'preview.html')).href + `?${query}`;

const SCREENS: Array<[string, string]> = [
  ['failures', 'screen=failures'],
  ['flaky', 'screen=flaky'],
  ['green', 'screen=green'],
  ['insights', 'screen=insights'],
  ['history-trends', 'screen=history&tab=trends'],
  ['history-compare', 'screen=history&tab=compare'],
  ['palette', 'screen=failures&overlay=palette'],
  ['keymap', 'screen=keymap&overlay=keymap'],
  ['heatmap', 'screen=history&tab=heatmap'],
  ['gallery', 'screen=gallery'],
  ['live', 'screen=live'],
  ['a11y', 'screen=a11y'],
  ['coverage', 'screen=coverage'],
];
const MODES = ['light', 'dark', 'hc'];

for (const [name, query] of SCREENS) {
  for (const mode of MODES) {
    test(`axe: ${name} ${mode}`, async ({ page }) => {
      await page.goto(url(`${query}&mode=${mode}`));
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(blocking).toEqual([]);
    });
  }
}

test('failures screen lands on the new failure, grouped by cluster', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  const tree = page.getByRole('tree', { name: 'Failures' });
  await expect(tree.getByRole('treeitem', { level: 1 }).first()).toContainText('toHaveText');
  await expect(tree.getByRole('treeitem', { level: 2, selected: true })).toContainText('pays with a saved card');
  await expect(page.getByRole('article', { name: 'Test detail' }).getByRole('heading', { level: 2 })).toContainText('pays with a saved card');
});

test('a green run with no deep link opens on the flaky queue and reports no failures', async ({ page }) => {
  await page.goto(url('screen=green&mode=light'));
  expect(new URL(page.url()).hash).toMatch(/^#\/q\/flaky(\?|$)/);
  await expect(page.getByRole('link', { name: /Flaky/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Run result')).toContainText('No failures');
});

test('narrow viewport shows the list, then the detail as its own view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url('screen=failures&mode=light'));
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeHidden();
  await expect(page.getByRole('article', { name: 'Test detail' })).toHaveCount(0);
  await page.getByRole('treeitem').filter({ hasText: 'pays with a saved card' }).click();
  await expect(page.getByRole('article', { name: 'Test detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to list' }).click();
  await expect(page.getByRole('tree', { name: 'Failures' })).toBeVisible();
});

test.describe('screenshots', () => {
  test.skip(process.platform !== 'linux', 'Baselines are Linux-only. Run npm run test:ui:docker.');

  for (const [name, query] of SCREENS) {
    for (const mode of MODES) {
      test(`${name} ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(url(`${query}&mode=${mode}`));
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${name}-${mode}.png`);
      });
    }
  }

  for (const [name, query] of [
    ['failures', 'screen=failures'],
    ['detail', `screen=failures&test=${encodeURIComponent('synthetic::saved-card')}`],
  ]) {
    test(`narrow ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url(`${query}&mode=light`));
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`narrow-${name}.png`);
    });
  }
});
