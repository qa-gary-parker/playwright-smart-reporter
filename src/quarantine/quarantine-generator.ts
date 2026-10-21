import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, QuarantineConfig, QuarantineFile, QuarantineEntry, QuarantineEvent } from '../types';
import { isFlakyScore } from '../utils';

const DAY_MS = 24 * 60 * 60 * 1000;

type ManualEntry = Pick<QuarantineEntry, 'testId' | 'title'> & Partial<QuarantineEntry>;

export class QuarantineGenerator {
  private config: Required<Pick<QuarantineConfig, 'threshold' | 'maxQuarantined' | 'outputFile' | 'manualFile'>> & Pick<QuarantineConfig, 'expiresAfterDays'>;

  constructor(config: QuarantineConfig) {
    this.config = {
      threshold: config.threshold ?? 0.3,
      maxQuarantined: config.maxQuarantined ?? 50,
      outputFile: config.outputFile ?? '.smart-quarantine.json',
      manualFile: config.manualFile ?? '.smart-quarantine.manual.json',
      expiresAfterDays: config.expiresAfterDays,
    };
  }

  generate(results: TestResultData[], outputDir: string, previous = this.read(outputDir)): QuarantineFile {
    const now = new Date().toISOString();
    const byId = new Map(results.map(r => [r.testId, r]));
    const before = new Map((previous?.entries ?? []).map(e => [e.testId, e]));
    const fromResult = (r: TestResultData, source: QuarantineEntry['source']): QuarantineEntry => ({
      testId: r.testId,
      title: r.title,
      file: r.file,
      flakinessScore: r.flakinessScore,
      runs: r.flakinessRuns,
      quarantinedAt: before.get(r.testId)?.quarantinedAt ?? now,
      source,
      owners: r.owners,
    });

    // A quarantined test is usually left out of the next run, so it has no result: keep its entry until it runs
    const ran = new Set(results.filter(r => r.outcome !== 'skipped').map(r => r.testId));
    const kept = (previous?.entries ?? []).filter(e => e.source !== 'manual' && !ran.has(e.testId));

    const auto = [
      ...results
        .filter(r => r.outcome !== 'skipped')
        // Quarantine is for flaky tests. A test that fails every run, or that broke
        // and still fails, should fail CI, not be hidden; a fixed test needs nothing.
        .filter(r => r.flakinessStatus === 'flaky' && isFlakyScore(r.flakinessScore, this.config.threshold))
        .map(r => fromResult(r, 'auto')),
      ...kept.filter(e => (e.source ?? 'auto') === 'auto').map(e => ({ ...e, source: 'auto' as const })),
    ]
      .sort((a, b) => b.flakinessScore! - a.flakinessScore!)
      .slice(0, this.config.maxQuarantined);

    const annotated = [
      ...kept.filter(e => e.source === 'annotation'),
      ...results.flatMap(r => {
        const mark = quarantineMark(r);
        return mark ? [{ ...fromResult(r, 'annotation'), ticket: mark.ticket }] : [];
      }),
    ];

    const manual = this.readManual(outputDir).map((m): QuarantineEntry => {
      const r = byId.get(m.testId);
      const prev = before.get(m.testId);
      return {
        testId: m.testId,
        title: r?.title ?? m.title,
        file: r?.file ?? m.file ?? prev?.file ?? '',
        flakinessScore: r?.flakinessScore ?? prev?.flakinessScore,
        runs: r?.flakinessRuns ?? prev?.runs,
        quarantinedAt: m.quarantinedAt ?? prev?.quarantinedAt ?? now,
        source: 'manual',
        owners: m.owners ?? r?.owners ?? prev?.owners,
        ticket: m.ticket,
        reason: m.reason,
        expiresAt: m.expiresAt,
      };
    });

    // One entry per test: a manual entry wins over an annotation, and an annotation over the flakiness score
    const byTest = new Map<string, QuarantineEntry>();
    for (const e of [...auto, ...annotated, ...manual]) byTest.set(e.testId, e);
    const entries = [...byTest.values()].map(e => ({ ...e, expiresAt: this.expiresAt(e) }));

    const quarantineFile: QuarantineFile = {
      generatedAt: now,
      threshold: this.config.threshold,
      entries,
    };

    // Without a previous file there is nothing to clear
    if (entries.length > 0 || previous) {
      const filePath = this.getOutputPath(outputDir);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(quarantineFile, null, 2));
    }

    return quarantineFile;
  }

  read(outputDir: string): QuarantineFile | undefined {
    return readQuarantineFile(this.getOutputPath(outputDir));
  }

  getOutputPath(outputDir: string): string {
    return path.resolve(outputDir, this.config.outputFile);
  }

  private readManual(outputDir: string): ManualEntry[] {
    const filePath = path.resolve(outputDir, this.config.manualFile);
    const entries = readJsonFile<{ entries?: Partial<QuarantineEntry>[] }>(filePath)?.entries ?? [];
    const bad = entries.findIndex(e => typeof e?.testId !== 'string' || typeof e.title !== 'string');
    if (bad !== -1) throw new Error(`${filePath}: entries[${bad}] needs a testId and a title`);
    return entries.map((e, i) => {
      const entry = { ...e } as ManualEntry;
      for (const field of ['quarantinedAt', 'expiresAt'] as const) {
        if (entry[field] !== undefined && Number.isNaN(Date.parse(String(entry[field])))) {
          console.warn(`⚠️  Quarantine: ${filePath} entries[${i}] ("${entry.testId}") has an invalid ${field} "${entry[field]}"; it is ignored.`);
          delete entry[field];
        }
      }
      return entry;
    });
  }

  private expiresAt(e: QuarantineEntry): string | undefined {
    if (e.source === 'manual' && e.expiresAt) return e.expiresAt;
    const days = this.config.expiresAfterDays;
    return days === undefined ? undefined : new Date(Date.parse(e.quarantinedAt) + days * DAY_MS).toISOString();
  }
}

// undefined when the file does not exist. The error names the file, which JSON.parse does not.
function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readQuarantineFile(filePath: string): QuarantineFile | undefined {
  return readJsonFile<QuarantineFile>(filePath);
}

// @quarantine(<ticket>) as a tag, or a { type: 'quarantine', description: '<ticket>' } annotation
function quarantineMark(r: TestResultData): { ticket?: string } | undefined {
  for (const tag of r.tags ?? []) {
    const match = /^@quarantine(?:\((.*)\))?$/.exec(tag);
    if (match) return { ticket: match[1] || undefined };
  }
  const annotation = r.annotations?.find(a => a.type === 'quarantine');
  return annotation && { ticket: annotation.description };
}

export function isExpired(entry: QuarantineEntry, now: number): boolean {
  return entry.expiresAt !== undefined && Date.parse(entry.expiresAt) <= now;
}

// Changes since the previous file. An entry expires once: in the first run after its expiresAt.
export function quarantineEvents(previous: QuarantineFile | undefined, next: QuarantineFile | null, now: number): QuarantineEvent[] {
  const before = new Map((previous?.entries ?? []).map(e => [e.testId, e]));
  const after = next?.entries ?? [];
  const afterIds = new Set(after.map(e => e.testId));
  const lastRun = previous ? Date.parse(previous.generatedAt) : -Infinity;
  const wasExpired = (e: QuarantineEntry) => {
    const prev = before.get(e.testId);
    return prev !== undefined && isExpired(prev, lastRun);
  };
  return [
    ...after.filter(e => !before.has(e.testId)).map(entry => ({ kind: 'quarantined' as const, entry })),
    ...after.filter(e => isExpired(e, now) && !wasExpired(e)).map(entry => ({ kind: 'expired' as const, entry })),
    ...[...before.values()].filter(e => !afterIds.has(e.testId)).map(entry => ({ kind: 'released' as const, entry })),
  ];
}

export function describeQuarantineEntry(e: QuarantineEntry): string {
  return [`"${e.title}" in ${e.file}`, e.ticket, e.owners?.join(' ')].filter(Boolean).join(', ');
}
