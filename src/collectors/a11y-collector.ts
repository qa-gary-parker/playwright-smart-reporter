import type { A11yResult, A11yImpact, A11yViolation } from '../types';

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
      violations: (raw.violations as unknown[]).map((v: unknown) => this.validateViolation(v)).filter((v): v is A11yViolation => v !== null),
      passes: typeof raw.passes === 'number' ? raw.passes : 0,
      incomplete: typeof raw.incomplete === 'number' ? raw.incomplete : 0,
      inapplicable: typeof raw.inapplicable === 'number' ? raw.inapplicable : 0,
      standard: typeof raw.standard === 'string' ? raw.standard : 'WCAG2AA',
      timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : new Date().toISOString(),
      url: typeof raw.url === 'string' ? raw.url : undefined,
      tree: raw.tree as A11yResult['tree'],
    };
  }

  private validateViolation(v: unknown): A11yViolation | null {
    if (!v || typeof v !== 'object') return null;
    const obj = v as Record<string, unknown>;
    return {
      id: typeof obj.id === 'string' ? obj.id : 'unknown',
      impact: this.validateImpact(obj.impact),
      description: typeof obj.description === 'string' ? obj.description : '',
      helpUrl: typeof obj.helpUrl === 'string' ? obj.helpUrl : '',
      wcagTags: Array.isArray(obj.wcagTags) ? obj.wcagTags.filter((t): t is string => typeof t === 'string') : [],
      nodes: Array.isArray(obj.nodes) ? obj.nodes.map((n: any) => ({
        target: Array.isArray(n?.target) ? n.target : [],
        html: typeof n?.html === 'string' ? n.html : '',
        failureSummary: typeof n?.failureSummary === 'string' ? n.failureSummary : '',
      })) : [],
    };
  }

  private validateImpact(impact: unknown): A11yImpact {
    if (impact === 'critical' || impact === 'serious' || impact === 'moderate' || impact === 'minor') {
      return impact;
    }
    return 'moderate';
  }
}
