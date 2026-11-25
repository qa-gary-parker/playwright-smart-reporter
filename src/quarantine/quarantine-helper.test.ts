import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getQuarantinedPattern } from './quarantine-helper';

function writeQuarantine(dir: string, entries: unknown[]): string {
  const file = path.join(dir, '.smart-quarantine.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ generatedAt: '2026-11-01T00:00:00.000Z', threshold: 0.3, entries })
  );
  return file;
}

describe('getQuarantinedPattern', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quarantine-helper-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the file does not exist', () => {
    expect(getQuarantinedPattern(path.join(dir, 'missing.json'))).toBeUndefined();
  });

  it('builds a pattern from active entries', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::pays', title: 'pays', file: 'a.spec.js' },
    ]);
    expect(getQuarantinedPattern(file)).toEqual(/pays/);
  });

  it('excludes entries past their expiresAt', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::pays', title: 'pays', file: 'a.spec.js', expiresAt: '2020-01-01T00:00:00.000Z' },
      { testId: 'a.spec.js::ships', title: 'ships', file: 'a.spec.js', expiresAt: '2999-01-01T00:00:00.000Z' },
    ]);
    const pattern = getQuarantinedPattern(file);
    expect(pattern).toEqual(/ships/);
    expect(pattern?.test('pays')).toBe(false);
  });

  it('returns undefined when every entry is expired', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::pays', title: 'pays', file: 'a.spec.js', expiresAt: '2020-01-01T00:00:00.000Z' },
    ]);
    expect(getQuarantinedPattern(file)).toBeUndefined();
  });

  it('returns undefined when there are no entries', () => {
    const file = writeQuarantine(dir, []);
    expect(getQuarantinedPattern(file)).toBeUndefined();
  });
});
