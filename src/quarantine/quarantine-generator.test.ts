import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { QuarantineGenerator, quarantineEvents } from './quarantine-generator';
import { getQuarantinedPattern } from './quarantine-helper';
import { FlakinessAnalyzer } from '../analyzers/flakiness-analyzer';
import type { TestResultData, QuarantineConfig, QuarantineFile, QuarantineEntry } from '../types';

vi.mock('fs');

const mockFs = vi.mocked(fs);

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test One',
    file: 'tests/example.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    flakinessStatus: 'flaky',
    flakinessRuns: 10,
    ...overrides,
  };
}

describe('QuarantineGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate', () => {
    it('quarantines tests with flakinessScore above threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.3 });
      const results = [
        createTestResult({ testId: 'flaky-1', title: 'Flaky test', flakinessScore: 0.5 }),
        createTestResult({ testId: 'stable-1', title: 'Stable test', flakinessScore: 0.1 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('flaky-1');
    });

    it('does not quarantine consistently failing tests (score of 1)', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.3 });
      const results = [
        createTestResult({ testId: 'always-fails', title: 'Broken test', flakinessScore: 1, flakinessStatus: 'failing' }),
        createTestResult({ testId: 'flaky-1', title: 'Flaky test', flakinessScore: 0.5 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('flaky-1');
    });

    it('does not quarantine a test that was broken and then fixed, and records the runs behind each score', () => {
      const analyzer = new FlakinessAnalyzer();
      const historyOf = (runs: string) => [...runs].map((r) => ({ passed: r === 'P', duration: 1000, timestamp: '' }));
      const fixed = createTestResult({ testId: 'fixed', flakinessStatus: undefined, flakinessRuns: undefined });
      analyzer.analyze(fixed, historyOf('FFFFFPPPPP'));
      const flaky = createTestResult({ testId: 'flaky', flakinessStatus: undefined, flakinessRuns: undefined });
      analyzer.analyze(flaky, historyOf('PFPFPFPFPF'));

      const result = new QuarantineGenerator({ enabled: true, threshold: 0.3 }).generate([fixed, flaky], '/output');

      expect(result!.entries.map((e) => [e.testId, e.flakinessScore, e.runs])).toEqual([['flaky', 0.45, 11]]);
    });

    it('excludes tests below threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.3 });
      const results = [
        createTestResult({ testId: 'low', flakinessScore: 0.1 }),
        createTestResult({ testId: 'medium', flakinessScore: 0.2 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result.entries).toEqual([]);
    });

    it('applies default threshold of 0.3 when not specified', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({ testId: 'above', flakinessScore: 0.3 }),
        createTestResult({ testId: 'below', flakinessScore: 0.29 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result).not.toBeNull();
      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('above');
      expect(result!.threshold).toBe(0.3);
    });

    it('respects custom threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.5 });
      const results = [
        createTestResult({ testId: 't1', flakinessScore: 0.6 }),
        createTestResult({ testId: 't2', flakinessScore: 0.5 }),
        createTestResult({ testId: 't3', flakinessScore: 0.4 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(2);
      expect(result!.entries.map(e => e.testId)).toEqual(['t1', 't2']);
    });

    it('caps entries at maxQuarantined', () => {
      const generator = new QuarantineGenerator({ enabled: true, maxQuarantined: 2 });
      const results = [
        createTestResult({ testId: 'low', flakinessScore: 0.4 }),
        createTestResult({ testId: 'high', flakinessScore: 0.9 }),
        createTestResult({ testId: 'mid', flakinessScore: 0.6 }),
        createTestResult({ testId: 'mid2', flakinessScore: 0.5 }),
        createTestResult({ testId: 'highest', flakinessScore: 0.95 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(2);
      expect(result!.entries.map(e => e.testId)).toEqual(['highest', 'high']);
    });

    it('sorts by flakinessScore descending', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({ testId: 'low', flakinessScore: 0.4 }),
        createTestResult({ testId: 'high', flakinessScore: 0.9 }),
        createTestResult({ testId: 'mid', flakinessScore: 0.6 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries.map(e => e.testId)).toEqual(['high', 'mid', 'low']);
      expect(result!.entries.map(e => e.flakinessScore)).toEqual([0.9, 0.6, 0.4]);
    });

    it('returns no entries for an empty results array', () => {
      const generator = new QuarantineGenerator({ enabled: true });

      const result = generator.generate([], '/output');

      expect(result.entries).toEqual([]);
    });

    it('returns no entries when all tests are below threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.5 });
      const results = [
        createTestResult({ flakinessScore: 0.1 }),
        createTestResult({ flakinessScore: 0.2 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result.entries).toEqual([]);
    });

    it('excludes skipped tests', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({ testId: 'skipped-flaky', flakinessScore: 0.8, outcome: 'skipped' }),
        createTestResult({ testId: 'active-flaky', flakinessScore: 0.7, outcome: 'flaky' }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('active-flaky');
    });

    it('excludes skipped tests even when they have high flakiness', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({ testId: 's1', flakinessScore: 1.0, outcome: 'skipped' }),
        createTestResult({ testId: 's2', flakinessScore: 0.9, outcome: 'skipped' }),
      ];

      const result = generator.generate(results, '/output');

      expect(result.entries).toEqual([]);
    });

    it('writes file to outputDir with default filename', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [createTestResult({ flakinessScore: 0.5 })];

      generator.generate(results, '/my/output/dir');

      expect(mockFs.writeFileSync).toHaveBeenCalledOnce();
      const writtenPath = mockFs.writeFileSync.mock.calls[0][0];
      expect(writtenPath).toBe(path.resolve('/my/output/dir', '.smart-quarantine.json'));
    });

    it('writes file with custom outputFile name', () => {
      const generator = new QuarantineGenerator({ enabled: true, outputFile: 'quarantine.json' });
      const results = [createTestResult({ flakinessScore: 0.5 })];

      generator.generate(results, '/output');

      const writtenPath = mockFs.writeFileSync.mock.calls[0][0];
      expect(writtenPath).toBe(path.resolve('/output', 'quarantine.json'));
    });

    it('writes valid JSON content to the file', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [createTestResult({ testId: 'x', flakinessScore: 0.5 })];

      generator.generate(results, '/output');

      const writtenContent = mockFs.writeFileSync.mock.calls[0][1] as string;
      const parsed: QuarantineFile = JSON.parse(writtenContent);
      expect(parsed.generatedAt).toBeDefined();
      expect(parsed.threshold).toBe(0.3);
      expect(parsed.entries).toHaveLength(1);
    });

    it('does not write file when no tests qualify', () => {
      const generator = new QuarantineGenerator({ enabled: true });

      generator.generate([], '/output');

      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it('quarantine entry has correct fields', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({
          testId: 'abc-123',
          title: 'Login flow',
          file: 'tests/login.spec.ts',
          flakinessScore: 0.75,
        }),
      ];

      const result = generator.generate(results, '/output');

      const entry = result!.entries[0];
      expect(entry.testId).toBe('abc-123');
      expect(entry.title).toBe('Login flow');
      expect(entry.file).toBe('tests/login.spec.ts');
      expect(entry.flakinessScore).toBe(0.75);
      expect(entry.quarantinedAt).toBeDefined();
      expect(new Date(entry.quarantinedAt).toISOString()).toBe(entry.quarantinedAt);
    });

    it('generatedAt is a valid ISO timestamp', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [createTestResult({ flakinessScore: 0.5 })];

      const result = generator.generate(results, '/output');

      expect(new Date(result!.generatedAt).toISOString()).toBe(result!.generatedAt);
    });

    it('threshold in output matches config threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.7 });
      const results = [createTestResult({ flakinessScore: 0.8 })];

      const result = generator.generate(results, '/output');

      expect(result!.threshold).toBe(0.7);
    });

    it('includes tests at exactly the threshold boundary', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.3 });
      const results = [
        createTestResult({ testId: 'exact', flakinessScore: 0.3 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('exact');
    });

    it('excludes results without flakinessScore', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = [
        createTestResult({ testId: 'no-score' }),
        createTestResult({ testId: 'has-score', flakinessScore: 0.8 }),
        createTestResult({ testId: 'undefined-score', flakinessScore: undefined }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(1);
      expect(result!.entries[0].testId).toBe('has-score');
    });

    it('caps entries at default maxQuarantined of 50', () => {
      const generator = new QuarantineGenerator({ enabled: true });
      const results = Array.from({ length: 60 }, (_, i) =>
        createTestResult({ testId: `test-${i}`, flakinessScore: 0.5 + (i * 0.001) }),
      );

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(50);
    });

    it('maxQuarantined takes highest flakiness scores when capping', () => {
      const generator = new QuarantineGenerator({ enabled: true, maxQuarantined: 2 });
      const results = [
        createTestResult({ testId: 'low', flakinessScore: 0.4 }),
        createTestResult({ testId: 'high', flakinessScore: 0.9 }),
        createTestResult({ testId: 'mid', flakinessScore: 0.6 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result!.entries).toHaveLength(2);
      expect(result!.entries.map(e => e.testId)).toEqual(['high', 'mid']);
    });
  });

  describe('getOutputPath', () => {
    it('returns resolved path with default filename', () => {
      const generator = new QuarantineGenerator({ enabled: true });

      const result = generator.getOutputPath('/my/dir');

      expect(result).toBe(path.resolve('/my/dir', '.smart-quarantine.json'));
    });

    it('returns resolved path with custom filename', () => {
      const generator = new QuarantineGenerator({ enabled: true, outputFile: 'custom.json' });

      const result = generator.getOutputPath('/output');

      expect(result).toBe(path.resolve('/output', 'custom.json'));
    });
  });

  describe('lifecycle', () => {
    const DAY1 = '2026-10-01T00:00:00.000Z';
    const DAY2 = '2026-10-02T00:00:00.000Z';
    const DAY3 = '2026-10-03T00:00:00.000Z';
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const flaky = (testId: string, flakinessScore: number, overrides: Partial<TestResultData> = {}) => createTestResult({ testId, title: testId, flakinessScore, ...overrides });
    const stable = (testId: string, overrides: Partial<TestResultData> = {}) => createTestResult({ testId, title: testId, flakinessScore: 0.05, flakinessStatus: 'stable', ...overrides });

    // An in-memory /output folder; files are given relative to it
    function disk(files: Record<string, unknown> = {}) {
      const contents = new Map(Object.entries(files).map(([p, v]) => [path.resolve('/output', p), typeof v === 'string' ? v : JSON.stringify(v)]));
      mockFs.existsSync.mockImplementation(p => contents.has(String(p)));
      mockFs.readFileSync.mockImplementation(((p: fs.PathOrFileDescriptor) => contents.get(String(p))) as typeof fs.readFileSync);
      mockFs.writeFileSync.mockImplementation(((p: fs.PathOrFileDescriptor, data: string) => { contents.set(String(p), data); }) as typeof fs.writeFileSync);
      return { read: (p = '.smart-quarantine.json'): QuarantineFile => JSON.parse(contents.get(path.resolve('/output', p))!) };
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps quarantinedAt across runs, keeps the entry of a test that did not run, and drops a test that ran and no longer qualifies', () => {
      const files = disk();
      const generator = new QuarantineGenerator({ enabled: true });
      at(DAY1);
      generator.generate([flaky('still-flaky', 0.5), flaky('fixed', 0.6), flaky('skipped', 0.7), flaky('absent', 0.9)], '/output');
      at(DAY2);
      generator.generate([flaky('still-flaky', 0.4), stable('fixed'), flaky('skipped', 0.8, { outcome: 'skipped' })], '/output');

      const file = files.read();
      expect(file.generatedAt).toBe(DAY2);
      expect(file.entries.map(e => [e.testId, e.flakinessScore, e.quarantinedAt, e.source])).toEqual([
        ['absent', 0.9, DAY1, 'auto'],
        ['skipped', 0.7, DAY1, 'auto'],
        ['still-flaky', 0.4, DAY1, 'auto'],
      ]);
    });

    it('clears the file when nothing qualifies any more', () => {
      const files = disk({ '.smart-quarantine.json': { generatedAt: DAY1, threshold: 0.3, entries: [{ testId: 'fixed', title: 'fixed', file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: DAY1 }] } });

      const result = new QuarantineGenerator({ enabled: true }).generate([stable('fixed')], '/output');

      expect(result.entries).toEqual([]);
      expect(files.read().entries).toEqual([]);
    });

    it('adds the manual file entries with their metadata, outside maxQuarantined, and takes title and file from the run', () => {
      disk({
        '.smart-quarantine.manual.json': {
          entries: [
            { testId: 'checkout.spec.ts::pays by card', title: 'pays by card', file: 'checkout.spec.ts', owners: ['@acme/payments'], ticket: 'https://jira.example.com/browse/PAY-12', reason: 'Card sandbox times out', expiresAt: '2026-11-30T00:00:00.000Z' },
            { testId: 'login.spec.ts::logs in', title: 'old title', ticket: 'PAY-13' },
          ],
        },
      });
      at(DAY1);

      const result = new QuarantineGenerator({ enabled: true, maxQuarantined: 1 }).generate([
        flaky('auto-low', 0.4),
        flaky('auto-high', 0.5, { owners: ['@acme/web'] }),
        stable('login.spec.ts::logs in', { title: 'logs in', file: 'login.spec.ts', flakinessRuns: 8, owners: ['@acme/auth'] }),
      ], '/output');

      expect(result!.entries).toEqual([
        { testId: 'auto-high', title: 'auto-high', file: 'tests/example.spec.ts', flakinessScore: 0.5, runs: 10, quarantinedAt: DAY1, source: 'auto', owners: ['@acme/web'] },
        { testId: 'checkout.spec.ts::pays by card', title: 'pays by card', file: 'checkout.spec.ts', quarantinedAt: DAY1, source: 'manual', owners: ['@acme/payments'], ticket: 'https://jira.example.com/browse/PAY-12', reason: 'Card sandbox times out', expiresAt: '2026-11-30T00:00:00.000Z' },
        { testId: 'login.spec.ts::logs in', title: 'logs in', file: 'login.spec.ts', flakinessScore: 0.05, runs: 8, quarantinedAt: DAY1, source: 'manual', owners: ['@acme/auth'], ticket: 'PAY-13' },
      ]);
    });

    it('rejects a manual entry without a testId or a title', () => {
      disk({ '.smart-quarantine.manual.json': { entries: [{ testId: 'a', title: 'a' }, { testId: 'b' }] } });

      expect(() => new QuarantineGenerator({ enabled: true }).generate([], '/output'))
        .toThrow(`${path.resolve('/output', '.smart-quarantine.manual.json')}: entries[1] needs a testId and a title`);
    });

    it('names the manual file when it is not valid JSON', () => {
      disk({ '.smart-quarantine.manual.json': '{"entries": [' });

      expect(() => new QuarantineGenerator({ enabled: true }).generate([], '/output'))
        .toThrow(`${path.resolve('/output', '.smart-quarantine.manual.json')} is not valid JSON: Unexpected end of JSON input`);
    });

    it('warns about a manual date it cannot read, naming the entry and the value, and ignores it', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const files = disk({ '.smart-quarantine.manual.json': { entries: [{ testId: 'a', title: 'a', expiresAt: 'next week' }, { testId: 'b', title: 'b', quarantinedAt: 'last month' }] } });
      at(DAY1);

      new QuarantineGenerator({ enabled: true, expiresAfterDays: 14 }).generate([], '/output');

      const manualFile = path.resolve('/output', '.smart-quarantine.manual.json');
      expect(warn.mock.calls).toEqual([
        [`⚠️  Quarantine: ${manualFile} entries[0] ("a") has an invalid expiresAt "next week"; it is ignored.`],
        [`⚠️  Quarantine: ${manualFile} entries[1] ("b") has an invalid quarantinedAt "last month"; it is ignored.`],
      ]);
      expect(files.read().entries.map(e => [e.testId, e.quarantinedAt, e.expiresAt])).toEqual([
        ['a', DAY1, '2026-10-15T00:00:00.000Z'],
        ['b', DAY1, '2026-10-15T00:00:00.000Z'],
      ]);
    });

    it('quarantines a test tagged @quarantine(ticket) or annotated quarantine, keeps it while it does not run, and releases it when it runs unmarked', () => {
      const files = disk();
      const generator = new QuarantineGenerator({ enabled: true });
      at(DAY1);
      generator.generate([
        stable('tagged', { tags: ['@smoke', '@quarantine(https://jira.example.com/browse/PAY-14)'], owners: ['@acme/payments'] }),
        stable('annotated', { annotations: [{ type: 'quarantine', description: 'PAY-15' }] }),
        stable('plain'),
      ], '/output');
      at(DAY2);
      generator.generate([stable('plain')], '/output');

      expect(files.read().entries.map(e => [e.testId, e.source, e.ticket, e.owners, e.quarantinedAt])).toEqual([
        ['tagged', 'annotation', 'https://jira.example.com/browse/PAY-14', ['@acme/payments'], DAY1],
        ['annotated', 'annotation', 'PAY-15', undefined, DAY1],
      ]);

      at(DAY3);
      generator.generate([stable('tagged', { tags: ['@smoke'] })], '/output');

      expect(files.read().entries.map(e => e.testId)).toEqual(['annotated']);
    });

    it('sets expiresAt expiresAfterDays after quarantinedAt and keeps an expiresAt the manual file gives', () => {
      const files = disk({ 'config/quarantine.json': { entries: [{ testId: 'given', title: 'given', expiresAt: '2026-10-05T00:00:00.000Z' }, { testId: 'not-given', title: 'not-given' }] } });
      const generator = new QuarantineGenerator({ enabled: true, manualFile: 'config/quarantine.json', expiresAfterDays: 14 });
      at(DAY1);
      generator.generate([flaky('auto', 0.5)], '/output');
      at(DAY2);
      generator.generate([flaky('auto', 0.5)], '/output');

      expect(files.read().entries.map(e => [e.testId, e.quarantinedAt, e.expiresAt])).toEqual([
        ['auto', DAY1, '2026-10-15T00:00:00.000Z'],
        ['given', DAY1, '2026-10-05T00:00:00.000Z'],
        ['not-given', DAY1, '2026-10-15T00:00:00.000Z'],
      ]);
    });
  });
});

describe('quarantineEvents', () => {
  const entry = (testId: string, expiresAt?: string): QuarantineEntry => ({ testId, title: testId, file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: '2026-09-01T00:00:00.000Z', expiresAt });
  const file = (generatedAt: string, entries: QuarantineEntry[]): QuarantineFile => ({ generatedAt, threshold: 0.3, entries });

  it('reports tests that entered quarantine, expired since the last run, or left it', () => {
    const previous = file('2026-10-01T00:00:00.000Z', [
      entry('stays'),
      entry('leaves'),
      entry('expired-before', '2026-09-30T00:00:00.000Z'),
      entry('expires-now', '2026-10-01T12:00:00.000Z'),
    ]);
    const next = file('2026-10-02T00:00:00.000Z', [
      entry('stays'),
      entry('expired-before', '2026-09-30T00:00:00.000Z'),
      entry('expires-now', '2026-10-01T12:00:00.000Z'),
      entry('enters'),
      entry('enters-expired', '2026-09-01T00:00:00.000Z'),
    ]);

    expect(quarantineEvents(previous, next, Date.parse('2026-10-02T00:00:00.000Z')).map(e => [e.kind, e.entry.testId])).toEqual([
      ['quarantined', 'enters'],
      ['quarantined', 'enters-expired'],
      ['expired', 'expires-now'],
      ['expired', 'enters-expired'],
      ['released', 'leaves'],
    ]);
  });

  it('releases every entry when the file is cleared, and reports nothing without a previous file', () => {
    expect(quarantineEvents(file('2026-10-01T00:00:00.000Z', [entry('a'), entry('b')]), null, 0).map(e => [e.kind, e.entry.testId])).toEqual([
      ['released', 'a'],
      ['released', 'b'],
    ]);
    expect(quarantineEvents(undefined, null, 0)).toEqual([]);
  });
});

describe('getQuarantinedPattern', () => {
  function quarantineFileAt(filePath: string, titles: string[]): void {
    const data: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: titles.map((title, i) => ({ testId: `t${i}`, title, file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: new Date().toISOString() })),
    };
    mockFs.existsSync.mockImplementation(p => p === filePath);
    mockFs.readFileSync.mockImplementation(((p: fs.PathOrFileDescriptor) => {
      if (p !== filePath) throw new Error(`ENOENT: ${p}`);
      return JSON.stringify(data);
    }) as typeof fs.readFileSync);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const result = getQuarantinedPattern('/nonexistent/path.json');

    expect(result).toBeUndefined();
  });

  it('uses default file path when none provided', () => {
    quarantineFileAt('.smart-quarantine.json', ['Login test']);

    expect(getQuarantinedPattern()).toEqual(/Login test/);
  });

  it('returns undefined when file has no entries', () => {
    const quarantineData: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: [],
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(quarantineData));

    const result = getQuarantinedPattern();

    expect(result).toBeUndefined();
  });

  it('returns regex matching test titles', () => {
    const quarantineData: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: [
        { testId: 't1', title: 'Login test', file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: new Date().toISOString() },
      ],
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(quarantineData));

    const result = getQuarantinedPattern();

    expect(result).toBeInstanceOf(RegExp);
    expect(result!.test('Login test')).toBe(true);
    expect(result!.test('Other test')).toBe(false);
  });

  it('escapes regex special characters in titles', () => {
    const quarantineData: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: [
        { testId: 't1', title: 'Test (with) [brackets] and .dots', file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: new Date().toISOString() },
      ],
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(quarantineData));

    const result = getQuarantinedPattern();

    expect(result).toBeInstanceOf(RegExp);
    expect(result!.test('Test (with) [brackets] and .dots')).toBe(true);
    expect(result!.test('Test with brackets and xdots')).toBe(false);
  });

  it('handles multiple entries with OR pattern', () => {
    const quarantineData: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: [
        { testId: 't1', title: 'Login test', file: 'a.spec.ts', flakinessScore: 0.8, quarantinedAt: new Date().toISOString() },
        { testId: 't2', title: 'Checkout flow', file: 'b.spec.ts', flakinessScore: 0.6, quarantinedAt: new Date().toISOString() },
        { testId: 't3', title: 'Search feature', file: 'c.spec.ts', flakinessScore: 0.4, quarantinedAt: new Date().toISOString() },
      ],
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(quarantineData));

    const result = getQuarantinedPattern();

    expect(result).toBeInstanceOf(RegExp);
    expect(result!.test('Login test')).toBe(true);
    expect(result!.test('Checkout flow')).toBe(true);
    expect(result!.test('Search feature')).toBe(true);
    expect(result!.test('Unknown test')).toBe(false);
  });

  it('uses custom file path when provided', () => {
    quarantineFileAt('/custom/quarantine.json', ['Login test']);

    expect(getQuarantinedPattern('/custom/quarantine.json')).toEqual(/Login test/);
  });

  it('handles titles with pipe characters correctly', () => {
    quarantineFileAt('.smart-quarantine.json', ['Test | with pipe']);

    const result = getQuarantinedPattern();

    expect(result).toEqual(/Test \| with pipe/);
    expect(result!.test('Test | with pipe')).toBe(true);
    expect(result!.test('Test passes')).toBe(false);
  });
});
