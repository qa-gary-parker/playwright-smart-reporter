import { describe, expect, it } from 'vitest';
import { claudeCliToolsValue } from './ai-analyzer';

// Issue #91: with `shell: true` on Windows the empty-string `--tools` value was
// dropped, and the Claude CLI exited with "option '--tools <tools...>' argument missing".
describe('claudeCliToolsValue', () => {
  it('returns a quoted empty string on win32 so it survives shell concatenation', () => {
    expect(claudeCliToolsValue('win32')).toBe('""');
  });

  it('returns a plain empty string on platforms spawned without a shell', () => {
    expect(claudeCliToolsValue('linux')).toBe('');
    expect(claudeCliToolsValue('darwin')).toBe('');
  });
});
