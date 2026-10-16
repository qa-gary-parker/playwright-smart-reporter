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
};

function formatRuleLine(rule: QualityGateRuleResult): string {
  const label = ruleLabels[rule.rule] || rule.rule;

  if (rule.skipped) {
    const reason = rule.rule.startsWith('maxA11y') ? 'no accessibility scans' : rule.rule === 'minPassRate' ? 'no test ran' : 'no comparison data';
    return `  \u25CB ${padRight(label, 20)} (skipped \u2014 ${reason})`;
  }

  const icon = rule.passed ? '\u2713' : '\u2717';
  return `  ${icon} ${padRight(label, 20)} ${rule.actual} ${rule.threshold}`;
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
  const failed = nonSkipped.filter(r => !r.passed);
  const status = result.passed ? 'PASSED' : 'FAILED';

  if (result.passed) {
    lines.push(`  Result: ${status} (${nonSkipped.length} of ${nonSkipped.length} rules passed)`);
  } else {
    lines.push(`  Result: ${status} (${failed.length} of ${nonSkipped.length} rules breached)`);
  }

  lines.push('');

  return lines.join('\n');
}
