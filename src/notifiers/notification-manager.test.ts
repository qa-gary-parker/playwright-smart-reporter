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

  describe('channel dispatch', () => {
    it('dispatches to slack', async () => {
      const { SlackNotifier } = await import('./slack-notifier');
      const config: NotificationConfig = {
        channel: 'slack',
        config: { webhookUrl: 'https://hooks.slack.com/test' },
      };
      const manager = new NotificationManager([config]);
      await manager.notify([createTestResult()], Date.now());

      expect(SlackNotifier).toHaveBeenCalledWith('https://hooks.slack.com/test');
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
        expect.any(Error)
      );
      expect(TeamsNotifier).toHaveBeenCalled();
    });
  });
});
