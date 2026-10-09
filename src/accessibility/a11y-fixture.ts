import { test as base, type Page } from '@playwright/test';
import type { AccessibilityConfig, A11yResult, A11yViolation, A11yImpact } from '../types';
import { A11Y_ATTACHMENT_NAME } from '../collectors/a11y-collector';

const WCAG_TAG_MAP: Record<string, string[]> = {
  WCAG2A: ['wcag2a', 'wcag21a'],
  WCAG2AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  WCAG2AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa'],
};

const SEVERITY_ORDER: A11yImpact[] = ['minor', 'moderate', 'serious', 'critical'];

const BLANK_PAGE = '<html><head></head><body></body></html>';

function meetsOrExceedsSeverity(impact: A11yImpact, threshold: A11yImpact): boolean {
  return SEVERITY_ORDER.indexOf(impact) >= SEVERITY_ORDER.indexOf(threshold);
}

function emptyResult(page: Page, standard: string): A11yResult {
  return {
    violations: [],
    passes: 0,
    incomplete: 0,
    inapplicable: 0,
    timestamp: new Date().toISOString(),
    standard,
    url: page.url(),
  };
}

async function runAxeAnalysis(page: Page, config: AccessibilityConfig): Promise<A11yResult> {
  const standard = config.standard || 'WCAG2AA';

  let AxeBuilder: any;
  try {
    // @axe-core/playwright is an optional peer dependency
    const axeModule = await import('@axe-core/playwright');
    AxeBuilder = axeModule.default || axeModule.AxeBuilder;
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn('[smart-reporter] @axe-core/playwright not installed. Skipping accessibility scan.');
      return emptyResult(page, standard);
    }
    throw err;
  }

  // Fall back to AA if a JS caller passed a standard outside the documented set.
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAG_MAP[standard] ?? WCAG_TAG_MAP.WCAG2AA);
  if (config.include?.length) {
    builder = builder.withRules(config.include);
  }
  if (config.exclude?.length) {
    builder = builder.disableRules(config.exclude);
  }
  if (config.selector) {
    builder = builder.include(config.selector);
  }

  const results = await builder.analyze();

  const violations: A11yViolation[] = results.violations.map((v: any) => ({
    id: v.id,
    impact: v.impact as A11yImpact,
    description: v.description,
    helpUrl: v.helpUrl,
    wcagTags: v.tags?.filter((t: string) => t.startsWith('wcag')) || [],
    nodes: v.nodes.map((n: any) => ({
      target: n.target,
      html: n.html,
      failureSummary: n.failureSummary || '',
    })),
  }));

  return {
    violations,
    passes: results.passes?.length || 0,
    incomplete: results.incomplete?.length || 0,
    inapplicable: results.inapplicable?.length || 0,
    timestamp: new Date().toISOString(),
    standard,
    url: page.url(),
  };
}

export const test = base.extend<{ smartReporterA11y: AccessibilityConfig | undefined }>({
  smartReporterA11y: [undefined, { option: true }],

  page: async ({ page, smartReporterA11y: config }, use, testInfo) => {
    await use(page);

    if (!config?.enabled || page.isClosed()) return;

    let result: A11yResult;
    try {
      // A page the test never navigated or filled only reports its missing title and lang.
      if (page.url() === 'about:blank' && (await page.content()) === BLANK_PAGE) return;
      result = await runAxeAnalysis(page, config);
    } catch (err) {
      console.warn(`[smart-reporter] Accessibility scan skipped for "${testInfo.title}": ${err instanceof Error ? err.message : err}`);
      return;
    }

    await testInfo.attach(A11Y_ATTACHMENT_NAME, {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });

    const failOnSeverity = config.failOnSeverity;
    if (!failOnSeverity) return;

    const failing = result.violations.filter(v => meetsOrExceedsSeverity(v.impact, failOnSeverity));
    if (failing.length === 0) return;

    const summary = failing
      .map(v => `  - [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`)
      .join('\n');
    throw new Error(`Accessibility violations found at or above "${failOnSeverity}" severity:\n${summary}`);
  },
});
