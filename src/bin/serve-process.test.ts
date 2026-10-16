import { describe, expect, it } from 'vitest';
import { browserCommand } from './serve-process';

describe('browserCommand', () => {
  const url = 'http://localhost:4173/smart-report.html';

  it('opens the URL with start on Windows, after an empty title so start does not take the URL as the window title', () => {
    expect(browserCommand('win32', url)).toEqual(['cmd', ['/c', 'start', '', url]]);
  });

  it('passes the URL as the only argument to open on macOS and xdg-open on Linux', () => {
    expect(browserCommand('darwin', url)).toEqual(['open', [url]]);
    expect(browserCommand('linux', url)).toEqual(['xdg-open', [url]]);
  });
});
