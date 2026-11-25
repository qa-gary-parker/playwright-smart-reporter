import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getQuarantinedPattern } from './quarantine-helper';

// Issue #93: the reporter writes .smart-quarantine.json under Playwright's
// rootDir (the testDir), while getQuarantinedPattern() is called from
// playwright.config at the project root.
describe('getQuarantinedPattern default location', () => {
  let dir: string;
  let prevCwd: string;

  const writeQuarantine = (rel: string) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      generatedAt: '2026-10-21T00:00:00.000Z',
      threshold: 0.3,
      entries: [{ testId: 'a', title: 'flaky test', file: 'a.spec.ts', quarantinedAt: '2026-10-01T00:00:00.000Z' }],
    }));
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-quarantine-paths-'));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds the file in the current directory first', () => {
    writeQuarantine('.smart-quarantine.json');
    writeQuarantine('tests/.smart-quarantine.json');
    expect(getQuarantinedPattern()?.source).toBe('flaky test');
  });

  it('finds the file one directory down, as with testDir: ./tests', () => {
    writeQuarantine('tests/.smart-quarantine.json');
    expect(getQuarantinedPattern()?.source).toBe('flaky test');
  });

  it('ignores node_modules, .git and dist while probing', () => {
    writeQuarantine('node_modules/pkg/.smart-quarantine.json');
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', '.smart-quarantine.json'), JSON.stringify({
      entries: [{ title: 'should not match' }],
    }));
    expect(getQuarantinedPattern()).toBeUndefined();
  });

  it('returns undefined when no quarantine file exists anywhere probed', () => {
    fs.mkdirSync(path.join(dir, 'tests'));
    expect(getQuarantinedPattern()).toBeUndefined();
  });

  it('still honors an explicit path', () => {
    writeQuarantine('custom/quarantine.json');
    expect(getQuarantinedPattern(path.join(dir, 'custom/quarantine.json'))?.source).toBe('flaky test');
  });
});
