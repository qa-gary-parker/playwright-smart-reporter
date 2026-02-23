import type { TestResultData, NotificationConfig, NotificationCondition, RunComparison } from '../types';
import { SlackNotifier } from './slack-notifier';
import { TeamsNotifier } from './teams-notifier';
import { PagerDutyNotifier } from './pagerduty-notifier';
import { EmailNotifier } from './email-notifier';
import { CustomWebhookNotifier } from './custom-webhook-notifier';

interface NotificationContext {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  passRate: number;
  duration: number;
  grade: string;
  failedTests: string;
}

function buildContext(results: TestResultData[], startTime: number): NotificationContext {
  const passed = results.filter(r => r.status === 'passed' || r.outcome === 'expected' || r.outcome === 'flaky').length;
  const failed = results.filter(r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut')).length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const flaky = results.filter(r => r.outcome === 'flaky').length;
  const duration = Date.now() - startTime;
  const passRate = results.length > 0 ? Math.round((passed / results.length) * 100) : 0;

  const gradedTests = results.filter(r => r.stabilityScore?.grade);
  const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const reverseGradeMap: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'F' };
  let grade = 'N/A';
  if (gradedTests.length > 0) {
    const sum = gradedTests.reduce((acc, r) => acc + (gradeMap[r.stabilityScore!.grade] || 0), 0);
    grade = reverseGradeMap[Math.round(sum / gradedTests.length)] || 'C';
  }

  const failedTests = results
    .filter(r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut'))
    .slice(0, 10)
    .map(t => t.title)
    .join(', ');

  return { total: results.length, passed, failed, skipped, flaky, passRate, duration, grade, failedTests };
}

function computeAverageGrade(results: TestResultData[]): number {
  const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const gradedTests = results.filter(r => r.stabilityScore?.grade);
  if (gradedTests.length === 0) return 0;
  const sum = gradedTests.reduce((acc, r) => acc + (gradeMap[r.stabilityScore!.grade] || 0), 0);
  return sum / gradedTests.length;
}

/**
 * Derive a numeric stability grade from a pass rate percentage.
 * Used as a baseline grade proxy when RunComparison only carries RunSummary
 * (which has passRate but no stabilityGrade field).
 * Mapping: >=90% -> A(5), >=80% -> B(4), >=70% -> C(3), >=60% -> D(2), <60% -> F(1)
 */
function gradeFromPassRate(passRate: number): number {
  if (passRate >= 90) return 5; // A
  if (passRate >= 80) return 4; // B
  if (passRate >= 70) return 3; // C
  if (passRate >= 60) return 2; // D
  return 1; // F
}

function evaluateConditions(conditions: NotificationCondition, ctx: NotificationContext, results: TestResultData[], comparison?: RunComparison): boolean {
  if (conditions.minFailures !== undefined && ctx.failed < conditions.minFailures) return false;
  if (conditions.maxPassRate !== undefined && ctx.passRate > conditions.maxPassRate) return false;
  if (conditions.tags && conditions.tags.length > 0) {
    const hasTagFailure = results.some(r =>
      r.outcome === 'unexpected' &&
      (r.status === 'failed' || r.status === 'timedOut') &&
      r.tags?.some(t => conditions.tags!.includes(t))
    );
    if (!hasTagFailure) return false;
  }
  if (conditions.stabilityGradeDrop) {
    if (!comparison) return false;
    const currentGrade = computeAverageGrade(results);
    if (currentGrade === 0) return false;
    // Baseline grade derived from pass rate since RunSummary lacks a stabilityGrade field
    const baselineGrade = gradeFromPassRate(comparison.baselineRun.passRate);
    if (currentGrade >= baselineGrade) return false;
  }
  return true;
}

function renderTemplate(template: string, ctx: NotificationContext): string {
  return template
    .replace(/\{\{total\}\}/g, String(ctx.total))
    .replace(/\{\{passed\}\}/g, String(ctx.passed))
    .replace(/\{\{failed\}\}/g, String(ctx.failed))
    .replace(/\{\{skipped\}\}/g, String(ctx.skipped))
    .replace(/\{\{flaky\}\}/g, String(ctx.flaky))
    .replace(/\{\{passRate\}\}/g, String(ctx.passRate))
    .replace(/\{\{duration\}\}/g, String(Math.round(ctx.duration / 1000)))
    .replace(/\{\{grade\}\}/g, ctx.grade)
    .replace(/\{\{failedTests\}\}/g, ctx.failedTests);
}

export class NotificationManager {
  private configs: NotificationConfig[];

  constructor(configs: NotificationConfig[]) {
    this.configs = configs;
  }

  async notify(results: TestResultData[], startTime: number, comparison?: RunComparison): Promise<void> {
    const ctx = buildContext(results, startTime);

    for (const config of this.configs) {
      try {
        // Evaluate conditions
        if (config.conditions && !evaluateConditions(config.conditions, ctx, results, comparison)) {
          continue;
        }

        // Render message
        const message = config.template
          ? renderTemplate(config.template, ctx)
          : `Test Run: ${ctx.passed}/${ctx.total} passed (${ctx.passRate}%) — ${ctx.failed} failures`;

        // Dispatch to channel
        switch (config.channel) {
          case 'slack': {
            const notifier = new SlackNotifier(config.config.webhookUrl);
            await notifier.sendMessage(message);
            break;
          }
          case 'teams': {
            const notifier = new TeamsNotifier(config.config.webhookUrl);
            await notifier.sendMessage(message);
            break;
          }
          case 'pagerduty': {
            const notifier = new PagerDutyNotifier(config.config.routingKey);
            await notifier.trigger(message, ctx.failed, ctx.total);
            break;
          }
          case 'email': {
            const notifier = new EmailNotifier(config.config);
            await notifier.send(message, ctx);
            break;
          }
          case 'webhook': {
            const notifier = new CustomWebhookNotifier(config.config.url);
            const payload = config.config.payloadTemplate
              ? renderTemplate(config.config.payloadTemplate, ctx)
              : JSON.stringify(ctx);
            let parsedHeaders: Record<string, string> | undefined;
            if (config.config.headers) {
              try {
                const h = JSON.parse(config.config.headers);
                if (typeof h === 'object' && h !== null && !Array.isArray(h)) {
                  parsedHeaders = h;
                }
              } catch {
                console.warn('Smart Reporter: Invalid webhook headers JSON. Skipping headers.');
              }
            }
            await notifier.send(payload, parsedHeaders);
            break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to send ${config.channel} notification: ${message}`);
      }
    }
  }
}
