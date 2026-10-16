import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import type { TestResultData } from '../types';
import { buildReportData } from '../report-data/builder';
import { HistoryCollector } from '../collectors/history-collector';
import { exportJsonData } from '../generators/json-exporter';
import { generateExecutivePdf } from '../generators/executive-pdf';
import { NotificationManager } from '../notifiers/notification-manager';
import { SlackNotifier } from '../notifiers/slack-notifier';
import { TeamsNotifier } from '../notifiers/teams-notifier';
import { QualityGateEvaluator } from '../gates/quality-gate-evaluator';
import { LiveWriter } from '../live/live-writer';
import { summarizeOwnership } from '../analyzers/ownership';

interface Stats { passed: number; failed: number; skipped: number; flaky: number; passRate: number }
type Field = keyof Stats;

const NOW = 1_700_000_000_000;

function test(overrides: Partial<TestResultData>): TestResultData {
  return { testId: 't', title: 't', file: 'a.spec.ts', status: 'passed', outcome: 'expected', duration: 1, retry: 0, steps: [], history: [], owners: ['team'], ...overrides };
}

const pass = (id: string) => test({ testId: id, title: id });
const skip = (id: string) => test({ testId: id, title: id, status: 'skipped', outcome: 'skipped' });

const scenarios: Array<{ name: string; results: TestResultData[]; expected: Stats }> = [
  {
    name: '5 passed and 5 skipped',
    results: [...[1, 2, 3, 4, 5].map((i) => pass(`p${i}`)), ...[1, 2, 3, 4, 5].map((i) => skip(`s${i}`))],
    expected: { passed: 5, failed: 0, skipped: 5, flaky: 0, passRate: 50 },
  },
  {
    name: 'a test.fail() test that passed',
    results: [pass('p'), test({ testId: 'u', title: 'u', status: 'passed', outcome: 'unexpected', expectedStatus: 'failed' })],
    expected: { passed: 1, failed: 1, skipped: 0, flaky: 0, passRate: 50 },
  },
  {
    name: 'an interrupted test',
    results: [pass('p'), test({ testId: 'i', title: 'i', status: 'interrupted', outcome: 'skipped' })],
    expected: { passed: 1, failed: 0, skipped: 1, flaky: 0, passRate: 50 },
  },
  {
    // Per-run flaky is "passed on retry"; a flaky history score alone does not count.
    name: 'flaky by outcome and flaky by score',
    results: [
      test({ testId: 'k', title: 'k', status: 'passed', outcome: 'flaky', retry: 1 }),
      test({ testId: 'h', title: 'h', status: 'passed', outcome: 'expected', flakinessScore: 0.5 }),
    ],
    expected: { passed: 2, failed: 0, skipped: 0, flaky: 1, passRate: 100 },
  },
  {
    name: 'a failure among passed and skipped tests',
    results: [pass('p1'), pass('p2'), test({ testId: 'f', title: 'f', status: 'failed', outcome: 'unexpected' }), skip('s')],
    expected: { passed: 2, failed: 1, skipped: 1, flaky: 0, passRate: 50 },
  },
];

let dir: string;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));

// Text of each BT…ET block of the PDF, read as executive-pdf.test.ts reads it.
function pdfLines(file: string): string[] {
  const raw = fs.readFileSync(file).toString('latin1');
  const streams = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(([, s]) => zlib.inflateSync(Buffer.from(s, 'latin1')).toString('latin1'));
  return streams.flatMap((content) => [...content.matchAll(/\bBT\b[\s\S]*?\bET\b/g)].map(([block]) =>
    [...block.matchAll(/<([0-9a-f]+)>/gi)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join('')));
}
const valueBefore = (lines: string[], label: string, from = 0) => lines[lines.indexOf(label, from) - 1];

const ALL: Field[] = ['passed', 'failed', 'skipped', 'flaky', 'passRate'];
// Slack, Teams and PagerDuty send only when a test failed, so a run without failures shows only that.
const whenFailed = (fields: Field[]) => (e: Stats): Field[] => (e.failed > 0 ? fields : ['failed']);
const notifierText = (text: string | undefined) => {
  const [, failed, passed] = text?.match(/(\d+)\/\d+ tests failed \((\d+) passed\)/) ?? [];
  return text ? { failed: Number(failed), passed: Number(passed) } : { failed: 0 };
};
const emptyHistory = () => ({ runs: [], tests: {}, summaries: [] });

// Each output: the fields it shows, and how to read them from what it produced.
const consumers: Record<string, [fields: (e: Stats) => Field[], read: (results: TestResultData[]) => Promise<Partial<Stats>> | Partial<Stats>]> = {
  'report summary': [() => ALL, (results) => buildReportData({ results, history: emptyHistory(), startTime: NOW, options: {} }, NOW).summary],
  'report trend, current run': [() => ALL, (results) => buildReportData({ results, history: emptyHistory(), startTime: NOW, options: {} }, NOW).trends.at(-1)!],
  'history summary': [() => ALL, (results) => {
    const collector = new HistoryCollector({ historyFile: 'history.json' }, dir);
    collector.updateHistory(results);
    return collector.getHistory().summaries![0];
  }],
  'JSON export': [() => ALL, (results) => {
    const file = exportJsonData(results, emptyHistory(), NOW, {}, undefined, undefined, dir, 'stats');
    return JSON.parse(fs.readFileSync(file, 'utf8')).summary;
  }],
  'quality gates': [() => ['failed', 'passRate'], (results) => {
    const [maxFailures, minPassRate] = new QualityGateEvaluator().evaluate({ maxFailures: 0, minPassRate: 0 }, results).rules;
    return { failed: Number(maxFailures.actual), passRate: parseFloat(minPassRate.actual) };
  }],
  'notification payload': [() => ALL, async (results) => {
    await new NotificationManager([{ channel: 'webhook', config: { url: 'https://hooks.example.com/run' } }]).notify(results, NOW);
    return bodies()[0];
  }],
  'PagerDuty alert': [whenFailed(['failed', 'passRate']), async (results) => {
    await new NotificationManager([{ channel: 'pagerduty', config: { routingKey: 'rk' } }]).notify(results, NOW);
    const details = bodies()[0]?.payload.custom_details;
    return details ? { failed: details.failures, passRate: details.passRate } : { failed: 0 };
  }],
  'Slack (slackWebhook)': [whenFailed(['failed', 'passed']), async (results) => {
    await new SlackNotifier('https://hooks.slack.com/run').notify(results);
    return notifierText(bodies()[0]?.text);
  }],
  'Teams (teamsWebhook)': [whenFailed(['failed', 'passed']), async (results) => {
    await new TeamsNotifier('https://example.webhook.office.com/run').notify(results);
    return notifierText(bodies()[0]?.summary);
  }],
  'executive PDF': [() => ALL, (results) => {
    const lines = pdfLines(generateExecutivePdf({ results, history: emptyHistory(), startTime: NOW }, dir, 'stats'));
    const distribution = lines.indexOf('Test Distribution');
    const flaky = Number(valueBefore(lines, 'Flaky'));
    return {
      passed: Number(valueBefore(lines, 'Passed', distribution)) + flaky,
      failed: Number(valueBefore(lines, 'Failed')),
      skipped: Number(valueBefore(lines, 'Skipped', distribution)),
      flaky,
      passRate: parseFloat(valueBefore(lines, 'Pass Rate')),
    };
  }],
  'live counters': [() => ['passed', 'failed', 'skipped', 'flaky'], (results) => {
    const writer = new LiveWriter({ outputFile: path.join(dir, 'live.jsonl') });
    writer.start(results.length);
    for (const r of results) {
      // A test that passed on retry first reports its failed attempt.
      if (r.retry > 0) writer.writeTestResult({ testId: r.testId, title: r.title, file: r.file, status: 'failed', duration: 1, retry: 0, outcome: 'unexpected' });
      writer.writeTestResult({ testId: r.testId, title: r.title, file: r.file, status: r.status, duration: 1, retry: r.retry, outcome: r.outcome });
    }
    writer.complete(0);
    const { counters } = JSON.parse(fs.readFileSync(path.join(dir, 'live.jsonl'), 'utf8').trim().split('\n').at(-1)!);
    return { passed: counters.passed + counters.flaky, failed: counters.failed, skipped: counters.skipped, flaky: counters.flaky };
  }],
  'ownership panel': [() => ['failed', 'passRate'], (results) => summarizeOwnership(results)!.owners[0]],
};

const pick = (from: Partial<Stats>, fields: Field[]) => Object.fromEntries(fields.map((f) => [f, from[f]]));

describe('run statistics (#66)', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-run-stats-'));
    fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it.each(scenarios)('every output counts $name the same way', async ({ results, expected }) => {
    const actual: Record<string, Partial<Stats>> = {};
    const wanted: Record<string, Partial<Stats>> = {};
    for (const [name, [fields, read]] of Object.entries(consumers)) {
      fetchMock.mockClear();
      actual[name] = pick(await read(results), fields(expected));
      wanted[name] = pick(expected, fields(expected));
    }
    expect(actual).toEqual(wanted);
  });
});
