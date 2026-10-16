import type { TestResultData, NotificationConfig, NotificationCondition, RunComparison } from '../types';
import { SlackNotifier } from './slack-notifier';
import { TeamsNotifier } from './teams-notifier';
import { PagerDutyNotifier } from './pagerduty-notifier';
import { EmailNotifier } from './email-notifier';
import { CustomWebhookNotifier } from './custom-webhook-notifier';
import { isFailedTest } from '../utils/flakiness';
import { computeRunStats, formatPassRate, runStabilityGrade } from '../utils/run-stats';

interface NotificationContext {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  passRate: number | null;
  duration: number;
  grade: string;
  failedTests: string;
}

function buildContext(results: TestResultData[], startTime: number): NotificationContext {
  const { total, passed, failed, skipped, flaky, passRate } = computeRunStats(results);
  const duration = Date.now() - startTime;

  const grade = runStabilityGrade(results) ?? 'N/A';

  const failedTests = results
    .filter(isFailedTest)
    .slice(0, 10)
    .map(t => t.title)
    .join(', ');

  return { total, passed, failed, skipped, flaky, passRate, duration, grade, failedTests };
}

function evaluateConditions(conditions: NotificationCondition, ctx: NotificationContext, results: TestResultData[], comparison?: RunComparison): boolean {
  if (results.length === 0) return false;
  if (conditions.minFailures !== undefined && ctx.failed < conditions.minFailures) return false;
  // A run where every test was skipped has no pass rate, so it cannot be at or below maxPassRate.
  if (conditions.maxPassRate !== undefined && (ctx.passRate === null || ctx.passRate > conditions.maxPassRate)) return false;
  if (conditions.tags && conditions.tags.length > 0) {
    const hasTagFailure = results.some(r => isFailedTest(r) && r.tags?.some(t => conditions.tags!.includes(t)));
    if (!hasTagFailure) return false;
  }
  if (conditions.stabilityGradeDrop) {
    const baselineGrade = comparison?.baselineRun.stabilityGrade;
    if (!baselineGrade || ctx.grade === 'N/A') return false;
    // A lower grade is a later letter: A < B < C < D < F.
    if (ctx.grade <= baselineGrade) return false;
  }
  return true;
}

// Replacer functions, because a replacement string would expand $& and $' found in a test title.
function renderTemplate(template: string, ctx: NotificationContext, escape: (value: string) => string = value => value): string {
  return template
    .replace(/\{\{total\}\}/g, String(ctx.total))
    .replace(/\{\{passed\}\}/g, String(ctx.passed))
    .replace(/\{\{failed\}\}/g, String(ctx.failed))
    .replace(/\{\{skipped\}\}/g, String(ctx.skipped))
    .replace(/\{\{flaky\}\}/g, String(ctx.flaky))
    .replace(/\{\{passRate\}\}/g, String(ctx.passRate ?? 'n/a'))
    .replace(/\{\{duration\}\}/g, String(Math.round(ctx.duration / 1000)))
    .replace(/\{\{grade\}\}/g, () => escape(ctx.grade))
    .replace(/\{\{failedTests\}\}/g, () => escape(ctx.failedTests));
}

export class NotificationManager {
  private configs: NotificationConfig[];

  constructor(configs: NotificationConfig[]) {
    this.configs = configs;
  }

  async notify(results: TestResultData[], startTime: number, comparison?: RunComparison): Promise<void> {
    const runCtx = buildContext(results, startTime);

    for (const config of this.configs) {
      try {
        // Owner routing: scope counts, conditions and the failure list to tests these owners own
        const owners = config.owners?.length ? new Set(config.owners.map(o => o.toLowerCase())) : undefined;
        const scoped = owners ? results.filter(r => r.owners?.some(o => owners.has(o.toLowerCase()))) : results;
        if (owners && !scoped.some(isFailedTest)) {
          continue;
        }
        const ctx = owners ? buildContext(scoped, startTime) : runCtx;

        // Evaluate conditions
        if (config.conditions && !evaluateConditions(config.conditions, ctx, scoped, comparison)) {
          continue;
        }

        // Render message
        const message = config.template
          ? renderTemplate(config.template, ctx)
          : `Test Run: ${ctx.passed}/${ctx.total} passed (${formatPassRate(ctx.passRate)}) — ${ctx.failed} failures` +
            (owners ? ` owned by ${config.owners!.join(', ')}: ${ctx.failedTests}` : '');

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
            await notifier.trigger(message, ctx);
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
              ? renderTemplate(config.config.payloadTemplate, ctx, value => JSON.stringify(value).slice(1, -1))
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
