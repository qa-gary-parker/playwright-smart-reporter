export class PagerDutyNotifier {
  private routingKey: string;

  constructor(routingKey: string) {
    this.routingKey = routingKey;
  }

  async trigger(summary: string, failures: number, total: number): Promise<void> {
    if (!this.routingKey) return;

    const severity = failures > total * 0.5 ? 'critical' : failures > total * 0.2 ? 'error' : 'warning';

    try {
      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: this.routingKey,
          event_action: 'trigger',
          payload: {
            summary: `Test Failures: ${summary}`,
            severity,
            source: 'playwright-smart-reporter',
            component: 'test-suite',
            custom_details: { failures, total, passRate: Math.round(((total - failures) / total) * 100) },
          },
        }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        console.warn(`PagerDuty alert failed: ${response.status} ${errorBody}`);
        return;
      }
      console.log('📤 PagerDuty alert sent');
    } catch (err) {
      console.error('Failed to send PagerDuty alert:', err);
    }
  }
}
