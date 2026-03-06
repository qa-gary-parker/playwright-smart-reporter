import { test as base, type Page } from '@playwright/test';
import type { AccessibilityConfig, A11yResult, A11yViolation, A11yImpact } from '../types';

const WCAG_TAG_MAP: Record<string, string[]> = {
  WCAG2A: ['wcag2a', 'wcag21a'],
  WCAG2AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
  WCAG2AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa'],
};

const SEVERITY_ORDER: A11yImpact[] = ['minor', 'moderate', 'serious', 'critical'];

function meetsOrExceedsSeverity(impact: A11yImpact, threshold: A11yImpact): boolean {
  return SEVERITY_ORDER.indexOf(impact) >= SEVERITY_ORDER.indexOf(threshold);
}

async function runAxeAnalysis(page: Page, config: AccessibilityConfig): Promise<A11yResult> {
  let AxeBuilder: any;
  try {
    // @ts-expect-error - @axe-core/playwright is an optional peer dependency
    const axeModule = await import('@axe-core/playwright');
    AxeBuilder = axeModule.default || axeModule.AxeBuilder;
  } catch (err: any) {
    if (err?.code === 'MODULE_NOT_FOUND' || err?.code === 'ERR_MODULE_NOT_FOUND') {
      console.warn('[smart-reporter] @axe-core/playwright not installed. Skipping accessibility scan.');
      return {
        violations: [],
        passes: 0,
        incomplete: 0,
        inapplicable: 0,
        timestamp: new Date().toISOString(),
        standard: config.standard || 'WCAG2AA',
        url: page.url(),
      };
    }
    throw err;
  }

  let builder = new AxeBuilder({ page });

  const standard = config.standard || 'WCAG2AA';
  const tags = WCAG_TAG_MAP[standard];
  if (tags) {
    builder = builder.withTags(tags);
  }

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

  page: async ({ page, smartReporterA11y }, use, testInfo) => {
    await use(page);

    if (!smartReporterA11y?.enabled) return;

    const config = smartReporterA11y;
    const a11yResult = await runAxeAnalysis(page, config);

    let tree;
    try {
      tree = await (page as any).accessibility.snapshot();
    } catch {
      // accessibility.snapshot() may not be available in all contexts
    }

    const result: A11yResult = {
      ...a11yResult,
      tree: tree ? { role: tree.role, name: tree.name, children: tree.children as any } : undefined,
    };

    await testInfo.attach('smart-reporter-a11y', {
      body: JSON.stringify(result),
      contentType: 'application/json',
    });

    if (config.failOnSeverity) {
      const failingViolations = result.violations.filter(
        (v) => meetsOrExceedsSeverity(v.impact, config.failOnSeverity!)
      );
      if (failingViolations.length > 0) {
        const summary = failingViolations
          .map((v) => `  - [${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} nodes)`)
          .join('\n');
        throw new Error(
          `Accessibility violations found at or above "${config.failOnSeverity}" severity:\n${summary}`
        );
      }
    }
  },
});
