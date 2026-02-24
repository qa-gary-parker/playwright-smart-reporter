import type { TestResultData } from '../types';

/**
 * Sends test failure notifications to Microsoft Teams
 */
export class TeamsNotifier {
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

    const failed = results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
    const passed = results.filter(r => r.status === 'passed').length;
    const total = results.length;

    // Only send if there are failures
    if (failed === 0) return;

    const summary = `🔴 Test Run Failed: ${failed}/${total} tests failed (${passed} passed)`;
    const failedTests = results
      .filter(r => r.status === 'failed' || r.status === 'timedOut')
      .slice(0, 5) // Limit to first 5 failures
      .map(t => `• ${t.title}`)
      .join('\n');

    const moreFailures = failed > 5 ? `\n\n_...and ${failed - 5} more failures_` : '';

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: 'FF4444',
          summary: summary,
          sections: [{
            activityTitle: summary,
            facts: [
              { name: 'Total', value: String(total) },
              { name: 'Passed', value: String(passed) },
              { name: 'Failed', value: String(failed) },
            ],
            text: `**Failed Tests:**\n${failedTests}${moreFailures}`
          }]
        }),
      });
      console.log('📤 Teams notification sent');
    } catch (err) {
      console.error('Failed to send Teams notification:', err);
    }
  }

  /**
   * Send custom message to Teams
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
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          text: message,
        }),
      });
    } catch (err) {
      console.error('Failed to send Teams message:', err);
    }
  }

  /**
   * Send rich notification with custom sections
   */
  async sendRichNotification(options: {
    title: string;
    summary: string;
    facts: Array<{ name: string; value: string }>;
    text?: string;
    color?: string;
  }): Promise<void> {
    if (!this.webhookUrl) return;
    if (!this.webhookUrl.startsWith('https://')) {
      console.warn('[smart-reporter] Webhook URL must use HTTPS');
      return;
    }

    const {
      title,
      summary,
      facts,
      text = '',
      color = 'FF4444'
    } = options;

    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: color,
          summary,
          sections: [{
            activityTitle: title,
            facts,
            text,
          }]
        }),
      });
    } catch (err) {
      console.error('Failed to send Teams notification:', err);
    }
  }

  /**
   * Check if notifier is configured
   */
  isConfigured(): boolean {
    return !!this.webhookUrl;
  }
}
