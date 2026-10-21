import { expect, test } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = path.resolve(__dirname, '../../../.ui-specimen');
const url = (query: string, hash = '') => pathToFileURL(path.join(DIR, 'preview.html')).href + `?${query}` + hash;
const detailHeading = (page: import('@playwright/test').Page) => page.getByRole('article', { name: 'Test detail' }).getByRole('heading', { level: 2 });

test('a deep link restores queue, filter, and test from a cold load over file://', async ({ page }) => {
  const id = '[Desktop Chrome] feature-demo.spec.ts::@regression docs link navigates correctly';
  await page.goto(url('mode=light', `#/q/all?q=${encodeURIComponent('tag:@regression')}&test=${encodeURIComponent(id)}`));
  await expect(page.getByRole('link', { name: /All tests/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('search').getByText('@regression')).toBeVisible();
  await expect(page.locator('.pane__count')).toHaveText('2');
  await expect(detailHeading(page)).toHaveText(/@regression docs link navigates correctly/);
});

test('j and k move the selection through the list and the hash follows', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  const tree = page.getByRole('tree', { name: 'Failures' });
  const selected = tree.getByRole('treeitem', { selected: true });
  await expect(selected).toContainText('pays with a saved card');
  await page.keyboard.press('j');
  await expect(selected).toContainText('incorrect text content causes failure');
  const hashQuery = new URLSearchParams(new URL(page.url()).hash.split('?')[1]);
  expect(hashQuery.get('test')).toBe('[Desktop Chrome] feature-demo.spec.ts::incorrect text content causes failure');
  await page.keyboard.press('k');
  await expect(selected).toContainText('pays with a saved card');
});

test('the palette finds a test from part of its name and opens it on Enter', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light'));
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: 'Search tests, views, filters, and actions' });
  await expect(input).toBeFocused();
  await input.fill('multi-step');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(detailHeading(page)).toHaveText(/multi-step user journey/);
});

test('filter tokens narrow the list and Backspace removes the last token', async ({ page }) => {
  await page.goto(url('screen=all&mode=light'));
  await expect(page.locator('.pane__count')).toHaveText('57');
  const input = page.getByRole('textbox', { name: 'Filter tests' });
  await input.fill('status:skipped ');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('search').getByText('skipped', { exact: true })).toBeVisible();
  await expect(page.locator('.pane__count')).toHaveText('6');
  await input.fill('');
  await page.keyboard.press('Backspace');
  await expect(page.locator('.pane__count')).toHaveText('57');
});

test('group counts add up to the queue total in single-key groupings', async ({ page }) => {
  // Tall enough that the virtual list renders every group header.
  await page.setViewportSize({ width: 1280, height: 4000 });
  for (const g of ['file', 'project', 'status', 'grade', 'suite', 'cluster']) {
    await page.goto(url('mode=light', `#/q/all?g=${g}`));
    const total = Number(await page.locator('.pane__count').textContent());
    const counts = await page.locator('.group__count').allTextContents();
    expect(counts.reduce((n, c) => n + Number(c), 0), `grouping ${g}`).toBe(total);
  }
});

test('the group-by menu switches grouping and the URL records it', async ({ page }) => {
  await page.goto(url('screen=all&mode=light'));
  await page.getByRole('button', { name: 'Group by' }).click();
  await page.getByRole('menuitemradio', { name: 'Tag' }).click();
  await expect(page.getByRole('treeitem', { level: 1, name: /@smoke/ })).toBeVisible();
  expect(new URL(page.url()).hash).toContain('g=tag');
});

test('c copies a failure summary of the selected test', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(url('screen=failures&mode=light'));
  await page.keyboard.press('c');
  await expect(page.getByRole('status')).toHaveText('Failure summary copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text.split('\n').slice(0, 2)).toEqual([
    '**FAILED** Desktop Chrome › checkout › saved cards › pays with a saved card and applies the loyalty discount when the basket holds a subscription',
    '`checkout/payments/saved-card.spec.ts:128` · Desktop Chrome · 6.4s · 4 attempts',
  ]);
});

test('? opens the keymap with every binding', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(dialog).toBeVisible();
  for (const label of ['Next or previous test', 'Previous or next failure', 'Next flaky test', 'Command palette', 'Filter tests', 'Copy failure summary', 'Toggle sidebar']) {
    await expect(dialog.getByText(label)).toBeVisible();
  }
});

test('g then i goes to Insights, and 1 returns to Failures', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { level: 1, name: 'Failures' })).toBeVisible();
});

test('the theme menu applies a mode and remembers it', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light'));
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('smart-reporter:theme'))).toBe('{"mode":"dark","accent":"default"}');
});

test('a trend bar opens the recorded run read-only, and Back returns', async ({ page }) => {
  await page.goto(url('screen=history&tab=trends&mode=light'));
  await page.locator('.trend').first().locator('rect.trend__bar').nth(-2).click();
  await expect(page.getByRole('status').filter({ hasText: 'Read only' })).toBeVisible();
  await expect(page.locator('.pane__count')).toHaveText('12');
  await page.getByRole('button', { name: 'Back to current run' }).click();
  await expect(page.locator('.pane__count')).toHaveText('57');
});

test('10,000 rows render a window, scroll smoothly, and show the right rows', async ({ page }) => {
  await page.goto(url('screen=all&mode=light&scale=10000', '#/q/all?g=none'));
  await expect(page.locator('.pane__count')).toHaveText('10000');
  const scroller = page.getByRole('tree', { name: 'All tests' });
  expect(await page.locator('.vlist__item').count()).toBeLessThan(80);

  const frames = await scroller.evaluate(async (el) => {
    const deltas: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 90; i++) {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * (i / 89);
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    deltas.sort((a, b) => a - b);
    return { p95: deltas[Math.floor(deltas.length * 0.95)] };
  });
  expect(frames.p95).toBeLessThan(50);

  for (const index of [0, 5000, 9999]) {
    await scroller.evaluate((el, i) => (el.scrollTop = i * 32), index);
    await expect(page.locator('.row__name').filter({ hasText: new RegExp(` #${index}$`) })).toHaveCount(1);
  }
});

test('the coverage view lists the least covered file first and shows hit counts', async ({ page }) => {
  await page.goto(url('screen=coverage&mode=light'));
  const rows = page.getByRole('table', { name: 'Coverage by file' }).getByRole('row');
  await expect(rows.nth(1)).toContainText('app/src/format.ts');
  await expect(rows.nth(1)).toContainText('66.66%');
  await page.getByRole('button', { name: 'app/src/math.ts' }).click();
  const src = page.getByLabel('Source of app/src/math.ts with hit counts');
  await expect(src.locator('[data-state="miss"]')).toHaveCount(2);
  await expect(src.locator('.cov-src__line').nth(5)).toContainText('return a * b;');
  await expect(src.locator('.cov-src__line').nth(5)).toHaveAttribute('data-state', 'miss');
});

test('skip to content moves focus to the main area and keeps the route', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light'));
  const before = page.url();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  expect(page.url()).toBe(before);
});

test('switching tests resets per-test state such as an expanded stack', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  await page.getByRole('button', { name: /Show all 37 lines/ }).click();
  await expect(page.getByRole('button', { name: /Show all 37 lines/ })).toHaveCount(0);
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  await expect(page.getByRole('button', { name: /Show all 37 lines/ })).toBeVisible();
});

test('filter edits replace the history entry instead of adding one per edit', async ({ page }) => {
  await page.goto(url('screen=all&mode=light'));
  const length = await page.evaluate(() => history.length);
  const input = page.getByRole('textbox', { name: 'Filter tests' });
  for (const text of ['h', 'h2', 'h2 should']) await input.fill(text);
  await expect(page.locator('.pane__count')).toHaveText('2');
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('timeline marker lines stay within the lanes and below the anomaly note', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  const note = page.getByRole('note');
  await note.scrollIntoViewIfNeeded();
  const noteBox = (await note.boundingBox())!;
  const lanes = page.locator('.timeline__track .timeline__lane');
  const firstLane = (await lanes.first().boundingBox())!;
  const lastLane = (await lanes.last().boundingBox())!;
  for (const line of ['.timeline__marker', '.timeline__playhead']) {
    const box = (await page.locator(line).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height);
    expect(Math.round(box.y)).toBe(Math.round(firstLane.y));
    expect(Math.round(box.y + box.height)).toBe(Math.round(lastLane.y + lastLane.height));
  }
});

test('clicking the timeline slider moves the playhead to the point clicked', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  const scrub = page.getByRole('slider', { name: 'Scrub the test timeline' });
  await scrub.scrollIntoViewIfNeeded();
  const track = (await page.locator('.timeline__track').boundingBox())!;
  const slider = (await scrub.boundingBox())!;
  for (const f of [0.25, 0.75]) {
    const x = track.x + track.width * f;
    await page.mouse.click(x, slider.y + slider.height / 2);
    const head = (await page.locator('.timeline__playhead').boundingBox())!;
    expect(Math.abs(head.x + head.width / 2 - x)).toBeLessThanOrEqual(3);
  }
});

test('the top bar counts each test once, so the counts add up to the total', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light'));
  const values = await page.getByLabel('Run result').locator('.count__value').allTextContents();
  expect(values.map(Number).reduce((a, b) => a + b, 0)).toBe(57);
});

test('the retry comparison appears for a test that failed and then passed, and not for one that always failed', async ({ page }) => {
  await page.goto(url('screen=flaky&mode=light'));
  await page.getByRole('treeitem').filter({ hasText: /Desktop Chrome.*flaky behavior - random failure/ }).click();
  await expect(page.getByRole('table', { name: 'Steps by attempt' })).toBeVisible();
  await page.goto(url('screen=failures&mode=light'));
  await expect(page.getByRole('heading', { level: 2 })).toContainText('pays with a saved card');
  await expect(page.getByRole('table', { name: 'Steps by attempt' })).toHaveCount(0);
});

test('a failed attempt shows its own screenshot and trace in the Attempts section', async ({ page }) => {
  await page.addInitScript(() => {
    let value: unknown;
    Object.defineProperty(window, '__SMART_DATA__', {
      configurable: true,
      get: () => value,
      set: (d: { tests: Array<{ testId: string; attempts?: Array<{ attachments?: object }> }> }) => {
        const flaky = d.tests.find((t) => t.testId === '[Desktop Chrome] demo.spec.ts::flaky behavior - random failure')!;
        flaky.attempts![0].attachments = { screenshots: ['data:image/png;base64,iVBORw0KGgo='], videos: [], traces: ['./traces/flaky-attempt-1-trace-0.zip'] };
        value = d;
      },
    });
  });
  await page.goto(url('screen=flaky&mode=light'));
  await page.getByRole('treeitem').filter({ hasText: /Desktop Chrome.*flaky behavior - random failure/ }).click();
  const evidence = page.getByRole('group', { name: 'Attempt 1 attachments' });
  await expect(evidence.getByRole('button', { name: 'Open Screenshot 1' })).toBeVisible();
  expect(await evidence.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe('./traces/flaky-attempt-1-trace-0.zip');
  await expect(page.getByRole('group', { name: /^Attempt \d+ attachments$/ })).toHaveCount(1);
});

test('views and tabs for features that are off cannot be opened by URL or shortcut', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light&off=gallery,trends,comparison', '#/gallery'));
  await expect(page).toHaveURL(/#\/insights$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();

  await page.keyboard.press('5');
  await expect(page).toHaveURL(/#\/insights$/);
  await page.keyboard.press('4');
  await expect(page).toHaveURL(/#\/history\/heatmap$/);
  await expect(page.getByRole('tab')).toHaveText(['Reliability']);

  await page.goto(url('screen=insights&mode=light&off=gallery,trends,comparison', '#/history/compare'));
  await expect(page).toHaveURL(/#\/history\/heatmap$/);

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog').getByText(/^Failures, All tests, Insights, History/)).toHaveText('Failures, All tests, Insights, History');
});

test('export menu links reach the files next to the report, whatever the report is called', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light&exports=junit,pdf,pdfFull&base=' + encodeURIComponent('smart #1 report')));
  await page.getByRole('button', { name: 'Export' }).click();
  const menu = page.getByRole('menu', { name: 'Export' });
  // exportPdfFull writes one PDF, so the executive variants are not offered.
  await expect(menu.getByRole('menuitem').filter({ hasText: /PDF/ })).toHaveText(['PDF report']);
  await page.evaluate(() => {
    window.open = (u?: string | URL) => ((window as unknown as { opened: string }).opened = new URL(String(u), location.href).href, null);
  });
  await menu.getByRole('menuitem', { name: 'JUnit XML' }).click();
  expect(await page.evaluate(() => (window as unknown as { opened: string }).opened)).toMatch(/\/smart%20%231%20report-junit\.xml$/);
});

test('the network section counts every request in the trace, not just the ones kept', async ({ page }) => {
  await page.goto(url('screen=failures&mode=light'));
  const detail = page.getByRole('article', { name: 'Test detail' });
  await expect(detail.locator('summary').filter({ hasText: /^Network/ })).toHaveText(/Network\s*12 requests, 5 shown · 1 failed/);
});

test('AI panels say AI is off when it was switched off, rather than not configured', async ({ page }) => {
  await page.goto(url('screen=insights&mode=light&ai=off'));
  await expect(page.locator('.panel').filter({ hasText: 'AI summary' }).locator('.panel__empty')).toHaveText('AI is off for this run (enableAIRecommendations or enableAISuiteHealth is false).');
  await page.goto(url('mode=light&ai=off', `#/q/failures?test=${encodeURIComponent('[Desktop Chrome] demo.spec.ts::broken login - element not found')}`));
  await expect(page.getByRole('article', { name: 'Test detail' }).locator('details').filter({ hasText: /^AI analysis/ }).locator('p.muted')).toHaveText(
    'AI analysis is off for this run (enableAIRecommendations is false). Copy AI prompt gives you the prompt to use elsewhere.',
  );
});

test('attachment links survive a # or % in the file name', async ({ page }) => {
  // Change the data as the preview assigns it, before the app reads it.
  await page.addInitScript(() => {
    let value: unknown;
    Object.defineProperty(window, '__SMART_DATA__', {
      configurable: true,
      get: () => value,
      set: (d: { tests: Array<{ attachments?: { traces: string[] } }> }) => {
        d.tests[0].attachments!.traces = ['./traces/pays #1 at 100%-trace-0.zip'];
        value = d;
      },
    });
  });
  await page.goto(url('screen=failures&mode=light'));
  const download = page.getByRole('article', { name: 'Test detail' }).getByRole('link', { name: 'Download' });
  expect(await download.getAttribute('href')).toBe('./traces/pays%20%231%20at%20100%25-trace-0.zip');
});

test('the Compare tab lists tests that did not run in the baseline run in their own group', async ({ page }) => {
  await page.goto(url('mode=light', '#/history/compare'));
  const tree = page.getByRole('tree', { name: 'Changes since the baseline run' });
  await expect(tree.getByRole('treeitem', { level: 1 })).toHaveText([
    /^New failures\s*0$/,
    /^Performance regressions\s*3$/,
    /^Fixed\s*0$/,
    /^Performance improvements\s*1$/,
    /^New tests\s*0$/,
    /^Not in baseline run\s*1$/,
  ]);
  await expect(tree.getByRole('treeitem', { level: 2 }).last()).toContainText('homepage loads and displays heading');
});
