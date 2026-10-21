import type { QualityGateResult, QualityGateRuleResult } from '../types';

export const ruleLabels: Record<string, string> = {
  maxFailures: 'Max failures',
  minPassRate: 'Min pass rate',
  maxFlakyRate: 'Max flaky rate',
  minStabilityGrade: 'Min stability grade',
  noNewFailures: 'No new failures',
  maxA11yViolations: 'Max a11y violations',
  maxA11yCritical: 'Max a11y critical',
  maxA11ySerious: 'Max a11y serious',
  minCoverage: 'Min line coverage',
  maxDurationRegression: 'Max duration regression',
  noNewFlaky: 'No new flaky tests',
  noNewClusters: 'No new clusters',
  noExpiredQuarantine: 'No expired quarantine',
};

/** The rule's id, or its label with its scope, so two rules of the same kind can be told apart. */
export function ruleLabel(rule: QualityGateRuleResult): string {
  return rule.id ?? `${ruleLabels[rule.rule] || rule.rule}${rule.scope ? ` (${rule.scope})` : ''}`;
}

/** Breached, but a warn rule, so the gate still passes. */
export function isWarning(rule: QualityGateRuleResult): boolean {
  return !rule.passed && !rule.skipped && rule.severity === 'warn';
}

function formatRuleLine(rule: QualityGateRuleResult): string {
  const label = ruleLabel(rule);

  if (rule.skipped) {
    return `  \u25CB ${padRight(label, 20)} (skipped \u2014 ${rule.skipReason ?? 'no data'})`;
  }

  const icon = rule.passed ? '\u2713' : isWarning(rule) ? '!' : '\u2717';
  return `  ${icon} ${padRight(label, 20)} ${rule.actual} ${rule.threshold}${isWarning(rule) ? ' (warning)' : ''}`;
}

function padRight(str: string, width: number): string {
  return str + ' '.repeat(Math.max(0, width - str.length));
}

export function formatGateReport(result: QualityGateResult): string {
  const separator = '\u2500'.repeat(45);
  const lines: string[] = [];

  lines.push('');
  lines.push('  Quality Gates');
  lines.push(`  ${separator}`);

  for (const rule of result.rules) {
    lines.push(formatRuleLine(rule));
  }

  lines.push(`  ${separator}`);

  const nonSkipped = result.rules.filter(r => !r.skipped);
  const warnings = nonSkipped.filter(isWarning).length;
  const failed = nonSkipped.filter(r => !r.passed).length - warnings;
  const warningText = `${warnings} warning${warnings === 1 ? '' : 's'}`;

  if (result.passed) {
    lines.push(`  Result: PASSED${warnings ? ` with ${warningText}` : ''} (${nonSkipped.length - warnings} of ${nonSkipped.length} rules passed)`);
  } else {
    lines.push(`  Result: FAILED (${failed} of ${nonSkipped.length} rules breached${warnings ? `, ${warningText}` : ''})`);
  }

  lines.push('');

  return lines.join('\n');
}
