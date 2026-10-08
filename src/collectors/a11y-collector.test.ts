import { describe, it, expect } from 'vitest';
import { A11yCollector, A11Y_ATTACHMENT_NAME } from './a11y-collector';
import type { A11yResult } from '../types';

function makeAttachment(name: string, contentType: string, body?: Buffer) {
  return { name, contentType, body };
}

function a11yAttachment(data: unknown) {
  return makeAttachment(A11Y_ATTACHMENT_NAME, 'application/json', Buffer.from(JSON.stringify(data)));
}

function makeValidA11yResult(overrides: Partial<A11yResult> = {}): A11yResult {
  return {
    violations: [],
    passes: 10,
    incomplete: 0,
    inapplicable: 5,
    timestamp: '2026-03-06T12:00:00Z',
    standard: 'WCAG2AA',
    ...overrides,
  };
}

describe('A11yCollector', () => {
  const collector = new A11yCollector();

  it('returns undefined when attachments array is empty', () => {
    expect(collector.collect({ attachments: [] })).toBeUndefined();
  });

  it('returns undefined when no a11y attachment exists', () => {
    const result = collector.collect({
      attachments: [
        makeAttachment('screenshot', 'image/png', Buffer.from('fake')),
        makeAttachment('trace', 'application/zip'),
      ],
    });
    expect(result).toBeUndefined();
  });

  it('ignores an a11y-named attachment that is not JSON', () => {
    const result = collector.collect({
      attachments: [makeAttachment(A11Y_ATTACHMENT_NAME, 'text/plain', Buffer.from(JSON.stringify(makeValidA11yResult())))],
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when body is missing', () => {
    expect(collector.collect({ attachments: [makeAttachment(A11Y_ATTACHMENT_NAME, 'application/json')] })).toBeUndefined();
  });

  it('returns undefined when JSON is malformed', () => {
    const result = collector.collect({
      attachments: [makeAttachment(A11Y_ATTACHMENT_NAME, 'application/json', Buffer.from('not valid json {'))],
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when parsed JSON has no violations array', () => {
    expect(collector.collect({ attachments: [a11yAttachment({ passes: 10, standard: 'WCAG2AA' })] })).toBeUndefined();
  });

  it('parses a clean scan', () => {
    const result = collector.collect({ attachments: [a11yAttachment(makeValidA11yResult({ url: 'file:///page.html' }))] });
    expect(result).toEqual({
      violations: [],
      passes: 10,
      incomplete: 0,
      inapplicable: 5,
      timestamp: '2026-03-06T12:00:00Z',
      standard: 'WCAG2AA',
      url: 'file:///page.html',
    });
  });

  it('parses violations with their nodes', () => {
    const violation = {
      id: 'color-contrast',
      impact: 'serious' as const,
      description: 'Elements must have sufficient color contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast',
      wcagTags: ['wcag2aa', 'wcag143'],
      nodes: [
        {
          target: ['#header > .nav-link'],
          html: '<a class="nav-link" href="/about">About</a>',
          failureSummary: 'Fix any of the following: Element has insufficient color contrast',
        },
      ],
    };
    const result = collector.collect({ attachments: [a11yAttachment(makeValidA11yResult({ violations: [violation] }))] });
    expect(result!.violations).toEqual([violation]);
  });

  it('drops fields outside the result contract', () => {
    const result = collector.collect({
      attachments: [a11yAttachment({ ...makeValidA11yResult(), tree: { role: 'document', name: 'x' }, secret: 'y' })],
    });
    expect(result).toEqual(makeValidA11yResult());
  });

  it('sets defaults for missing fields', () => {
    const result = collector.collect({ attachments: [a11yAttachment({ violations: [] })] });
    expect(result!.passes).toBe(0);
    expect(result!.incomplete).toBe(0);
    expect(result!.inapplicable).toBe(0);
    expect(result!.standard).toBe('WCAG2AA');
    expect(result!.url).toBeUndefined();
    expect(Number.isNaN(Date.parse(result!.timestamp))).toBe(false);
  });

  it('handles violations with missing or invalid fields', () => {
    const result = collector.collect({
      attachments: [
        a11yAttachment({
          violations: [
            { id: 'color-contrast', impact: 'serious' },
            { id: null, impact: 'invalid-impact', description: 123 },
            null,
            'not-an-object',
            { impact: 'critical', wcagTags: ['wcag2a', 7], nodes: [{ target: null, html: 42 }, null] },
          ],
          passes: 5,
          incomplete: 0,
          inapplicable: 2,
          timestamp: '2026-03-06T12:00:00Z',
          standard: 'WCAG2AA',
        }),
      ],
    });

    expect(result!.violations).toEqual([
      { id: 'color-contrast', impact: 'serious', description: '', helpUrl: '', wcagTags: [], nodes: [] },
      { id: 'unknown', impact: 'moderate', description: '', helpUrl: '', wcagTags: [], nodes: [] },
      {
        id: 'unknown',
        impact: 'critical',
        description: '',
        helpUrl: '',
        wcagTags: ['wcag2a'],
        nodes: [
          { target: [], html: '', failureSummary: '' },
          { target: [], html: '', failureSummary: '' },
        ],
      },
    ]);
  });
});
