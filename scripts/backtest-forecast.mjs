#!/usr/bin/env node
// Walk-forward backtest of the flake forecast over recorded history. Needs `npm run build`.
// Usage: node scripts/backtest-forecast.mjs [historyDir=example] [--horizon=3] [--max-history=10] [--min-runs=5] [--threshold=0.5]
import * as fs from 'fs';
import { createRequire } from 'module';
import * as path from 'path';

const require = createRequire(import.meta.url);
const { forecastTest, DEFAULT_MIN_RUNS, DEFAULT_THRESHOLD } = require('../dist/analyzers/flake-forecast.js');
const { FlakinessAnalyzer } = require('../dist/analyzers/flakiness-analyzer.js');
const { isFlakyScore } = require('../dist/utils/flakiness.js');

const args = process.argv.slice(2);
const flag = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const dir = args.find((a) => !a.startsWith('--')) ?? 'example';
const HORIZON = flag('horizon', 3);
const MAX_HISTORY = flag('max-history', 10);
const MIN_RUNS = flag('min-runs', DEFAULT_MIN_RUNS);
const THRESHOLD = flag('threshold', DEFAULT_THRESHOLD);
const QUARANTINE_THRESHOLD = 0.3;

// Rebuild one chronological series per test from the history file and per-run snapshots.
// The history file wins where both hold the same run: its `passed` follows the reporter's outcome rules.
const byTest = new Map();
const add = (testId, entry) => {
  if (!byTest.has(testId)) byTest.set(testId, new Map());
  const key = entry.runId ?? `ts:${entry.timestamp}`;
  if (!byTest.get(testId).has(key)) byTest.get(testId).set(key, entry);
};
const historyPath = path.join(dir, 'test-history.json');
if (fs.existsSync(historyPath)) {
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
  for (const [testId, entries] of Object.entries(history.tests ?? {})) for (const e of entries) add(testId, e);
}
const runsDir = path.join(dir, 'history-runs');
const runFiles = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')) : [];
for (const f of runFiles) {
  const run = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8'));
  for (const t of Object.values(run.tests ?? {})) {
    add(t.testId, { passed: t.status === 'passed', duration: t.duration, timestamp: run.timestamp, retry: t.retry, skipped: t.status === 'skipped', runId: run.runId });
  }
}

const green = (e) => !e.skipped && e.passed && (e.retry ?? 0) === 0;
const bad = (e) => !e.skipped && (!e.passed || (e.retry ?? 0) > 0);
const code = (e) => (e.skipped ? 's' : !e.passed ? 'F' : e.retry > 0 ? 'r' : '.');
const analyzer = new FlakinessAnalyzer();

const totals = { tests: 0, runs: 0, green: 0, scored: 0, insufficient: 0, flags: 0, hits: 0, falseAlarms: 0, open: 0 };
const onsets = [];
const quarantines = [];
const flaggedTests = [];
const falseAlarms = [];

for (const [testId, entries] of byTest) {
  const s = [...entries.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  totals.tests++;
  totals.runs += s.length;
  const flaggedAt = new Map();
  let firstQuarantine = -1;

  for (let i = 0; i < s.length; i++) {
    const prior = s.slice(Math.max(0, i - MAX_HISTORY), i);
    // What the reporter's quarantine would have decided this run (observed flakiness only)
    const probe = { testId, status: s[i].skipped ? 'skipped' : 'passed', history: prior };
    analyzer.analyze(probe, prior);
    if (firstQuarantine < 0 && !s[i].skipped && isFlakyScore(probe.flakinessScore, QUARANTINE_THRESHOLD)) firstQuarantine = i;

    if (!green(s[i])) continue;
    totals.green++;
    const forecast = forecastTest([...prior, s[i]], MIN_RUNS);
    if (forecast.state !== 'scored') { totals.insufficient++; continue; }
    totals.scored++;
    if (forecast.risk < THRESHOLD) continue;
    totals.flags++;
    flaggedAt.set(i, forecast);
    const next = s.slice(i + 1).filter((e) => !e.skipped).slice(0, HORIZON);
    if (next.some(bad)) totals.hits++;
    else if (next.length === HORIZON) {
      totals.falseAlarms++;
      falseAlarms.push({ testId, run: i, risk: forecast.risk, reasons: forecast.reasons.map((r) => `${r.signal} ${r.weight}: ${r.detail}`).join('; ') });
    }
    else totals.open++;
  }

  // Onset: a bad run straight after a first-try pass
  const played = s.map((e, i) => ({ e, i })).filter(({ e }) => !e.skipped);
  for (let k = 1; k < played.length; k++) {
    const { e, i } = played[k];
    const prev = played[k - 1];
    if (!bad(e) || !green(prev.e)) continue;
    const scored = forecastTest([...s.slice(Math.max(0, prev.i - MAX_HISTORY), prev.i), prev.e], MIN_RUNS).state === 'scored';
    let lead = 0;
    for (let b = k - 1; b >= 0 && green(played[b].e) && flaggedAt.has(played[b].i); b--) lead++;
    const firstEver = !played.slice(0, k).some(({ e: p }) => bad(p));
    onsets.push({ testId, run: i, kind: code(e), scored, flagged: flaggedAt.has(prev.i), lead, firstEver });
  }

  if (firstQuarantine >= 0) {
    const before = [...flaggedAt.keys()].filter((i) => i < firstQuarantine);
    quarantines.push({ testId, run: firstQuarantine, flaggedBefore: before.length > 0, lead: before.length ? firstQuarantine - before[0] : 0 });
  }
  if (flaggedAt.size) {
    const [first, f] = [...flaggedAt.entries()][0];
    flaggedTests.push({ testId, pattern: s.map(code).join(''), flags: flaggedAt.size, first, risk: f.risk, reason: f.reasons[0]?.detail ?? '' });
  }
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');
const scoredOnsets = onsets.filter((o) => o.scored);
const firstEver = scoredOnsets.filter((o) => o.firstEver);

console.log(`# Flake forecast backtest\n`);
console.log(`Source: ${path.resolve(dir)} (${runFiles.length} run snapshots + test-history.json)`);
console.log(`Settings: minRuns=${MIN_RUNS} threshold=${THRESHOLD} horizon=${HORIZON} runs, history window=${MAX_HISTORY} prior runs\n`);
console.log('| Measure | Value |\n|---|---|');
console.log(`| Tests / test-runs replayed | ${totals.tests} / ${totals.runs} |`);
console.log(`| First-try passes (forecast candidates) | ${totals.green} |`);
console.log(`| Insufficient history (never flagged) | ${totals.insufficient} |`);
console.log(`| Scored | ${totals.scored} |`);
console.log(`| Flags (risk >= ${THRESHOLD}) | ${totals.flags} |`);
console.log(`| Flag followed by a fail or retry within ${HORIZON} runs | ${totals.hits} (${pct(totals.hits, totals.flags - totals.open)} of resolved flags) |`);
console.log(`| Flag followed by ${HORIZON} clean runs (false alarm) | ${totals.falseAlarms} |`);
console.log(`| Flag with fewer than ${HORIZON} later runs (unresolved) | ${totals.open} |`);
console.log(`| Onsets (fail or retry right after a first-try pass) | ${onsets.length} |`);
console.log(`| Onsets with enough history to score | ${scoredOnsets.length} |`);
console.log(`| ...flagged in the run before | ${scoredOnsets.filter((o) => o.flagged).length} (${pct(scoredOnsets.filter((o) => o.flagged).length, scoredOnsets.length)}) |`);
console.log(`| First-ever onsets with enough history | ${firstEver.length} |`);
console.log(`| ...flagged in the run before | ${firstEver.filter((o) => o.flagged).length} |`);
console.log(`| Tests quarantine would have caught | ${quarantines.length} |`);
console.log(`| ...flagged by the forecast before quarantine | ${quarantines.filter((q) => q.flaggedBefore).length} |\n`);

console.log('## Flagged tests\n\n| Test | History | Flags | First flag (run) | Risk | Top reason |\n|---|---|---|---|---|---|');
for (const t of flaggedTests.sort((a, b) => b.flags - a.flags || a.testId.localeCompare(b.testId))) {
  console.log(`| ${t.testId} | \`${t.pattern}\` | ${t.flags} | ${t.first} | ${t.risk} | ${t.reason} |`);
}

console.log('\n## Onsets with enough history\n\n| Test | Run | Kind | First ever | Flagged run before | Lead (runs) |\n|---|---|---|---|---|---|');
for (const o of scoredOnsets) {
  console.log(`| ${o.testId} | ${o.run} | ${o.kind === 'F' ? 'fail' : 'retry'} | ${o.firstEver ? 'yes' : 'no'} | ${o.flagged ? 'yes' : 'no'} | ${o.lead} |`);
}

console.log('\n## Quarantine\n\n| Test | First quarantined (run) | Flagged before | Lead (runs) |\n|---|---|---|---|');
for (const q of quarantines) console.log(`| ${q.testId} | ${q.run} | ${q.flaggedBefore ? 'yes' : 'no'} | ${q.lead} |`);

console.log('\n## False alarms\n\n| Test | Run | Risk | Reasons |\n|---|---|---|---|');
for (const f of falseAlarms) console.log(`| ${f.testId} | ${f.run} | ${f.risk} | ${f.reasons} |`);
