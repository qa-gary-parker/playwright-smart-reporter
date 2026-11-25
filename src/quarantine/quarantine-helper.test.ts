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

// Playwright's grep target looks like "a.spec.js:3:1 › describe › title @tag"
function titlePath(file: string, ...parts: string[]): string {
  return `${file}:3:1 › ${parts.join(' › ')}`;
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

  it('returns undefined when there are no entries', () => {
    expect(getQuarantinedPattern(writeQuarantine(dir, []))).toBeUndefined();
  });

  it('excludes the quarantined test in its own file', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::flaky by env', title: 'flaky by env', file: 'a.spec.js' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('a.spec.js', 'flaky by env'))).toBe(true);
    expect(pattern.test(titlePath('a.spec.js', 'checkout', 'flaky by env'))).toBe(true);
  });

  it('does not exclude the same title in a different file', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::flaky by env', title: 'flaky by env', file: 'a.spec.js' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('q/b.spec.js', 'flaky by env'))).toBe(false);
    expect(pattern.test(titlePath('q/b.spec.js', 'unrelated'))).toBe(false);
  });

  it('does not exclude titles that merely contain the quarantined title', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::flaky by env', title: 'flaky by env', file: 'a.spec.js' },
      { testId: 'a.spec.js::pays', title: 'pays', file: 'a.spec.js' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('a.spec.js', 'not flaky by environment'))).toBe(false);
    expect(pattern.test(titlePath('a.spec.js', 'checkout', 'flaky by env on mobile'))).toBe(false);
    expect(pattern.test(titlePath('checkout.spec.ts', 'repays order'))).toBe(false);
  });

  it('still matches when the title path carries trailing tags', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::pays', title: 'pays', file: 'a.spec.js' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('a.spec.js', 'pays') + ' @smoke @fast')).toBe(true);
  });

  it('falls back to an exact-title match for entries without a file', () => {
    const file = writeQuarantine(dir, [
      { testId: '::pays', title: 'pays', file: '' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('a.spec.js', 'pays'))).toBe(true);
    expect(pattern.test(titlePath('a.spec.js', 'repays order'))).toBe(false);
  });

  it('escapes regex metacharacters in file and title', () => {
    const file = writeQuarantine(dir, [
      { testId: 'a.spec.js::pays (fast)', title: 'pays (fast)', file: 'a.spec.js' },
    ]);
    const pattern = getQuarantinedPattern(file)!;
    expect(pattern.test(titlePath('a.spec.js', 'pays (fast)'))).toBe(true);
    expect(pattern.test(titlePath('a.spec.js', 'pays fast'))).toBe(false);
  });
});
