import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const report = path.resolve(__dirname, '../example/smart-report.html');
const reportData = path.resolve(__dirname, '../example/smart-report-data.json');
const outDir = path.resolve(__dirname, 'out');
const NARROW = '(max-width: 899px)';

async function caption(page: Page, text: string, holdMs: number) {
  await page.evaluate(t => { document.getElementById('demo-caption')!.textContent = t; }, text);
  await page.waitForTimeout(holdMs);
}

function runCounts() {
  const data = JSON.parse(fs.readFileSync(reportData, 'utf8'));
  const failed: number = data.summary.failed;
  const clusters: { count: number }[] = data.failureClusters;
  // A failure outside every cluster is a cause of its own
  const causes = clusters.length + failed - clusters.reduce((n, c) => n + c.count, 0);
  return { failed, causes };
}

// The right half stays empty for YouTube's end-screen elements; zoom undoes the page zoom
async function endCard(page: Page, zoom: number, rows: [string, string][], summary: string) {
  await page.evaluate(([z, rows, summary]) => {
    const add = (parent: HTMLElement, css: string, text = '') => {
      const el = parent.appendChild(document.createElement('div'));
      el.style.cssText = css;
      el.textContent = text;
      return el;
    };
    const card = add(document.body, `position:fixed;inset:0;z-index:100000;zoom:${1 / (z as number)};box-sizing:border-box;padding:112px 128px;background:#0B0D0C;color:#E6E8E3;font:36px/1.3 ui-monospace,Menlo,monospace`);
    const brand = add(card, 'display:flex;align-items:center;gap:16px;color:#3FB950;font-size:30px', 'gary-parker');
    brand.prepend(Object.assign(document.createElement('span'), { style: 'width:20px;height:20px;border-radius:10px;background:#3FB950' }));
    (rows as [string, string][]).forEach(([key, value], i) => {
      add(card, `margin-top:${i ? 52 : 124}px;color:#8A9088;font-size:24px;letter-spacing:.12em;text-transform:uppercase`, key);
      const row = add(card, 'margin-top:16px', value.replace(/^\$ /, ''));
      if (value.startsWith('$ ')) row.prepend(Object.assign(document.createElement('span'), { textContent: '$ ', style: 'color:#3FB950' }));
    });
    add(card, 'position:absolute;left:128px;bottom:96px;color:#8A9088;font-size:26px', summary as string);
  }, [zoom, rows, summary] as const);
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
  const start = Date.now();
  const cues: string[] = [];
  const say = async (text: string, holdMs: number, spoken = text) => {
    cues.push(`${((Date.now() - start) / 1000).toFixed(2)}\t${spoken}`);
    await caption(page, text, holdMs);
  };
  const { failed, causes } = runCounts();
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

  // Hook with the run's own numbers, then the problem, then the tool; the Short skips the long tour and the install line
  await expect(page.locator('main').getByRole('heading', { name: 'Insights' })).toBeVisible();
  await say(`${failed} tests failed. ${causes} causes.`, 4000, `${failed} tests failed in this run, from ${causes} causes.`);
  await say(`The default report lists all ${failed}, one by one`, 4500, `Playwright's default report lists all ${failed}, one by one.`);

  await show(page, '#/q/failures', 'Failures');
  await say('Smart Reporter groups them by the error they share', 5000, 'Playwright Smart Reporter groups them by the error they share.');
  if (portrait) await page.locator('.pane__scroll .vlist__item').nth(1).click();
  await expect(page.locator('article.detail')).toBeVisible();
  await say('Error, call log and the failing line', 5000, 'Each failure shows the error, the call log and the failing line.');
  await scrollTo(page, 'Timeline', zoom);
  await say('Every retry attempt on a timeline', 4500, 'A timeline shows every retry attempt.');
  if (!portrait) {
    await scrollTo(page, 'History', zoom);
    await say('The last 10 results for this test', 4000, 'And the last ten results for this test.');
  }

  await show(page, '#/q/flaky', 'Flaky');
  await say('Flaky tests, scored from run history', 5000, 'Flaky tests get a score from run history.');

  if (!portrait) {
    await show(page, '#/q/regressions', 'Regressions');
    // Regressions depend on run timing; an empty queue is skipped, not captioned
    if (await page.locator('.pane__scroll .vlist__item').count() > 0)
      await say('Tests slower than their own average', 5000, 'Tests slower than their own average are flagged.');

    await show(page, '#/history/trends', 'History');
    await say('Pass rate and duration across runs', 4500);

    await show(page, '#/gallery', 'Gallery');
    await say('Screenshots, videos and traces in one gallery', 4500);
  }

  await show(page, '#/q/failures', 'Failures');
  await say(`${causes} causes to fix, not ${failed} failures to read`, 5000, `${causes} causes to fix, not ${failed} failures to read.`);

  if (!portrait) {
    await endCard(page, zoom, [
      ['install', '$ npm i -D playwright-smart-reporter'],
      ['source', 'github.com/qa-gary-parker/playwright-smart-reporter'],
      ['more tools + write-ups', 'garyparker.dev'],
    ], `✓ ${failed} failures   ✓ ${causes} causes to fix`);
    await say('', 10000, 'Install it from npm: playwright smart reporter. The links are in the description.');
  }

  const video = page.video()!;
  await context.close();
  fs.mkdirSync(outDir, { recursive: true });
  await video.saveAs(path.join(outDir, `smart-reporter-${testInfo.project.name}.webm`));
  fs.writeFileSync(path.join(outDir, `narration-${testInfo.project.name}.tsv`), cues.join('\n') + '\n');
});
