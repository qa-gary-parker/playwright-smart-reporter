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
import { detectCIInfo } from './ci-detector';

interface Stats { passed: number; failed: number; skipped: number; flaky: number; passRate: number | null }
type Field = keyof Stats;

const NOW = 1_700_000_000_000;

function test(overrides: Partial<TestResultData>): TestResultData {
  return { testId: 't', title: 't', file: 'a.spec.ts', status: 'passed', outcome: 'expected', duration: 1, retry: 0, steps: [], history: [], owners: ['team'], ...overrides };
}

const pass = (id: string) => test({ testId: id, title: id });
const skip = (id: string) => test({ testId: id, title: id, status: 'skipped', outcome: 'skipped' });

const scenarios: Array<{ name: string; results: TestResultData[]; expected: Stats }> = [
  {
    // Skipped tests did not run, so they are left out of the pass rate.
    name: '5 passed and 5 skipped',
    results: [...[1, 2, 3, 4, 5].map((i) => pass(`p${i}`)), ...[1, 2, 3, 4, 5].map((i) => skip(`s${i}`))],
    expected: { passed: 5, failed: 0, skipped: 5, flaky: 0, passRate: 100 },
  },
  {
    name: 'a test.fail() test that passed',
    results: [pass('p'), test({ testId: 'u', title: 'u', status: 'passed', outcome: 'unexpected', expectedStatus: 'failed' })],
    expected: { passed: 1, failed: 1, skipped: 0, flaky: 0, passRate: 50 },
  },
  {
    name: 'an interrupted test',
    results: [pass('p'), test({ testId: 'i', title: 'i', status: 'interrupted', outcome: 'skipped' })],
    expected: { passed: 1, failed: 0, skipped: 1, flaky: 0, passRate: 100 },
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
    expected: { passed: 2, failed: 1, skipped: 1, flaky: 0, passRate: 67 },
  },
  {
    // Nothing ran, so there is no pass rate.
    name: 'every test skipped',
    results: [skip('s1'), skip('s2'), skip('s3')],
    expected: { passed: 0, failed: 0, skipped: 3, flaky: 0, passRate: null },
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
    // A run with no pass rate skips minPassRate. The gate shows 1 decimal place rounded down; the others store whole percents.
    return { failed: Number(maxFailures.actual), passRate: minPassRate.skipped ? null : Math.round(parseFloat(minPassRate.actual)) };
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
    const passRate = valueBefore(lines, 'Pass Rate');
    return {
      passed: Number(valueBefore(lines, 'Passed', distribution)) + flaky,
      failed: Number(valueBefore(lines, 'Failed')),
      skipped: Number(valueBefore(lines, 'Skipped', distribution)),
      flaky,
      passRate: passRate === 'n/a' ? null : parseFloat(passRate),
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

describe('CI info of the run (#73)', () => {
  const sha = '0123456789abcdef0123456789abcdef01234567';
  // Every variable the GitHub detection reads, so the CI this suite runs on does not leak in.
  const GITHUB_PUSH = {
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '', GITHUB_HEAD_REF: '', GITHUB_BASE_REF: '', GITHUB_REF: 'refs/heads/main',
    GITHUB_REF_NAME: 'main', GITHUB_SHA: sha, GITHUB_RUN_ID: '42', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'acme/shop',
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-run-ci-'));
    for (const [name, value] of Object.entries(GITHUB_PUSH)) vi.stubEnv(name, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('history summaries, the report trend and the JSON export record it', () => {
    const results = [pass('p')];
    const collector = new HistoryCollector({ historyFile: 'history.json' }, dir);
    collector.updateHistory(results);
    const json = JSON.parse(fs.readFileSync(exportJsonData(results, emptyHistory(), NOW, {}, undefined, undefined, dir, 'ci'), 'utf8'));

    const ci = { provider: 'github', branch: 'main', commit: '01234567', buildId: '42', sha, repoUrl: 'https://github.com/acme/shop' };
    expect({
      history: collector.getHistory().summaries![0].ciInfo,
      // The reporter detects the CI once and passes it to the report.
      trend: buildReportData({ results, history: emptyHistory(), startTime: NOW, options: {}, ciInfo: detectCIInfo() }, NOW).trends.at(-1)!.ciInfo,
      json: json.metadata.ci,
    }).toEqual({ history: ci, trend: ci, json: ci });
  });
});
