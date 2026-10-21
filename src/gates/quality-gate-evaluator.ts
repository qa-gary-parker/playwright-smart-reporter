import type {
  TestResultData,
  QualityGateConfig,
  QualityGateResult,
  QualityGateRuleResult,
  QualityGateScope,
  RunComparison,
  ComparisonChanges,
  A11yImpact,
} from '../types';
import type { CoverageSummary } from '../report-data/schema';
import { computeRunStats, runStabilityGrade, type RunStats } from '../utils/run-stats';
import { isFailedTest } from '../utils/flakiness';
import { compilePattern } from '../analyzers/ownership';

const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };

export const GATE_RULES = ['maxFailures', 'minPassRate', 'maxFlakyRate', 'minStabilityGrade', 'noNewFailures', 'maxA11yViolations', 'maxA11yCritical', 'maxA11ySerious', 'minCoverage', 'maxDurationRegression', 'noNewFlaky'] as const satisfies ReadonlyArray<keyof QualityGateConfig>;
const SCOPE_KEYS = ['tag', 'project', 'file', 'owner'] as const satisfies ReadonlyArray<keyof QualityGateScope>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Throws on a config the evaluator would misread, so a typo cannot pass the gate. */
export function validateQualityGates(config: QualityGateConfig): void {
  if (!isObject(config)) throw new Error('quality gate config must be an object.');
  const isRule = (key: string) => (GATE_RULES as readonly string[]).includes(key);
  const unknown = Object.keys(config).find((key) => key !== 'rules' && !isRule(key));
  if (unknown) throw new Error(`unknown quality gate rule "${unknown}". Known rules: ${GATE_RULES.join(', ')}.`);
  if (config.rules === undefined) return;
  if (!Array.isArray(config.rules)) throw new Error('quality gate "rules" must be an array.');

  const ids = new Set<string>();
  config.rules.forEach((entry: unknown, i) => {
    const at = `quality gate rules[${i}]`;
    if (!isObject(entry)) throw new Error(`${at} must be an object.`);
    const { id, scope, severity, ...rule } = entry;
    const names = Object.keys(rule);
    const unknownKey = names.find((key) => !isRule(key));
    if (unknownKey) throw new Error(`unknown key "${unknownKey}" in ${at}. Known keys: id, scope, severity, ${GATE_RULES.join(', ')}.`);
    if (names.length !== 1) throw new Error(`${at} must name exactly one rule (found ${names.join(', ') || 'none'}).`);
    if (severity !== undefined && severity !== 'fail' && severity !== 'warn') throw new Error(`${at}.severity must be "fail" or "warn" (got ${JSON.stringify(severity)}).`);
    if (id !== undefined) {
      if (typeof id !== 'string') throw new Error(`${at}.id must be a string.`);
      if (ids.has(id)) throw new Error(`${at}.id "${id}" is already used by another rule.`);
      ids.add(id);
    }
    if (scope === undefined) return;
    if (!isObject(scope)) throw new Error(`${at}.scope must be an object.`);
    if (names[0] === 'minCoverage') throw new Error(`${at}: minCoverage cannot be scoped, because coverage is measured for the whole run.`);
    for (const [key, value] of Object.entries(scope)) {
      if (!(SCOPE_KEYS as readonly string[]).includes(key)) throw new Error(`unknown key "${key}" in ${at}.scope. Known keys: ${SCOPE_KEYS.join(', ')}.`);
      if (![value].flat().every((v) => typeof v === 'string')) throw new Error(`${at}.scope.${key} must be a string or an array of strings.`);
    }
  });
}

const valuesOf = (value: string | string[] | undefined) => (value === undefined ? undefined : [value].flat());

function inScope(scope: QualityGateScope): (test: TestResultData) => boolean {
  const [tags, projects, owners] = [valuesOf(scope.tag), valuesOf(scope.project), valuesOf(scope.owner)];
  const files = valuesOf(scope.file)?.map(compilePattern);
  return (t) =>
    (!tags || tags.some((tag) => t.tags?.includes(tag)))
    && (!projects || projects.includes(t.project ?? ''))
    && (!files || files.some((re) => re.test(t.file.replace(/\\/g, '/'))))
    && (!owners || owners.some((owner) => t.owners?.includes(owner)));
}

function describeScope(scope: QualityGateScope): string {
  return SCOPE_KEYS.flatMap((key) => (scope[key] === undefined ? [] : [`${key} ${valuesOf(scope[key])!.join(' or ')}`])).join(', ');
}

function scopeComparison(comparison: RunComparison | undefined, tests: TestResultData[]): RunComparison | undefined {
  if (!comparison) return undefined;
  const ids = new Set(tests.map((t) => t.testId));
  const changes = Object.fromEntries(Object.entries(comparison.changes).map(([key, list]: [string, TestResultData[]]) => [key, list.filter((t) => ids.has(t.testId))]));
  return { ...comparison, changes: changes as unknown as ComparisonChanges };
}

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
    const { rules: entries = [], ...flat } = config;
    const rules = this.evaluateRules(flat, results, comparison, coverage);

    for (const { id, scope, severity, ...rule } of entries) {
      const tests = scope ? results.filter(inScope(scope)) : results;
      const [result] = this.evaluateRules(rule, tests, scope ? scopeComparison(comparison, tests) : comparison, coverage);
      if (!result) continue;
      const scopeText = scope && describeScope(scope);
      rules.push({
        ...(scope && tests.length === 0 ? { ...result, passed: true, actual: 'N/A', skipped: true, skipReason: 'no test in scope' } : result),
        ...(id !== undefined && { id }),
        ...(scopeText && { scope: scopeText }),
        ...(severity === 'warn' && { severity }),
      });
    }

    const passed = rules.every(r => r.passed || r.severity === 'warn');
    return { passed, rules };
  }

  private evaluateRules(
    config: Omit<QualityGateConfig, 'rules'>,
    results: TestResultData[],
    comparison?: RunComparison,
    coverage?: CoverageSummary,
  ): QualityGateRuleResult[] {
    const rules: QualityGateRuleResult[] = [];
    const stats = computeRunStats(results);

    if (config.maxFailures !== undefined) {
      rules.push(this.evaluateMaxFailures(config.maxFailures, stats));
    }

    if (config.minPassRate !== undefined) {
      rules.push(this.evaluateMinPassRate(config.minPassRate, stats));
    }

    if (config.maxFlakyRate !== undefined) {
      rules.push(this.evaluateMaxFlakyRate(config.maxFlakyRate, stats));
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
    if (config.maxDurationRegression !== undefined) {
      rules.push(this.evaluateMaxDurationRegression(config.maxDurationRegression, results));
    }
    if (config.noNewFlaky === true) {
      rules.push(this.evaluateNoNewFlaky(comparison));
    }

    return rules;
  }

  // The tests the performance analyzer compared: passed now, with enough passing runs for a median.
  // Summed, so one test's jitter does not decide the gate.
  private evaluateMaxDurationRegression(threshold: number, results: TestResultData[]): QualityGateRuleResult {
    const compared = results.flatMap(r => r.performanceMetrics ?? []);
    if (compared.length === 0) {
      return { rule: 'maxDurationRegression', passed: true, actual: 'N/A', threshold: `≤ ${threshold}%`, skipped: true, skipReason: 'no duration history' };
    }
    const median = compared.reduce((sum, m) => sum + m.averageDuration, 0);
    const added = compared.reduce((sum, m) => sum + m.currentDuration, 0) - median;
    return {
      rule: 'maxDurationRegression',
      passed: compareRate(added, median, threshold) <= 0,
      actual: formatRate(added, median, Math.ceil),
      threshold: `≤ ${threshold}%`,
    };
  }

  // Counts a flaky test that did not run in the baseline run, as noNewFailures counts a failing one.
  private evaluateNoNewFlaky(comparison?: RunComparison): QualityGateRuleResult {
    // JSON exported before 4.0.0 has no newFlaky.
    if (!comparison?.changes.newFlaky) {
      return { rule: 'noNewFlaky', passed: true, actual: 'N/A', threshold: '≤ 0', skipped: true, skipReason: 'no comparison data' };
    }
    const count = comparison.changes.newFlaky.length + (comparison.changes.notInBaseline ?? []).filter(t => t.outcome === 'flaky').length;
    return { rule: 'noNewFlaky', passed: count === 0, actual: String(count), threshold: '≤ 0' };
  }

  private evaluateMaxFailures(threshold: number, { failed }: RunStats): QualityGateRuleResult {
    return {
      rule: 'maxFailures',
      passed: failed <= threshold,
      actual: String(failed),
      threshold: `≤ ${threshold}`,
    };
  }

  private evaluateMinPassRate(threshold: number, { passed, rated }: RunStats): QualityGateRuleResult {
    if (rated === 0) {
      return {
        rule: 'minPassRate',
        passed: true,
        actual: 'N/A',
        threshold: `≥ ${threshold}%`,
        skipped: true,
        skipReason: 'no test ran',
      };
    }

    return {
      rule: 'minPassRate',
      passed: compareRate(passed, rated, threshold) >= 0,
      actual: formatRate(passed, rated, Math.floor),
      threshold: `≥ ${threshold}%`,
    };
  }

  // Out of the same tests as the pass rate: the ones that ran.
  private evaluateMaxFlakyRate(threshold: number, { flaky, rated }: RunStats): QualityGateRuleResult {
    if (rated === 0) {
      return {
        rule: 'maxFlakyRate',
        passed: true,
        actual: 'N/A',
        threshold: `≤ ${threshold}%`,
        skipped: true,
        skipReason: 'no test ran',
      };
    }

    return {
      rule: 'maxFlakyRate',
      passed: compareRate(flaky, rated, threshold) <= 0,
      actual: formatRate(flaky, rated, Math.ceil),
      threshold: `≤ ${threshold}%`,
    };
  }

  private evaluateMinStabilityGrade(
    threshold: 'A' | 'B' | 'C' | 'D',
    results: TestResultData[],
  ): QualityGateRuleResult {
    const avgGrade = runStabilityGrade(results);

    if (!avgGrade) {
      return {
        rule: 'minStabilityGrade',
        passed: true,
        actual: 'N/A',
        threshold: `≥ ${threshold}`,
        skipped: true,
        skipReason: 'no stability grades',
      };
    }

    return {
      rule: 'minStabilityGrade',
      passed: gradeMap[avgGrade] >= gradeMap[threshold],
      actual: avgGrade,
      threshold: `≥ ${threshold}`,
    };
  }

  private evaluateMaxA11y(rule: string, threshold: number, results: TestResultData[], impact?: A11yImpact): QualityGateRuleResult {
    const scanned = results.filter(r => r.a11y);
    if (scanned.length === 0) {
      return { rule, passed: true, actual: 'N/A', threshold: `≤ ${threshold}`, skipped: true, skipReason: 'no accessibility scans' };
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
        skipReason: 'no comparison data',
      };
    }

    // A failing test that did not run in the baseline run may be new, so a partial baseline cannot pass it silently.
    // JSON exported before 4.0.0 has no notInBaseline.
    const newFailureCount = comparison.changes.newFailures.length + (comparison.changes.notInBaseline ?? []).filter(isFailedTest).length;

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
