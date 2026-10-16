import type {
  TestResultData,
  QualityGateConfig,
  QualityGateResult,
  QualityGateRuleResult,
  RunComparison,
  A11yImpact,
} from '../types';
import type { CoverageSummary } from '../report-data/schema';
import { isFailedTest, isPassedTest } from '../utils/flakiness';

const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
const reverseGradeMap: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'F' };

// Sign of (count/total*100 - threshold), in integers so boundaries are exact.
// The threshold is scaled by its own decimal places, so 99.4 compares as 994/10.
function compareRate(count: number, total: number, threshold: number): number {
  const scale = 10 ** (String(threshold).split('.')[1]?.length ?? 0);
  return count * 100 * scale - Math.round(threshold * scale) * total;
}

// Whole number when exact, otherwise 1 decimal place rounded towards the failing side.
function formatRate(count: number, total: number, round: (n: number) => number): string {
  if ((count * 100) % total === 0) return `${(count * 100) / total}%`;
  return `${(round((count * 1000) / total) / 10).toFixed(1)}%`;
}

export class QualityGateEvaluator {
  evaluate(
    config: QualityGateConfig,
    results: TestResultData[],
    comparison?: RunComparison,
    coverage?: CoverageSummary,
  ): QualityGateResult {
    const rules: QualityGateRuleResult[] = [];

    if (config.maxFailures !== undefined) {
      rules.push(this.evaluateMaxFailures(config.maxFailures, results));
    }

    if (config.minPassRate !== undefined) {
      rules.push(this.evaluateMinPassRate(config.minPassRate, results));
    }

    if (config.maxFlakyRate !== undefined) {
      rules.push(this.evaluateMaxFlakyRate(config.maxFlakyRate, results));
    }

    if (config.minStabilityGrade !== undefined) {
      rules.push(this.evaluateMinStabilityGrade(config.minStabilityGrade, results));
    }

    if (config.noNewFailures === true) {
      rules.push(this.evaluateNoNewFailures(comparison));
    }

    // Phase 10: Accessibility
    if (config.maxA11yViolations !== undefined) {
      rules.push(this.evaluateMaxA11y('maxA11yViolations', config.maxA11yViolations, results));
    }
    if (config.maxA11yCritical !== undefined) {
      rules.push(this.evaluateMaxA11y('maxA11yCritical', config.maxA11yCritical, results, 'critical'));
    }
    if (config.maxA11ySerious !== undefined) {
      rules.push(this.evaluateMaxA11y('maxA11ySerious', config.maxA11ySerious, results, 'serious'));
    }
    if (config.minCoverage !== undefined) {
      rules.push(this.evaluateMinCoverage(config.minCoverage, coverage));
    }

    const passed = rules.every(r => r.passed);
    return { passed, rules };
  }

  private evaluateMaxFailures(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const failures = results.filter(isFailedTest).length;

    return {
      rule: 'maxFailures',
      passed: failures <= threshold,
      actual: String(failures),
      threshold: `≤ ${threshold}`,
    };
  }

  private evaluateMinPassRate(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const total = results.length;
    if (total === 0) {
      return {
        rule: 'minPassRate',
        passed: true,
        actual: 'N/A',
        threshold: `≥ ${threshold}%`,
        skipped: true,
      };
    }

    const passed = results.filter(isPassedTest).length;

    return {
      rule: 'minPassRate',
      passed: compareRate(passed, total, threshold) >= 0,
      actual: formatRate(passed, total, Math.floor),
      threshold: `≥ ${threshold}%`,
    };
  }

  private evaluateMaxFlakyRate(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const total = results.length;
    if (total === 0) {
      return {
        rule: 'maxFlakyRate',
        passed: true,
        actual: '0%',
        threshold: `≤ ${threshold}%`,
      };
    }

    const flaky = results.filter(r => r.outcome === 'flaky').length;

    return {
      rule: 'maxFlakyRate',
      passed: compareRate(flaky, total, threshold) <= 0,
      actual: formatRate(flaky, total, Math.ceil),
      threshold: `≤ ${threshold}%`,
    };
  }

  private evaluateMinStabilityGrade(
    threshold: 'A' | 'B' | 'C' | 'D',
    results: TestResultData[],
  ): QualityGateRuleResult {
    const gradedTests = results.filter(r => r.stabilityScore?.grade);

    if (gradedTests.length === 0) {
      return {
        rule: 'minStabilityGrade',
        passed: true,
        actual: 'N/A',
        threshold: `≥ ${threshold}`,
        skipped: true,
      };
    }

    const sum = gradedTests.reduce(
      (acc, r) => acc + (gradeMap[r.stabilityScore!.grade] || 0),
      0,
    );
    const avgNumeric = Math.round(sum / gradedTests.length);
    const avgGrade = reverseGradeMap[avgNumeric] || 'F';

    const thresholdNumeric = gradeMap[threshold];
    const actualNumeric = gradeMap[avgGrade] || 0;

    return {
      rule: 'minStabilityGrade',
      passed: actualNumeric >= thresholdNumeric,
      actual: avgGrade,
      threshold: `≥ ${threshold}`,
    };
  }

  private evaluateMaxA11y(rule: string, threshold: number, results: TestResultData[], impact?: A11yImpact): QualityGateRuleResult {
    const scanned = results.filter(r => r.a11y);
    if (scanned.length === 0) {
      return { rule, passed: true, actual: 'N/A', threshold: `≤ ${threshold}`, skipped: true };
    }
    const count = scanned.reduce(
      (sum, r) => sum + r.a11y!.violations.filter(v => !impact || v.impact === impact).length, 0,
    );
    return { rule, passed: count <= threshold, actual: String(count), threshold: `≤ ${threshold}` };
  }

  private evaluateNoNewFailures(comparison?: RunComparison): QualityGateRuleResult {
    if (!comparison) {
      return {
        rule: 'noNewFailures',
        passed: true,
        actual: 'N/A',
        threshold: '≤ 0',
        skipped: true,
      };
    }

    const newFailureCount = comparison.changes.newFailures.length;

    return {
      rule: 'noNewFailures',
      passed: newFailureCount === 0,
      actual: String(newFailureCount),
      threshold: '≤ 0',
    };
  }

  // No coverage data fails the rule: a coverage floor that nothing measured is a misconfigured run.
  private evaluateMinCoverage(threshold: number, coverage?: CoverageSummary): QualityGateRuleResult {
    if (!coverage) {
      return {
        rule: 'minCoverage',
        passed: false,
        actual: 'no data',
        threshold: `≥ ${threshold}%`,
      };
    }

    return {
      rule: 'minCoverage',
      passed: coverage.lines.pct >= threshold,
      actual: `${coverage.lines.pct}%`,
      threshold: `≥ ${threshold}%`,
    };
  }
}
