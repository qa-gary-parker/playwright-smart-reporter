import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const report = path.resolve(__dirname, '../example/smart-report.html');
const outDir = path.resolve(__dirname, 'out');
const NARROW = '(max-width: 899px)';

async function caption(page: Page, text: string, holdMs: number) {
  await page.evaluate(t => { document.getElementById('demo-caption')!.textContent = t; }, text);
  await page.waitForTimeout(holdMs);
}

async function show(page: Page, hash: string, heading: string) {
  await page.evaluate(h => { location.hash = h; }, hash);
  await expect(page.locator('main').getByRole('heading', { name: heading }).first()).toBeVisible();
}

// scrollIntoView would also scroll the zoomed document, so move only the nearest scrolling pane
async function scrollTo(page: Page, section: string, zoom: number) {
  await page.locator('summary.section__header', { hasText: section }).first().evaluate((el, z) => {
    let pane = el.parentElement!;
    while (!/auto|scroll/.test(getComputedStyle(pane).overflowY) || pane.scrollHeight <= pane.clientHeight) pane = pane.parentElement!;
    const top = el.getBoundingClientRect().top - pane.getBoundingClientRect().top;
    pane.scrollBy({ top: top / z, behavior: 'smooth' });
  }, zoom);
}

test('record the report tour', async ({ browser }, testInfo) => {
  const viewport = testInfo.project.use.viewport!;
  const { zoom, caption: captionPx, lines } = testInfo.project.metadata as { zoom: number; caption: number; lines: number };
  const portrait = viewport.height > viewport.width;

  const context = await browser.newContext({
    viewport,
    colorScheme: 'dark',
    recordVideo: { dir: testInfo.outputDir, size: viewport },
  });
  const page = await context.newPage();
  if (portrait) {
    // CSS zoom does not change what media queries see, so force the report's narrow layout
    await page.addInitScript(q => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = query => (query === q ? { ...real(query), matches: true, addEventListener() {}, removeEventListener() {} } as MediaQueryList : real(query));
    }, NARROW);
  }
  await page.goto('file://' + report);
  await page.evaluate(([z, px, h, q, lines]) => {
    const bar = (px as number) * (1.25 * (lines as number) + 1);
    let css = `html{zoom:${z};overflow:hidden}.app{height:${(h as number) / (z as number) - bar}px !important}`
      + `#demo-caption{position:fixed;left:0;right:0;bottom:0;height:${bar}px;z-index:99999;box-sizing:border-box;`
      + `display:flex;align-items:center;justify-content:center;padding:0 ${px}px;background:#0B0D0C;`
      + `border-top:1px solid #3FB950;color:#E6E8E3;font:600 ${px}px/1.25 ui-monospace,Menlo,monospace;text-align:center;white-space:${(lines as number) > 1 ? 'pre-line' : 'normal'}}`;
    if (q) {
      for (const sheet of document.styleSheets)
        for (const rule of sheet.cssRules)
          if (rule instanceof CSSMediaRule && rule.conditionText === q) css += [...rule.cssRules].map(r => r.cssText).join('');
    }
    document.head.appendChild(document.createElement('style')).textContent = css;
    const el = document.createElement('div');
    el.id = 'demo-caption';
    document.body.appendChild(el);
  }, [zoom, captionPx, viewport.height, portrait ? NARROW : '', lines] as const);

  await expect(page.locator('main').getByRole('heading', { name: 'Insights' })).toBeVisible();
  await caption(page, 'playwright-smart-reporter', 3000);
  await caption(page, 'One HTML report per Playwright run', 4000);
  await caption(page, 'Pass rate, duration and flakiness vs the last 10 runs', 5000);

  await show(page, '#/q/failures', 'Failures');
  await caption(page, 'Failures grouped by the error they share', 5000);
  if (portrait) await page.locator('.pane__scroll .vlist__item').nth(1).click();
  await expect(page.locator('article.detail')).toBeVisible();
  await caption(page, 'Error, call log and the failing source line', 5000);
  await scrollTo(page, 'Timeline', zoom);
  await caption(page, 'Timeline of every retry attempt', 4500);
  await scrollTo(page, 'Steps', zoom);
  await caption(page, 'Steps, network requests and attachments', 4500);
  await scrollTo(page, 'History', zoom);
  await caption(page, 'The last 10 results for this test', 4000);

  await show(page, '#/q/flaky', 'Flaky');
  await caption(page, 'Flaky tests, scored from run history', 5000);

  await show(page, '#/q/regressions', 'Regressions');
  // Regressions depend on run timing; an empty queue is skipped, not captioned
  if (await page.locator('.pane__scroll .vlist__item').count() > 0)
    await caption(page, 'Tests that got slower than their own average', 5000);

  await show(page, '#/history/trends', 'History');
  await caption(page, 'Trends across runs', 4500);

  await show(page, '#/gallery', 'Gallery');
  await caption(page, 'Screenshots, videos and traces in one gallery', 4500);

  await show(page, '#/insights', 'Insights');
  await caption(page, 'npm i -D\nplaywright-smart-reporter', 5000);

  const video = page.video()!;
  await context.close();
  fs.mkdirSync(outDir, { recursive: true });
  await video.saveAs(path.join(outDir, `smart-reporter-${testInfo.project.name}.webm`));
});
