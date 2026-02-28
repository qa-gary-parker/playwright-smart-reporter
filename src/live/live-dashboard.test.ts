import { describe, it, expect } from 'vitest';
import { generateLiveDashboard } from './live-dashboard';

describe('generateLiveDashboard', () => {
  it('generates valid HTML with polling mode by default', () => {
    const html = generateLiveDashboard({ jsonlFile: '.smart-live-results.jsonl' });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Live Test Results');
    expect(html).toContain('.smart-live-results.jsonl');
    expect(html).toContain('setInterval');
    expect(html).not.toContain('EventSource');
  });

  it('generates HTML with SSE mode when sseUrl is provided', () => {
    const html = generateLiveDashboard({
      jsonlFile: '.smart-live-results.jsonl',
      sseUrl: 'http://localhost:3000/sse',
    });

    expect(html).toContain('EventSource');
    expect(html).toContain('http://localhost:3000/sse');
    expect(html).not.toContain('setInterval');
  });

  it('includes progress bar, counters, and failure feed elements', () => {
    const html = generateLiveDashboard({ jsonlFile: '.smart-live-results.jsonl' });

    expect(html).toContain('id="progress-bar"');
    expect(html).toContain('id="counter-passed"');
    expect(html).toContain('id="counter-failed"');
    expect(html).toContain('id="counter-skipped"');
    expect(html).toContain('id="failure-feed"');
    expect(html).toContain('id="status-banner"');
  });

  it('escapes the jsonl file path to prevent XSS', () => {
    const html = generateLiveDashboard({ jsonlFile: '"><script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
