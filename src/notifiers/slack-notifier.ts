import type { TestResultData } from '../types';
import { isFailedTest } from '../utils/flakiness';
import { computeRunStats } from '../utils/run-stats';

/**
 * Sends test failure notifications to Slack
 */
export class SlackNotifier {
  private webhookUrl?: string;

  constructor(webhookUrl?: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * Send notification for test failures
   */
  async notify(results: TestResultData[]): Promise<void> {
    if (!this.webhookUrl) return;
    if (!this.webhookUrl.startsWith('https://')) {
      console.warn('[smart-reporter] Webhook URL must use HTTPS');
      return;
    }

    const { failed, passed, total } = computeRunStats(results);

    // Only send if there are failures
    if (failed === 0) return;

    const summary = `🔴 Test Run Failed: ${failed}/${total} tests failed (${passed} passed)`;
    const failedTests = results
      .filter(isFailedTest)
      .slice(0, 5) // Limit to first 5 failures
      .map(t => `• ${t.title}`)
      .join('\n');

    const moreFailures = failed > 5 ? `\n_...and ${failed - 5} more failures_` : '';

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: summary,
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*${summary}*` }
            },
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Failed Tests:*\n${failedTests}${moreFailures}` }
            }
          ]
        }),
      });
      console.log('📤 Slack notification sent');
    } catch (err) {
      console.error('Failed to send Slack notification:', err);
    }
  }

  /**
   * Send custom message to Slack
   */
  async sendMessage(message: string): Promise<void> {
    if (!this.webhookUrl) return;
    if (!this.webhookUrl.startsWith('https://')) {
      console.warn('[smart-reporter] Webhook URL must use HTTPS');
      return;
    }

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      });
    } catch (err) {
      console.error('Failed to send Slack message:', err);
    }
  }

  /**
   * Send rich notification with custom blocks
   */
  async sendRichNotification(options: {
    title: string;
    summary: string;
    fields: Array<{ name: string; value: string }>;
    color?: 'good' | 'warning' | 'danger';
  }): Promise<void> {
    if (!this.webhookUrl) return;
    if (!this.webhookUrl.startsWith('https://')) {
      console.warn('[smart-reporter] Webhook URL must use HTTPS');
      return;
    }

    const { title, summary, fields, color = 'danger' } = options;

    // Convert color to theme
    const colorMap = {
      good: '00FF88',
      warning: 'FFCC00',
      danger: 'FF4466',
    };

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{
            color: colorMap[color],
            title,
            text: summary,
            fields: fields.map(f => ({
              title: f.name,
              value: f.value,
              short: true,
            })),
          }]
        }),
      });
    } catch (err) {
      console.error('Failed to send Slack notification:', err);
    }
  }

  /**
   * Check if notifier is configured
   */
  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}
