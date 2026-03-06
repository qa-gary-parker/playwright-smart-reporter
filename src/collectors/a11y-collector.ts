import type { A11yResult } from '../types';

const A11Y_ATTACHMENT_NAME = 'smart-reporter-a11y';

export class A11yCollector {
  collect(result: { attachments: Array<{ name: string; contentType: string; body?: Buffer; path?: string }> }): A11yResult | undefined {
    const attachment = result.attachments.find(
      a => a.name === A11Y_ATTACHMENT_NAME && a.contentType === 'application/json'
    );

    if (!attachment?.body) {
      return undefined;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(attachment.body.toString('utf-8'));
    } catch {
      return undefined;
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as Record<string, unknown>).violations)) {
      return undefined;
    }

    const raw = parsed as Record<string, unknown>;

    return {
      violations: raw.violations as A11yResult['violations'],
      passes: typeof raw.passes === 'number' ? raw.passes : 0,
      incomplete: typeof raw.incomplete === 'number' ? raw.incomplete : 0,
      inapplicable: typeof raw.inapplicable === 'number' ? raw.inapplicable : 0,
      standard: typeof raw.standard === 'string' ? raw.standard : 'WCAG2AA',
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
      url: typeof raw.url === 'string' ? raw.url : undefined,
      tree: raw.tree as A11yResult['tree'],
    };
  }
}
