import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FullConfig, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import SmartReporter from '../smart-reporter';
import type { NotificationConfig, SmartReporterOptions } from '../types';

const SLACK = 'https://hooks.slack.com/live';
const TEAMS = 'https://teams.example.test/live';
const CHECKOUT_FAILS = 'First failure detected: "checkout fails" in tests/checkout.spec.ts';
const teamsCard = (text: string) => ({ '@type': 'MessageCard', '@context': 'http://schema.org/extensions', text });

// The template is a run summary, so the first-failure message must not be rendered from it.
const slack: NotificationConfig = { channel: 'slack', config: { webhookUrl: SLACK }, template: 'RUN SUMMARY total={{total}} failed={{failed}}' };

let tmp: string;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

const sent = () => fetchMock.mock.calls.map(([url, init]) => [url, JSON.parse(init.body as string)]);

type FakeTest = TestCase & { results: TestResult[] };

function fakeTest(title: string, { file = 'tests/checkout.spec.ts', retries = 2, expectedStatus = 'passed' }: { file?: string; retries?: number; expectedStatus?: TestResult['status'] } = {}): FakeTest {
  const project = { name: 'chromium', use: {} };
  const projectSuite = { title: 'chromium', parent: { title: '', project: () => undefined }, project: () => project };
  const results: TestResult[] = [];
  return {
    id: title,
    title,
    retries,
    expectedStatus,
    results,
    repeatEachIndex: 0,
    tags: [],
    annotations: [],
    location: { file: path.join(tmp, file), line: 3, column: 1 },
    parent: { title: file, parent: projectSuite, project: () => project },
    titlePath: () => ['', 'chromium', file, title],
    // Playwright's computeTestCaseOutcome, for attempts that ran
    outcome() {
      const unexpected = results.filter(r => r.status !== expectedStatus).length;
      return unexpected === 0 ? 'expected' : unexpected === results.length ? 'unexpected' : 'flaky';
    },
  } as unknown as FakeTest;
}

function start(options: SmartReporterOptions, tests: FakeTest[]): SmartReporter {
  const reporter = new SmartReporter({
    outputFile: path.join(tmp, 'smart-report.html'),
    historyFile: path.join(tmp, 'test-history.json'),
    live: { enabled: true, outputFile: path.join(tmp, 'live.jsonl'), notifyOnFirstFailure: true },
    ...options,
  });
  reporter.onBegin({ rootDir: tmp } as FullConfig, { allTests: () => tests } as unknown as Suite);
  return reporter;
}

// Runs the test's next attempt, then lets the notifications that onTestEnd does not await finish.
async function attempt(reporter: SmartReporter, test: FakeTest, status: 'passed' | 'failed' | 'timedOut'): Promise<void> {
  const message = `Error: ${test.title} broke`;
  const result = {
    retry: test.results.length,
    status,
    duration: 10,
    startTime: new Date(),
    errors: status === 'passed' ? [] : [{ message, stack: `${message}\n    at ${test.location.file}:4:9` }],
    attachments: [],
    steps: [],
    stdout: [],
    stderr: [],
  } as unknown as TestResult;
  test.results.push(result);
  await reporter.onTestEnd(test, result);
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('live.notifyOnFirstFailure', () => {
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'smart-first-failure-')));
    fs.writeFileSync(path.join(tmp, 'package.json'), '{}');
    fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('sends nothing for a failed attempt that will be retried, or for a test that passes on retry', async () => {
    const flaky = fakeTest('passes on retry');
    const reporter = start({ notifications: [slack] }, [flaky]);

    await attempt(reporter, flaky, 'failed');
    expect(sent()).toEqual([]);
    await attempt(reporter, flaky, 'passed');
    expect(sent()).toEqual([]);
  });

  it('sends one message when the last attempt fails, about that test and not a run summary', async () => {
    const broken = fakeTest('checkout fails');
    const reporter = start({ notifications: [slack] }, [broken]);

    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([]);
    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([]);
    await attempt(reporter, broken, 'timedOut');
    expect(sent()).toEqual([[SLACK, { text: CHECKOUT_FAILS }]]);
  });

  it('a test that passes on retry does not use up the message: the next test that fails sends it, and only once', async () => {
    const flaky = fakeTest('passes on retry');
    const broken = fakeTest('checkout fails', { retries: 0 });
    const alsoBroken = fakeTest('search fails', { retries: 0, file: 'tests/search.spec.ts' });
    const reporter = start({ notifications: [slack] }, [flaky, broken, alsoBroken]);

    await attempt(reporter, flaky, 'failed');
    await attempt(reporter, flaky, 'passed');
    await attempt(reporter, broken, 'failed');
    await attempt(reporter, alsoBroken, 'failed');
    expect(sent()).toEqual([[SLACK, { text: CHECKOUT_FAILS }]]);
  });

  it('a test.fail() test that fails as expected sends nothing; one that passes is a failure and sends the message', async () => {
    const knownBug = fakeTest('known bug', { retries: 0, expectedStatus: 'failed' });
    const fixedBug = fakeTest('fixed bug', { retries: 0, expectedStatus: 'failed' });
    const reporter = start({ notifications: [slack] }, [knownBug, fixedBug]);

    await attempt(reporter, knownBug, 'failed');
    expect(sent()).toEqual([]);
    await attempt(reporter, fixedBug, 'passed');
    expect(sent()).toEqual([[SLACK, { text: 'First failure detected: "fixed bug" in tests/checkout.spec.ts' }]]);
  });

  it('sends the message to the legacy slackWebhook and teamsWebhook once the last attempt fails', async () => {
    const broken = fakeTest('checkout fails', { retries: 1 });
    const reporter = start({ slackWebhook: SLACK, teamsWebhook: TEAMS }, [broken]);

    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([]);
    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([[SLACK, { text: CHECKOUT_FAILS }], [TEAMS, teamsCard(CHECKOUT_FAILS)]]);
  });

  it('with slackWebhook and notifications both set, sends through notifications only, as the end-of-run notification does', async () => {
    const broken = fakeTest('checkout fails', { retries: 0 });
    const reporter = start({ slackWebhook: 'https://hooks.slack.com/legacy', notifications: [slack] }, [broken]);

    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([[SLACK, { text: CHECKOUT_FAILS }]]);
  });

  it('sends to Slack and Teams channels only, not to PagerDuty, email or webhook channels', async () => {
    const broken = fakeTest('checkout fails', { retries: 0 });
    const reporter = start({
      notifications: [
        { channel: 'pagerduty', config: { routingKey: 'rk' } },
        { channel: 'email', config: { sendgridApiKey: 'SG.key', from: 'ci@example.com', to: 'team@example.com' } },
        { channel: 'webhook', config: { url: 'https://hooks.example.test/webhook' } },
        slack,
        { channel: 'teams', config: { webhookUrl: TEAMS } },
      ],
    }, [broken]);

    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([[SLACK, { text: CHECKOUT_FAILS }], [TEAMS, teamsCard(CHECKOUT_FAILS)]]);
  });

  it('routes the message by owners and conditions, as the end-of-run notification does', async () => {
    fs.writeFileSync(path.join(tmp, 'CODEOWNERS'), '/tests/checkout.spec.ts @org/payments\n');
    const broken = fakeTest('checkout fails', { retries: 0 });
    const reporter = start({
      notifications: [
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/search' }, owners: ['@org/search'] },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/two-failures' }, conditions: { minFailures: 2 } },
        { channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/payments' }, owners: ['@Org/Payments'] },
      ],
    }, [broken]);

    await attempt(reporter, broken, 'failed');
    expect(sent()).toEqual([['https://hooks.slack.com/payments', { text: CHECKOUT_FAILS }]]);
  });
});
