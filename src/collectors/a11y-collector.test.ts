import { describe, it, expect } from 'vitest';
import { A11yCollector } from './a11y-collector';
import type { A11yResult } from '../types';

function makeAttachment(name: string, contentType: string, body?: Buffer) {
  return { name, contentType, body };
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
  describe('collect', () => {
    it('returns undefined when attachments array is empty', () => {
      const collector = new A11yCollector();

      const result = collector.collect({ attachments: [] });

      expect(result).toBeUndefined();
    });

    it('returns undefined when no a11y attachment exists', () => {
      const collector = new A11yCollector();
      const result = collector.collect({
        attachments: [
          makeAttachment('screenshot', 'image/png', Buffer.from('fake')),
          makeAttachment('trace', 'application/zip'),
        ],
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined when body is missing', () => {
      const collector = new A11yCollector();
      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json'),
        ],
      });

      expect(result).toBeUndefined();
    });

    it('returns undefined when JSON is malformed', () => {
      const collector = new A11yCollector();
      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from('not valid json {')),
        ],
      });

      expect(result).toBeUndefined();
    });

    it('parses a11y attachment with no violations', () => {
      const collector = new A11yCollector();
      const a11yData = makeValidA11yResult();
      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(a11yData))),
        ],
      });

      expect(result).toBeDefined();
      expect(result!.violations).toEqual([]);
      expect(result!.passes).toBe(10);
      expect(result!.standard).toBe('WCAG2AA');
    });

    it('parses a11y attachment with violations', () => {
      const collector = new A11yCollector();
      const a11yData = makeValidA11yResult({
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
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
          },
        ],
      });

      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(a11yData))),
        ],
      });

      expect(result).toBeDefined();
      expect(result!.violations).toHaveLength(1);
      expect(result!.violations[0].id).toBe('color-contrast');
      expect(result!.violations[0].impact).toBe('serious');
      expect(result!.violations[0].nodes).toHaveLength(1);
      expect(result!.violations[0].nodes[0].target).toEqual(['#header > .nav-link']);
    });

    it('parses a11y tree snapshot when present', () => {
      const collector = new A11yCollector();
      const a11yData = makeValidA11yResult({
        tree: {
          role: 'document',
          name: 'My Page',
          children: [
            { role: 'navigation', name: 'Main Nav' },
            { role: 'main', name: 'Content' },
          ],
        },
      });

      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(a11yData))),
        ],
      });

      expect(result).toBeDefined();
      expect(result!.tree).toBeDefined();
      expect(result!.tree!.role).toBe('document');
      expect(result!.tree!.children).toHaveLength(2);
      expect(result!.tree!.children![0].role).toBe('navigation');
    });

    it('sets sensible defaults for missing fields', () => {
      const collector = new A11yCollector();
      const partial = { violations: [] };

      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(partial))),
        ],
      });

      expect(result).toBeDefined();
      expect(result!.passes).toBe(0);
      expect(result!.incomplete).toBe(0);
      expect(result!.inapplicable).toBe(0);
      expect(result!.standard).toBe('WCAG2AA');
      expect(result!.timestamp).toBeDefined();
    });

    it('handles violations with missing or null fields gracefully', () => {
      const collector = new A11yCollector();
      const a11yData = {
        violations: [
          { id: 'color-contrast', impact: 'serious' },
          { id: null, impact: 'invalid-impact', description: 123 },
          null,
          'not-an-object',
          { impact: 'critical', nodes: [{ target: null, html: 42 }, null] },
        ],
        passes: 5,
        incomplete: 0,
        inapplicable: 2,
        timestamp: '2026-03-06T12:00:00Z',
        standard: 'WCAG2AA',
      };

      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(a11yData))),
        ],
      });

      expect(result).toBeDefined();
      // null and 'not-an-object' are filtered out
      expect(result!.violations).toHaveLength(3);

      // First violation: valid id/impact, missing other fields get defaults
      expect(result!.violations[0].id).toBe('color-contrast');
      expect(result!.violations[0].impact).toBe('serious');
      expect(result!.violations[0].description).toBe('');
      expect(result!.violations[0].helpUrl).toBe('');
      expect(result!.violations[0].wcagTags).toEqual([]);
      expect(result!.violations[0].nodes).toEqual([]);

      // Second violation: invalid fields get defaults
      expect(result!.violations[1].id).toBe('unknown');
      expect(result!.violations[1].impact).toBe('moderate');
      expect(result!.violations[1].description).toBe('');

      // Third violation: nodes with missing/bad fields
      expect(result!.violations[2].impact).toBe('critical');
      expect(result!.violations[2].nodes).toHaveLength(2);
      expect(result!.violations[2].nodes[0].target).toEqual([]);
      expect(result!.violations[2].nodes[0].html).toBe('');
      expect(result!.violations[2].nodes[1].target).toEqual([]);
    });

    it('returns undefined when parsed JSON has no violations array', () => {
      const collector = new A11yCollector();
      const invalid = { passes: 10, standard: 'WCAG2AA' };

      const result = collector.collect({
        attachments: [
          makeAttachment('smart-reporter-a11y', 'application/json', Buffer.from(JSON.stringify(invalid))),
        ],
      });

      expect(result).toBeUndefined();
    });
  });
});
