import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { QuarantineGenerator } from './quarantine-generator';
import { getQuarantinedPattern } from './quarantine-helper';
import type { TestResultData, QuarantineConfig, QuarantineFile } from '../types';

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

    it('excludes tests below threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.3 });
      const results = [
        createTestResult({ testId: 'low', flakinessScore: 0.1 }),
        createTestResult({ testId: 'medium', flakinessScore: 0.2 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result).toBeNull();
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

    it('returns null for empty results array', () => {
      const generator = new QuarantineGenerator({ enabled: true });

      const result = generator.generate([], '/output');

      expect(result).toBeNull();
    });

    it('returns null when all tests are below threshold', () => {
      const generator = new QuarantineGenerator({ enabled: true, threshold: 0.5 });
      const results = [
        createTestResult({ flakinessScore: 0.1 }),
        createTestResult({ flakinessScore: 0.2 }),
      ];

      const result = generator.generate(results, '/output');

      expect(result).toBeNull();
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

      expect(result).toBeNull();
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
});

describe('getQuarantinedPattern', () => {
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
    mockFs.existsSync.mockReturnValue(false);

    getQuarantinedPattern();

    expect(mockFs.existsSync).toHaveBeenCalledWith('.smart-quarantine.json');
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
    mockFs.existsSync.mockReturnValue(false);

    getQuarantinedPattern('/custom/quarantine.json');

    expect(mockFs.existsSync).toHaveBeenCalledWith('/custom/quarantine.json');
  });

  it('handles titles with pipe characters correctly', () => {
    const quarantineData: QuarantineFile = {
      generatedAt: new Date().toISOString(),
      threshold: 0.3,
      entries: [
        { testId: 't1', title: 'Test | with pipe', file: 'a.spec.ts', flakinessScore: 0.5, quarantinedAt: new Date().toISOString() },
      ],
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(quarantineData));

    const result = getQuarantinedPattern();

    expect(result).toBeInstanceOf(RegExp);
    expect(result!.test('Test | with pipe')).toBe(true);
  });
});
