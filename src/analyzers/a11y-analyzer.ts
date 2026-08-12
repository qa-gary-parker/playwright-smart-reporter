import type { TestResultData, A11yResult, A11ySuiteScore, A11yImpact, A11yNode } from '../types';

export interface A11yViolationGroup {
  id: string;
  impact: A11yImpact;
  description: string;
  helpUrl: string;
  wcagTags: string[];
  count: number;
  nodes: Array<A11yNode & { testTitle: string }>;
}

/**
 * Groups the same violation rule across every scanned test, most frequent first.
 */
export function groupA11yViolations(results: TestResultData[]): A11yViolationGroup[] {
  const groups = new Map<string, A11yViolationGroup>();

  for (const test of results) {
    for (const v of test.accessibility?.violations ?? []) {
      const nodes = v.nodes.map(n => ({ ...n, testTitle: test.title }));
      const group = groups.get(v.id);
      if (group) {
        group.count++;
        group.nodes.push(...nodes);
      } else {
        groups.set(v.id, { ...v, count: 1, nodes });
      }
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

export class A11yAnalyzer {
  analyze(test: TestResultData, a11y: A11yResult | undefined): void {
    if (!a11y) return;
    test.accessibility = a11y;
  }

  calculateSuiteScore(results: TestResultData[]): A11ySuiteScore {
    let critical = 0;
    let serious = 0;
    let moderate = 0;
    let minor = 0;
    let testsScanned = 0;
    let testsWithViolations = 0;

    for (const test of results) {
      if (!test.accessibility) continue;
      testsScanned++;

      const violations = test.accessibility.violations;
      if (violations.length > 0) {
        testsWithViolations++;
      }

      for (const v of violations) {
        switch (v.impact) {
          case 'critical': critical++; break;
          case 'serious': serious++; break;
          case 'moderate': moderate++; break;
          case 'minor': minor++; break;
        }
      }
    }

    let rating: A11ySuiteScore['rating'];
    if (critical > 0) {
      rating = 'poor';
    } else if (serious > 0 || moderate > 0) {
      rating = 'fair';
    } else if (minor > 0) {
      rating = 'good';
    } else {
      rating = 'excellent';
    }

    return {
      totalViolations: critical + serious + moderate + minor,
      critical,
      serious,
      moderate,
      minor,
      testsWithViolations,
      testsScanned,
      rating,
      topViolationIds: groupA11yViolations(results).slice(0, 5).map(g => g.id),
    };
  }
}
