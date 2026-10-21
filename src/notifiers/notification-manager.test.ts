import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from './notification-manager';
import { SlackNotifier } from './slack-notifier';
import { TeamsNotifier } from './teams-notifier';
import { PagerDutyNotifier } from './pagerduty-notifier';
import type { TestResultData, NotificationConfig, RunComparison, RunSummary, StabilityScore } from '../types';

const NOW = 1_700_000_000_000;
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

function requests() {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url,
    method: init.method,
    headers: init.headers,
    body: JSON.parse(init.body as string),
  }));
}

const urls = () => fetchMock.mock.calls.map(([url]) => url);

const slackPost = (url: string, text: string) => ({ url, method: 'POST', headers: JSON_HEADERS, body: { text } });

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test 1',
    file: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

const failing = (overrides: Partial<TestResultData> = {}) => createTestResult({ status: 'failed', outcome: 'unexpected', ...overrides });

const score = (grade: StabilityScore['grade']): StabilityScore => ({ overall: 0, flakiness: 0, performance: 0, reliability: 0, grade, needsAttention: false });

function createRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    total: 10,
    passed: 8,
    failed: 2,
    skipped: 0,
    flaky: 1,
    slow: 1,
    duration: 5000,
    passRate: 80,
    ...overrides,
  };
}

describe('NotificationManager', () => {
  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('conditions', () => {
    it('minFailures: does not notify when failures below threshold', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/five' }, conditions: { minFailures: 5 } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/two' }, conditions: { minFailures: 2 } },
      ]).notify([failing(), failing({ testId: '2' })], NOW);

      expect(urls()).toEqual(['https://hooks.slack.com/two']);
    });

    it('minFailures: notifies when failures meet threshold', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' }, conditions: { minFailures: 1 } },
      ]).notify([failing()], NOW);

      expect(requests()).toEqual([slackPost('https://hooks.slack.com/test', 'Test Run: 0/1 passed (0%) — 1 failures')]);
    });

    it('maxPassRate: does not notify when pass rate above threshold', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/49' }, conditions: { maxPassRate: 49 } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/50' }, conditions: { maxPassRate: 50 } },
      ]).notify([createTestResult(), failing({ testId: '2' })], NOW);

      expect(urls()).toEqual(['https://hooks.slack.com/50']);
    });

    it('maxPassRate: does not notify when every test was skipped, since there is no pass rate', async () => {
      const skipped = (testId: string) => createTestResult({ testId, status: 'skipped', outcome: 'skipped' });
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/max-50' }, conditions: { maxPassRate: 50 } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/all' } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/template' }, template: 'pass rate {{passRate}}' },
      ]).notify([skipped('1'), skipped('2')], NOW);

      expect(requests()).toEqual([
        slackPost('https://hooks.slack.com/all', 'Test Run: 0/2 passed (n/a) — 0 failures'),
        slackPost('https://hooks.slack.com/template', 'pass rate n/a'),
      ]);
    });

    it('tags: only notifies when tagged tests fail', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' }, conditions: { tags: ['@critical'] } },
      ]).notify([failing({ tags: ['@critical'] })], NOW);

      expect(requests()).toEqual([slackPost('https://hooks.slack.com/test', 'Test Run: 0/1 passed (0%) — 1 failures')]);
    });

    it('tags: does not notify when only non-tagged tests fail', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/critical' }, conditions: { tags: ['@critical'] } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/smoke' }, conditions: { tags: ['@smoke'] } },
      ]).notify([failing({ tags: ['@smoke'] }), createTestResult({ testId: '2', tags: ['@critical'] })], NOW);

      expect(urls()).toEqual(['https://hooks.slack.com/smoke']);
    });
  });

  describe('stabilityGradeDrop', () => {
    const comparedTo = (stabilityGrade?: StabilityScore['grade']): RunComparison => ({
      baselineRun: createRunSummary({ passRate: 100, stabilityGrade }),
      currentRun: createRunSummary({ passRate: 100 }),
      changes: { newFailures: [], fixedTests: [], newTests: [], regressions: [], improvements: [], notInBaseline: [] },
    });
    const dropOrAll = () => new NotificationManager([
      { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/drop' }, conditions: { stabilityGradeDrop: true } },
      { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/all' } },
    ]);

    it('notifies when stability grade has dropped', async () => {
      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' }, conditions: { stabilityGradeDrop: true } },
      ]).notify([createTestResult({ stabilityScore: score('D') })], NOW, comparedTo('A'));

      expect(requests()).toEqual([slackPost('https://hooks.slack.com/test', 'Test Run: 1/1 passed (100%) — 0 failures')]);
    });

    it('does not notify when stability grade has improved', async () => {
      await dropOrAll().notify([createTestResult({ stabilityScore: score('A') })], NOW, comparedTo('D'));

      expect(urls()).toEqual(['https://hooks.slack.com/all']);
    });

    it('fires only when the run grade is below the baseline run grade', async () => {
      const manager = new NotificationManager([{
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { stabilityGradeDrop: true },
        template: 'grade {{grade}}',
      }]);
      const graded = (...grades: Array<StabilityScore['grade']>) => grades.map((grade, i) => createTestResult({ testId: `t${i}`, stabilityScore: score(grade) }));

      await manager.notify(graded('A', 'A', 'C', 'A', 'A'), NOW, comparedTo('A'));
      await manager.notify(graded('B', 'B'), NOW, comparedTo('B'));
      await manager.notify(graded('A', 'B', 'C'), NOW, comparedTo('C'));
      await manager.notify(graded('C', 'C'), NOW, comparedTo());
      await manager.notify(graded('C', 'C'), NOW, comparedTo('A'));

      expect(requests().map(r => r.body.text)).toEqual(['grade C']);
    });

    it('does not notify when stabilityGradeDrop is true but no comparison data', async () => {
      await dropOrAll().notify([createTestResult({ stabilityScore: score('D') })], NOW);

      expect(urls()).toEqual(['https://hooks.slack.com/all']);
    });
  });

  describe('template rendering', () => {
    it('renders template with all variables', async () => {
      await new NotificationManager([{
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        template: '{{total}} tests, {{passed}} passed, {{failed}} failed, {{skipped}} skipped, {{flaky}} flaky, {{passRate}}% pass rate, {{duration}}s, grade {{grade}}, failures: {{failedTests}}',
      }]).notify([
        createTestResult({ stabilityScore: score('A') }),
        createTestResult({ testId: '2', title: 'Retried Test', outcome: 'flaky', stabilityScore: score('C') }),
        createTestResult({ testId: '3', title: 'Skipped Test', status: 'skipped', outcome: 'skipped' }),
        failing({ testId: '4', title: 'Failing Test' }),
      ], NOW - 4_200);

      expect(requests()).toEqual([slackPost(
        'https://hooks.slack.com/test',
        '4 tests, 2 passed, 1 failed, 1 skipped, 1 flaky, 67% pass rate, 4s, grade B, failures: Failing Test',
      )]);
    });
  });

  describe('webhook payloadTemplate', () => {
    it('JSON-escapes values in the webhook body and leaves Slack text unescaped', async () => {
      const title = 'says "hi" from C:\\tmp $\' end';

      await new NotificationManager([
        { channel: 'webhook', config: { url: 'https://hooks.example.test/webhook', payloadTemplate: '{"text":"{{failed}} failed: {{failedTests}}"}' } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.example.test/slack' }, template: '{{failedTests}}' },
      ]).notify([failing({ title })], NOW);

      const sent = fetchMock.mock.calls.map(([url, init]) => [url, init.body]);
      expect(sent).toEqual([
        ['https://hooks.example.test/webhook', '{"text":"1 failed: says \\"hi\\" from C:\\\\tmp $\' end"}'],
        ['https://hooks.example.test/slack', '{"text":"says \\"hi\\" from C:\\\\tmp $\' end"}'],
      ]);
      expect(JSON.parse(sent[0][1] as string)).toEqual({ text: `1 failed: ${title}` });
      expect(JSON.parse(sent[1][1] as string)).toEqual({ text: title });
    });

    it('posts the rendered payloadTemplate with the configured headers', async () => {
      await new NotificationManager([{
        channel: 'webhook',
        config: { url: 'https://hooks.example.test/webhook', payloadTemplate: '{"n":"{{failed}}"}', headers: '{"X-Key":"v","Content-Type":"application/vnd.ci+json"}' },
      }]).notify([failing()], NOW);

      expect(fetchMock.mock.calls).toEqual([[
        'https://hooks.example.test/webhook',
        { method: 'POST', headers: { 'Content-Type': 'application/vnd.ci+json', 'X-Key': 'v' }, body: '{"n":"1"}' },
      ]]);
    });

    it('drops headers that are not a JSON object and warns when they are not JSON', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await new NotificationManager([
        { channel: 'webhook', config: { url: 'https://hooks.example.test/a', payloadTemplate: '{}', headers: 'X-Key: v' } },
        { channel: 'webhook', config: { url: 'https://hooks.example.test/b', payloadTemplate: '{}', headers: '["X-Key"]' } },
      ]).notify([failing()], NOW);

      expect(requests().map(r => [r.url, r.headers])).toEqual([
        ['https://hooks.example.test/a', JSON_HEADERS],
        ['https://hooks.example.test/b', JSON_HEADERS],
      ]);
      expect(warn.mock.calls).toEqual([['Smart Reporter: Invalid webhook headers JSON. Skipping headers.']]);
    });
  });

  describe('pagerduty', () => {
    it('triggers an incident only for a run with failures', async () => {
      const manager = new NotificationManager([{ channel: 'pagerduty', config: { routingKey: 'rk' } }]);

      await manager.notify([createTestResult(), createTestResult({ testId: '2' })], NOW);
      await manager.notify([createTestResult(), failing({ testId: '2' })], NOW);

      expect(requests()).toEqual([{
        url: 'https://events.pagerduty.com/v2/enqueue',
        method: 'POST',
        headers: JSON_HEADERS,
        body: {
          routing_key: 'rk',
          event_action: 'trigger',
          payload: {
            summary: 'Test Failures: Test Run: 1/2 passed (50%) — 1 failures',
            severity: 'error',
            source: 'playwright-smart-reporter',
            component: 'test-suite',
            custom_details: { failures: 1, total: 2, passRate: 50 },
          },
        },
      }]);
    });

    it('sets severity from the failure share: >50% critical, >20% error, else warning', async () => {
      const notifier = new PagerDutyNotifier('rk');

      for (const failures of [6, 5, 3, 2]) await notifier.trigger('s', { failed: failures, total: 10, passRate: 100 - failures * 10 });

      expect(requests().map(r => [r.body.payload.custom_details.failures, r.body.payload.severity])).toEqual([
        [6, 'critical'], [5, 'error'], [3, 'error'], [2, 'warning'],
      ]);
    });

    it('sends nothing without a routing key and warns when PagerDuty rejects the event', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchMock.mockResolvedValueOnce(new Response('Invalid routing key', { status: 400 }));

      await new PagerDutyNotifier('').trigger('s', { failed: 1, total: 1, passRate: 0 });
      await new PagerDutyNotifier('bad').trigger('s', { failed: 1, total: 1, passRate: 0 });

      expect(urls()).toEqual(['https://events.pagerduty.com/v2/enqueue']);
      expect(warn.mock.calls).toEqual([['PagerDuty alert failed: 400 Invalid routing key']]);
    });
  });

  describe('email', () => {
    const sendgrid = { sendgridApiKey: 'SG.key', from: 'noreply@example.com', to: 'team@example.com' };

    it('sends the message through SendGrid', async () => {
      await new NotificationManager([{ channel: 'email', config: sendgrid }])
        .notify([createTestResult(), failing({ testId: '2' })], NOW);

      expect(requests()).toEqual([{
        url: 'https://api.sendgrid.com/v3/mail/send',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer SG.key' },
        body: {
          personalizations: [{ to: [{ email: 'team@example.com' }] }],
          from: { email: 'noreply@example.com' },
          subject: 'Test Report: 1/2 passed (50%)',
          content: [{ type: 'text/plain', value: 'Test Run: 1/2 passed (50%) — 1 failures' }],
        },
      }]);
    });

    it('warns instead of sending when SendGrid settings are missing or rejected', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchMock.mockResolvedValueOnce(new Response('forbidden', { status: 403 }));

      await new NotificationManager([
        { channel: 'email', config: { from: sendgrid.from, to: sendgrid.to } },
        { channel: 'email', config: { sendgridApiKey: 'SG.key', to: sendgrid.to } },
        { channel: 'email', config: sendgrid },
      ]).notify([failing()], NOW);

      expect(urls()).toEqual(['https://api.sendgrid.com/v3/mail/send']);
      expect(warn.mock.calls).toEqual([
        ['Email notification: Set sendgridApiKey in notification config, or use a webhook channel for SMTP relay.'],
        ['Email notification: sendgridApiKey, from, and to are required'],
        ['Email notification failed: 403 forbidden'],
      ]);
    });
  });

  describe('channel dispatch', () => {
    it('dispatches to slack', async () => {
      await new NotificationManager([{ channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' } }])
        .notify([createTestResult()], NOW);

      expect(requests()).toEqual([slackPost('https://hooks.slack.com/test', 'Test Run: 1/1 passed (100%) — 0 failures')]);
    });

    it('dispatches to teams', async () => {
      await new NotificationManager([{ channel: 'teams', config: { webhookUrl: 'https://teams.webhook/test' } }])
        .notify([createTestResult()], NOW);

      expect(requests()).toEqual([{
        url: 'https://teams.webhook/test',
        method: 'POST',
        headers: JSON_HEADERS,
        body: { '@type': 'MessageCard', '@context': 'http://schema.org/extensions', text: 'Test Run: 1/1 passed (100%) — 0 failures' },
      }]);
    });

    it('dispatches to pagerduty', async () => {
      await new NotificationManager([{ channel: 'pagerduty', config: { routingKey: 'test-routing-key' } }])
        .notify([failing()], NOW);

      expect(requests().map(r => [r.url, r.body.routing_key, r.body.payload.summary, r.body.payload.severity])).toEqual([
        ['https://events.pagerduty.com/v2/enqueue', 'test-routing-key', 'Test Failures: Test Run: 0/1 passed (0%) — 1 failures', 'critical'],
      ]);
    });

    it('dispatches to custom webhook', async () => {
      await new NotificationManager([{ channel: 'webhook', config: { url: 'https://custom.webhook/endpoint' } }])
        .notify([createTestResult({ stabilityScore: score('B') }), failing({ testId: '2', title: 'Broken' })], NOW - 1_500);

      expect(requests()).toEqual([{
        url: 'https://custom.webhook/endpoint',
        method: 'POST',
        headers: JSON_HEADERS,
        body: { total: 2, passed: 1, failed: 1, skipped: 0, flaky: 0, passRate: 50, duration: 1_500, grade: 'B', failedTests: 'Broken' },
      }]);
    });

    it('refuses webhook URLs that are not https', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'http://hooks.slack.com/test' } },
        { channel: 'teams', config: { webhookUrl: 'http://teams.webhook/test' } },
        { channel: 'webhook', config: { url: 'http://custom.webhook/endpoint' } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/secure' } },
      ]).notify([failing()], NOW);
      await new SlackNotifier('http://hooks.slack.com/legacy').notify([failing()]);
      await new TeamsNotifier('http://teams.webhook/legacy').notify([failing()]);

      expect(urls()).toEqual(['https://hooks.slack.com/secure']);
      expect(warn.mock.calls).toEqual(Array(5).fill(['[smart-reporter] Webhook URL must use HTTPS']));
    });
  });

  describe('legacy slackWebhook / teamsWebhook', () => {
    const run = () => [
      ...Array.from({ length: 6 }, (_, i) => failing({ testId: `f${i}`, title: `fails ${i}` })),
      failing({ testId: 't', title: 'times out', status: 'timedOut' }),
      createTestResult({ testId: 'p1', title: 'passes' }),
      createTestResult({ testId: 'p2', title: 'passes too' }),
      createTestResult({ testId: 's', title: 'skipped', status: 'skipped', outcome: 'skipped' }),
    ];
    const failedList = '• fails 0\n• fails 1\n• fails 2\n• fails 3\n• fails 4';

    it('posts a Slack summary of the first five failures, and nothing for a run without failures', async () => {
      const slack = new SlackNotifier('https://hooks.slack.com/legacy');

      await slack.notify([createTestResult(), createTestResult({ testId: '2', status: 'skipped' })]);
      await new SlackNotifier(undefined).notify(run());
      await slack.notify(run());

      expect(requests()).toEqual([{
        url: 'https://hooks.slack.com/legacy',
        method: 'POST',
        headers: JSON_HEADERS,
        body: {
          text: '🔴 Test Run Failed: 7/10 tests failed (2 passed)',
          blocks: [
            { type: 'section', text: { type: 'mrkdwn', text: '*🔴 Test Run Failed: 7/10 tests failed (2 passed)*' } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Failed Tests:*\n${failedList}\n_...and 2 more failures_` } },
          ],
        },
      }]);
    });

    it('posts a Teams MessageCard of the first five failures, and nothing for a run without failures', async () => {
      const teams = new TeamsNotifier('https://teams.webhook/legacy');

      await teams.notify([createTestResult()]);
      await new TeamsNotifier(undefined).notify(run());
      await teams.notify(run());

      expect(requests()).toEqual([{
        url: 'https://teams.webhook/legacy',
        method: 'POST',
        headers: JSON_HEADERS,
        body: {
          '@type': 'MessageCard',
          '@context': 'http://schema.org/extensions',
          themeColor: 'FF4444',
          summary: '🔴 Test Run Failed: 7/10 tests failed (2 passed)',
          sections: [{
            activityTitle: '🔴 Test Run Failed: 7/10 tests failed (2 passed)',
            facts: [{ name: 'Total', value: '10' }, { name: 'Passed', value: '2' }, { name: 'Failed', value: '7' }],
            text: `**Failed Tests:**\n${failedList}\n\n_...and 2 more failures_`,
          }],
        },
      }]);
    });
  });

  describe('owner routing', () => {
    const run = () => [
      createTestResult({ testId: 'a1', title: 'checkout fails', status: 'failed', outcome: 'unexpected', owners: ['@org/payments'] }),
      createTestResult({ testId: 'a2', title: 'cart passes', owners: ['@org/payments'] }),
      createTestResult({ testId: 'b1', title: 'search fails', status: 'timedOut', outcome: 'unexpected', owners: ['@org/search', 'Dev@Example.com'] }),
      createTestResult({ testId: 'c1', title: 'unowned fails', status: 'failed', outcome: 'unexpected' }),
    ];

    async function sentBySlack(configs: NotificationConfig[]): Promise<Array<[string, string]>> {
      await new NotificationManager(configs).notify(run(), NOW);
      return requests().map(r => [r.url, r.body.text]);
    }

    it('sends each owner a notification listing only the failures they own', async () => {
      const sent = await sentBySlack([
        { channel: 'slack', config: { webhookUrl: 'https://hooks/payments' }, owners: ['@org/payments'] },
        { channel: 'slack', config: { webhookUrl: 'https://hooks/search' }, owners: ['@org/search'] },
        { channel: 'slack', config: { webhookUrl: 'https://hooks/nobody' }, owners: ['@org/nobody'] },
      ]);

      expect(sent).toEqual([
        ['https://hooks/payments', 'Test Run: 1/2 passed (50%) — 1 failures owned by @org/payments: checkout fails'],
        ['https://hooks/search', 'Test Run: 0/1 passed (0%) — 1 failures owned by @org/search: search fails'],
      ]);
    });

    it('scopes template variables and conditions to the owned tests, matching owners case-insensitively', async () => {
      const sent = await sentBySlack([
        {
          channel: 'slack',
          config: { webhookUrl: 'https://hooks/team' },
          owners: ['@Org/Payments', 'DEV@example.com'],
          template: '{{failed}}/{{total}}: {{failedTests}}',
          conditions: { minFailures: 2 },
        },
        { channel: 'slack', config: { webhookUrl: 'https://hooks/payments-strict' }, owners: ['@org/payments'], conditions: { minFailures: 2 } },
      ]);

      expect(sent).toEqual([['https://hooks/team', '2/3: checkout fails, search fails']]);
    });

    it('leaves configs without owners unscoped', async () => {
      const sent = await sentBySlack([{ channel: 'slack', config: { webhookUrl: 'https://hooks/all' }, template: '{{failedTests}}' }]);

      expect(sent).toEqual([['https://hooks/all', 'checkout fails, search fails, unowned fails']]);
    });
  });

  describe('error handling', () => {
    it('failed notifier does not crash others', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      await new NotificationManager([
        { channel: 'slack' } as NotificationConfig,
        { channel: 'teams', config: { webhookUrl: 'https://teams.webhook/test' } },
      ]).notify([createTestResult()], NOW);

      expect(urls()).toEqual(['https://teams.webhook/test']);
      expect(error.mock.calls).toEqual([["Failed to send slack notification: Cannot read properties of undefined (reading 'webhookUrl')"]]);
    });

    it('logs a rejected request and still sends the next notification', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const offline = new TypeError('fetch failed');
      fetchMock.mockRejectedValueOnce(offline);

      await new NotificationManager([
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' } },
        { channel: 'teams', config: { webhookUrl: 'https://teams.webhook/test' } },
      ]).notify([createTestResult()], NOW);

      expect(urls()).toEqual(['https://hooks.slack.com/test', 'https://teams.webhook/test']);
      expect(error.mock.calls).toEqual([['Failed to send Slack message:', offline]]);
    });
  });
});
