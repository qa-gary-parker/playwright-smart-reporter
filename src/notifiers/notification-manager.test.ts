import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationManager } from './notification-manager';
import type { TestResultData, NotificationConfig, RunComparison, RunSummary } from '../types';

vi.mock('./slack-notifier', () => ({
  SlackNotifier: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('./teams-notifier', () => ({
  TeamsNotifier: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('./pagerduty-notifier', () => ({
  PagerDutyNotifier: vi.fn().mockImplementation(() => ({
    trigger: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('./email-notifier', () => ({
  EmailNotifier: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('./custom-webhook-notifier', () => ({
  CustomWebhookNotifier: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
}));

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
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('conditions', () => {
    it('minFailures: does not notify when failures below threshold', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { minFailures: 5 },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: '2', status: 'failed', outcome: 'unexpected' }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).not.toHaveBeenCalled();
    });

    it('minFailures: notifies when failures meet threshold', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: mockSendMessage,
      } as any));

      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { minFailures: 1 },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({ status: 'failed', outcome: 'unexpected' }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(mockSendMessage).toHaveBeenCalledWith(expect.stringContaining('1 failures'));
    });

    it('maxPassRate: does not notify when pass rate above threshold', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { maxPassRate: 50 },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ testId: '2', status: 'passed' }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).not.toHaveBeenCalled();
    });

    it('tags: only notifies when tagged tests fail', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: mockSendMessage,
      } as any));

      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { tags: ['@critical'] },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({
          status: 'failed',
          outcome: 'unexpected',
          tags: ['@critical'],
        }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('tags: does not notify when only non-tagged tests fail', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { tags: ['@critical'] },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({
          status: 'failed',
          outcome: 'unexpected',
          tags: ['@smoke'],
        }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).not.toHaveBeenCalled();
    });
  });

  describe('stabilityGradeDrop', () => {
    it('notifies when stability grade has dropped', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: mockSendMessage,
      } as any));

      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { stabilityGradeDrop: true },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({
          stabilityScore: { overall: 60, flakiness: 60, performance: 60, reliability: 60, grade: 'D', needsAttention: true },
        }),
      ];

      const comparison: RunComparison = {
        baselineRun: createRunSummary({ passRate: 90 }),
        currentRun: createRunSummary({ passRate: 60 }),
        changes: { newFailures: [], fixedTests: [], newTests: [], regressions: [], improvements: [] },
      };

      await manager.notify(results, Date.now(), comparison);

      expect(SlackNotifier).toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('does not notify when stability grade has improved', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { stabilityGradeDrop: true },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({
          stabilityScore: { overall: 95, flakiness: 95, performance: 95, reliability: 95, grade: 'A', needsAttention: false },
        }),
      ];

      const comparison: RunComparison = {
        baselineRun: createRunSummary({ passRate: 60 }),
        currentRun: createRunSummary({ passRate: 95 }),
        changes: { newFailures: [], fixedTests: [], newTests: [], regressions: [], improvements: [] },
      };

      await manager.notify(results, Date.now(), comparison);

      expect(SlackNotifier).not.toHaveBeenCalled();
    });

    it('does not notify when stabilityGradeDrop is true but no comparison data', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        conditions: { stabilityGradeDrop: true },
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({
          stabilityScore: { overall: 60, flakiness: 60, performance: 60, reliability: 60, grade: 'D', needsAttention: true },
        }),
      ];

      await manager.notify(results, Date.now());

      expect(SlackNotifier).not.toHaveBeenCalled();
    });
  });

  describe('template rendering', () => {
    it('renders template with all variables', async () => {
      const sendMessageSpy = vi.fn().mockResolvedValue(undefined);
      const { SlackNotifier } = await import('./slack-notifier');
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: sendMessageSpy,
      } as any));

      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
        template: '{{total}} tests, {{passed}} passed, {{failed}} failed, {{skipped}} skipped, {{flaky}} flaky, {{passRate}}% pass rate, {{duration}}s, grade {{grade}}, failures: {{failedTests}}',
      };
      const manager = new NotificationManager([config]);

      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ testId: '2', title: 'Failing Test', status: 'failed', outcome: 'unexpected' }),
      ];

      await manager.notify(results, Date.now());

      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      const message = sendMessageSpy.mock.calls[0][0];
      expect(message).toContain('2 tests');
      expect(message).toContain('1 passed');
      expect(message).toContain('1 failed');
      expect(message).toContain('0 skipped');
      expect(message).toContain('0 flaky');
      expect(message).toContain('50%');
      expect(message).toContain('Failing Test');
    });
  });

  describe('webhook payloadTemplate', () => {
    it('JSON-escapes values in the webhook body and leaves Slack text unescaped', async () => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { CustomWebhookNotifier } = await import('./custom-webhook-notifier');
      const { SlackNotifier } = await import('./slack-notifier');
      const actualWebhook = await vi.importActual<typeof import('./custom-webhook-notifier')>('./custom-webhook-notifier');
      const actualSlack = await vi.importActual<typeof import('./slack-notifier')>('./slack-notifier');
      vi.mocked(CustomWebhookNotifier).mockImplementationOnce((url: string) => new actualWebhook.CustomWebhookNotifier(url));
      vi.mocked(SlackNotifier).mockImplementationOnce((url?: string) => new actualSlack.SlackNotifier(url) as any);
      const title = 'says "hi" from C:\\tmp $\' end';

      await new NotificationManager([
        { channel: 'webhook', config: { url: 'https://hooks.example.test/webhook', payloadTemplate: '{"text":"{{failed}} failed: {{failedTests}}"}' } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.example.test/slack' }, template: '{{failedTests}}' },
      ]).notify([createTestResult({ title, status: 'failed', outcome: 'unexpected' })], Date.now());

      const sent = fetchMock.mock.calls.map(([url, init]) => [url, init.body]);
      expect(sent).toEqual([
        ['https://hooks.example.test/webhook', '{"text":"1 failed: says \\"hi\\" from C:\\\\tmp $\' end"}'],
        ['https://hooks.example.test/slack', '{"text":"says \\"hi\\" from C:\\\\tmp $\' end"}'],
      ]);
      expect(JSON.parse(sent[0][1] as string)).toEqual({ text: `1 failed: ${title}` });
      expect(JSON.parse(sent[1][1] as string)).toEqual({ text: title });
    });
  });

  describe('pagerduty', () => {
    it('triggers an incident only for a run with failures', async () => {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
      vi.stubGlobal('fetch', fetchMock);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const { PagerDutyNotifier } = await import('./pagerduty-notifier');
      const actual = await vi.importActual<typeof import('./pagerduty-notifier')>('./pagerduty-notifier');
      vi.mocked(PagerDutyNotifier).mockImplementation((key: string) => new actual.PagerDutyNotifier(key));
      const manager = new NotificationManager([{ channel: 'pagerduty', config: { routingKey: 'rk' } }]);

      await manager.notify([createTestResult(), createTestResult({ testId: '2' })], Date.now());
      await manager.notify([createTestResult(), createTestResult({ testId: '2', status: 'failed', outcome: 'unexpected' })], Date.now());

      expect(fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body as string)])).toEqual([
        ['https://events.pagerduty.com/v2/enqueue', {
          routing_key: 'rk',
          event_action: 'trigger',
          payload: {
            summary: 'Test Failures: Test Run: 1/2 passed (50%) — 1 failures',
            severity: 'error',
            source: 'playwright-smart-reporter',
            component: 'test-suite',
            custom_details: { failures: 1, total: 2, passRate: 50 },
          },
        }],
      ]);
    });
  });

  describe('channel dispatch', () => {
    it('dispatches to slack', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: mockSendMessage,
      } as any));

      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(SlackNotifier).toHaveBeenCalledWith('https://hooks.slack.com/test');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('dispatches to teams', async () => {
      const { TeamsNotifier } = await import('./teams-notifier');
      const mockSendMessage = vi.fn().mockResolvedValue(undefined);
      vi.mocked(TeamsNotifier).mockImplementationOnce(() => ({ sendMessage: mockSendMessage } as any));

      const config: NotificationConfig = {
        channel: 'teams',
        config: { webhookUrl: 'https://teams.webhook/test' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(TeamsNotifier).toHaveBeenCalledWith('https://teams.webhook/test');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('dispatches to pagerduty', async () => {
      const { PagerDutyNotifier } = await import('./pagerduty-notifier');
      const mockTrigger = vi.fn().mockResolvedValue(undefined);
      vi.mocked(PagerDutyNotifier).mockImplementationOnce(() => ({ trigger: mockTrigger } as any));

      const config: NotificationConfig = {
        channel: 'pagerduty',
        config: { routingKey: 'test-routing-key' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(PagerDutyNotifier).toHaveBeenCalledWith('test-routing-key');
      expect(mockTrigger).toHaveBeenCalledOnce();
    });

    it('dispatches to email', async () => {
      const { EmailNotifier } = await import('./email-notifier');
      const mockSend = vi.fn().mockResolvedValue(undefined);
      vi.mocked(EmailNotifier).mockImplementationOnce(() => ({ send: mockSend } as any));

      const config: NotificationConfig = {
        channel: 'email',
        config: { to: 'test@example.com', from: 'noreply@example.com' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(EmailNotifier).toHaveBeenCalledWith({ to: 'test@example.com', from: 'noreply@example.com' });
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('dispatches to custom webhook', async () => {
      const { CustomWebhookNotifier } = await import('./custom-webhook-notifier');
      const mockSend = vi.fn().mockResolvedValue(undefined);
      vi.mocked(CustomWebhookNotifier).mockImplementationOnce(() => ({ send: mockSend } as any));

      const config: NotificationConfig = {
        channel: 'webhook',
        config: { url: 'https://custom.webhook/endpoint' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(CustomWebhookNotifier).toHaveBeenCalledWith('https://custom.webhook/endpoint');
      expect(mockSend).toHaveBeenCalledOnce();
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
      const { SlackNotifier } = await import('./slack-notifier');
      const sent: Array<[string, string]> = [];
      for (let i = 0; i < configs.length; i++) {
        vi.mocked(SlackNotifier).mockImplementationOnce((url?: string) => ({
          sendMessage: vi.fn(async (message: string) => { sent.push([url ?? '', message]); }),
        } as any));
      }
      await new NotificationManager(configs).notify(run(), Date.now());
      return sent;
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
      const { SlackNotifier } = await import('./slack-notifier');
      const { TeamsNotifier } = await import('./teams-notifier');

      // Make slack throw
      vi.mocked(SlackNotifier).mockImplementationOnce(() => ({
        sendMessage: vi.fn().mockRejectedValue(new Error('Slack error')),
      } as any));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const configs: NotificationConfig[] = [
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/test' } },
        { channel: 'teams', config: { webhookUrl: 'https://teams.webhook/test' } },
      ];
      const manager = new NotificationManager(configs);
      await manager.notify([createTestResult()], Date.now());

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send slack notification'),
      );
      expect(TeamsNotifier).toHaveBeenCalled();
    });
  });
});
