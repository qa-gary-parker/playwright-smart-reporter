import type { TestResultData, A11yResult, A11ySuiteScore } from '../types';

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
    const violationCounts = new Map<string, number>();

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
        violationCounts.set(v.id, (violationCounts.get(v.id) ?? 0) + 1);
      }
    }

    const totalViolations = critical + serious + moderate + minor;

    const topViolationIds = [...violationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

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
      totalViolations,
      critical,
      serious,
      moderate,
      minor,
      testsWithViolations,
      testsScanned,
      rating,
      topViolationIds,
    };
  }
}
