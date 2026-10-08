import type { TestResultData, A11yImpact, A11yRuleSummary, A11ySummary } from '../types';

const IMPACT_ORDER: A11yImpact[] = ['critical', 'serious', 'moderate', 'minor'];

/**
 * Run-level accessibility summary for ReportData; undefined when no test was scanned.
 */
export function summarizeA11y(results: TestResultData[]): A11ySummary | undefined {
  const scanned = results.filter(r => r.a11y);
  if (scanned.length === 0) return undefined;

  const byImpact: Record<A11yImpact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  const rules = new Map<string, A11yRuleSummary>();
  const pages = new Set<string>();
  let testsWithViolations = 0;

  for (const test of scanned) {
    const { violations, url } = test.a11y!;
    if (url) pages.add(url);
    if (violations.length > 0) testsWithViolations++;

    for (const v of violations) {
      byImpact[v.impact]++;
      const rule = rules.get(v.id);
      if (rule) {
        rule.nodes += v.nodes.length;
        if (!rule.testIds.includes(test.testId)) {
          rule.testIds.push(test.testId);
          rule.tests++;
        }
      } else {
        rules.set(v.id, {
          id: v.id,
          impact: v.impact,
          description: v.description,
          helpUrl: v.helpUrl,
          wcagTags: v.wcagTags,
          tests: 1,
          nodes: v.nodes.length,
          testIds: [test.testId],
        });
      }
    }
  }

  const byRule = [...rules.values()].sort((a, b) =>
    b.tests - a.tests ||
    IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact) ||
    a.id.localeCompare(b.id));

  let rating: A11ySummary['rating'];
  if (byImpact.critical > 0) {
    rating = 'poor';
  } else if (byImpact.serious > 0 || byImpact.moderate > 0) {
    rating = 'fair';
  } else if (byImpact.minor > 0) {
    rating = 'good';
  } else {
    rating = 'excellent';
  }

  return {
    testsScanned: scanned.length,
    testsWithViolations,
    pagesScanned: pages.size,
    totalViolations: IMPACT_ORDER.reduce((sum, impact) => sum + byImpact[impact], 0),
    byImpact,
    byRule,
    rating,
  };
}
