import { describe, it, expect } from 'vitest';
import {
  escapeHtml,
  sanitizeId,
  hashString,
  truncate,
  stripAnsiCodes,
  sanitizeFilename,
} from './sanitizers';

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('"quotes"')).toBe('&quot;quotes&quot;');
    expect(escapeHtml("'single'")).toBe('&#039;single&#039;');
    expect(escapeHtml('&ampersand')).toBe('&amp;ampersand');
  });

  it('handles multiple special characters', () => {
    expect(escapeHtml('<div class="test">content</div>')).toBe(
      '&lt;div class=&quot;test&quot;&gt;content&lt;/div&gt;'
    );
  });

  it('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns string without special chars unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('sanitizeId', () => {
  it('replaces non-alphanumeric characters with underscores', () => {
    expect(sanitizeId('test-id')).toBe('test_id');
    expect(sanitizeId('test.spec.ts')).toBe('test_spec_ts');
    expect(sanitizeId('path/to/file')).toBe('path_to_file');
  });

  it('preserves alphanumeric characters', () => {
    expect(sanitizeId('test123')).toBe('test123');
    expect(sanitizeId('ABC')).toBe('ABC');
  });

  it('handles special characters', () => {
    expect(sanitizeId('test@#$%')).toBe('test____');
    expect(sanitizeId('hello world')).toBe('hello_world');
  });
});

describe('hashString', () => {
  it('returns consistent hash for same string', () => {
    const hash1 = hashString('test');
    const hash2 = hashString('test');
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different strings', () => {
    const hash1 = hashString('test1');
    const hash2 = hashString('test2');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a hexadecimal string', () => {
    const hash = hashString('test');
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('handles empty string', () => {
    const hash = hashString('');
    expect(hash).toBe('0');
  });
});

describe('truncate', () => {
  it('returns string unchanged if under max length', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
    expect(truncate('this is a long string', 10)).toBe('this is...');
  });

  it('handles edge cases', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcd', 3)).toBe('...');
  });
});

describe('stripAnsiCodes', () => {
  it('removes ANSI color codes', () => {
    expect(stripAnsiCodes('\x1b[31mred text\x1b[0m')).toBe('red text');
    expect(stripAnsiCodes('\x1b[32mgreen\x1b[0m')).toBe('green');
  });

  it('removes multiple ANSI codes', () => {
    const input = '\x1b[1m\x1b[31mBold Red\x1b[0m';
    expect(stripAnsiCodes(input)).toBe('Bold Red');
  });

  it('removes CSI sequences with non-SGR final bytes', () => {
    expect(stripAnsiCodes('\x1b[?25l\x1b[1Aprogress\x1b[?25h')).toBe('progress');
  });

  it('removes CSI erase-line and BEL-terminated OSC 8 hyperlinks', () => {
    expect(stripAnsiCodes('\x1b[2Kerr\x1b]8;;https://x\x07link\x1b]8;;\x07')).toBe('errlink');
  });

  it('removes ST-terminated OSC 8 hyperlinks', () => {
    expect(stripAnsiCodes('\x1b[2Kerr\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\')).toBe('errlink');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsiCodes('plain text')).toBe('plain text');
  });

  it('handles empty string', () => {
    expect(stripAnsiCodes('')).toBe('');
  });
});

describe('sanitizeFilename', () => {
  it('replaces path separators with double underscores', () => {
    expect(sanitizeFilename('path/to/file')).toBe('path__to__file');
    expect(sanitizeFilename('path\\to\\file')).toBe('path__to__file');
    expect(sanitizeFilename('file:name')).toBe('file__name');
  });

  it('replaces invalid filename characters', () => {
    expect(sanitizeFilename('file<name>')).toBe('file_name_');
    expect(sanitizeFilename('file|name')).toBe('file_name');
    expect(sanitizeFilename('file?name')).toBe('file_name');
    expect(sanitizeFilename('file*name')).toBe('file_name');
  });

  it('handles test IDs with special characters', () => {
    const testId = 'src/tests/login.spec.ts::Login Test';
    const result = sanitizeFilename(testId);
    expect(result).not.toContain('/');
    expect(result).not.toContain(':');
    expect(result).toContain('__');
  });

  it('truncates very long filenames', () => {
    const longName = 'a'.repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('adds hash when truncating for uniqueness', () => {
    const longName1 = 'a'.repeat(300) + '1';
    const longName2 = 'a'.repeat(300) + '2';
    const result1 = sanitizeFilename(longName1);
    const result2 = sanitizeFilename(longName2);
    expect(result1).not.toBe(result2);
  });
});
