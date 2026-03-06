/**
 * Accessibility Generator - UI components for a11y results in HTML reports
 */

import type { TestResultData, A11ySuiteScore, A11yViolation, A11yNode, A11yTreeSnapshot, LicenseTier } from '../types';
import { escapeHtml, renderMarkdownLite } from '../utils';
import { icon } from './icon-provider';

const IMPACT_COLORS: Record<string, string> = {
  critical: 'var(--accent-red, #e74c3c)',
  serious: 'var(--accent-orange, #e67e22)',
  moderate: 'var(--accent-yellow, #f39c12)',
  minor: 'var(--accent-blue, #3498db)',
};

const RATING_COLORS: Record<string, string> = {
  excellent: 'var(--accent-green, #27ae60)',
  good: 'var(--accent-blue, #3498db)',
  fair: 'var(--accent-orange, #e67e22)',
  poor: 'var(--accent-red, #e74c3c)',
};

const WCAG_CRITERIA_URLS: Record<string, string> = {
  'wcag111': 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
  'wcag131': 'https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html',
  'wcag141': 'https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html',
  'wcag143': 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
  'wcag211': 'https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html',
  'wcag241': 'https://www.w3.org/WAI/WCAG21/Understanding/bypass-blocks.html',
  'wcag244': 'https://www.w3.org/WAI/WCAG21/Understanding/link-purpose-in-context.html',
  'wcag246': 'https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels.html',
  'wcag251': 'https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures.html',
  'wcag311': 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html',
  'wcag312': 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-parts.html',
  'wcag321': 'https://www.w3.org/WAI/WCAG21/Understanding/on-focus.html',
  'wcag332': 'https://www.w3.org/WAI/WCAG21/Understanding/labels-or-instructions.html',
  'wcag411': 'https://www.w3.org/WAI/WCAG21/Understanding/parsing.html',
  'wcag412': 'https://www.w3.org/WAI/WCAG21/Understanding/name-role-value.html',
};

function isStarterPlus(tier?: LicenseTier): boolean {
  return tier === 'starter' || tier === 'pro' || tier === 'team';
}

function impactBadge(impact: string): string {
  const color = IMPACT_COLORS[impact] || IMPACT_COLORS.minor;
  return `<span class="a11y-impact-badge" style="background:${color}">${escapeHtml(impact)}</span>`;
}

function getWcagLink(wcagTags: string[]): string {
  for (const tag of wcagTags) {
    const normalized = tag.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (WCAG_CRITERIA_URLS[normalized]) {
      const criterion = tag.replace(/^wcag/, '').replace(/(\d)(\d)(\d)/, '$1.$2.$3');
      return `<a class="a11y-help-link a11y-wcag-link" href="${WCAG_CRITERIA_URLS[normalized]}" target="_blank" rel="noopener">WCAG ${criterion}</a>`;
    }
  }
  return '';
}

function renderHelpLinks(v: A11yViolation): string {
  const links: string[] = [];
  const wcagLink = getWcagLink(v.wcagTags);
  if (wcagLink) links.push(wcagLink);
  if (v.helpUrl) {
    links.push(`<a class="a11y-help-link" href="${escapeHtml(v.helpUrl)}" target="_blank" rel="noopener">Docs</a>`);
  }
  return links.length > 0 ? `<span class="a11y-help-links">${links.join('')}</span>` : '';
}

function buildPromptData(v: A11yViolation, context?: string): string {
  const nodes = v.nodes.slice(0, 5).map(n => ({
    selector: n.target.join(', '),
    html: n.html,
    fix: n.failureSummary,
  }));
  return escapeHtml(JSON.stringify({ rule: v.id, impact: v.impact, desc: v.description, wcag: v.wcagTags, nodes, context }));
}

function copyPromptButton(v: A11yViolation, context?: string): string {
  return `<button class="a11y-copy-prompt-btn" onclick="event.stopPropagation();copyA11yPrompt(this)" data-a11y-prompt="${buildPromptData(v, context)}" title="Copy fix prompt to clipboard">${icon('clipboard', 12)} Copy Prompt</button>`;
}

function renderNodeDetails(nodes: A11yNode[]): string {
  if (nodes.length === 0) return '';
  return `<div class="a11y-node-list">${nodes.map(n => `
    <div class="a11y-node">
      <code class="a11y-node-target">${escapeHtml(n.target.join(', '))}</code>
      <pre class="a11y-node-html">${escapeHtml(n.html)}</pre>
      ${n.failureSummary ? `<div class="a11y-node-fix">${escapeHtml(n.failureSummary)}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

function renderTreeNode(node: A11yTreeSnapshot, depth: number = 0): string {
  const indent = depth * 16;
  const hasChildren = node.children && node.children.length > 0;
  const toggle = hasChildren
    ? `<span class="a11y-tree-toggle" onclick="this.parentElement.classList.toggle('a11y-tree-collapsed')">${icon('chevron-down', 12)}</span>`
    : '<span class="a11y-tree-toggle a11y-tree-leaf"></span>';
  const children = hasChildren
    ? `<div class="a11y-tree-children">${node.children!.map(c => renderTreeNode(c, depth + 1)).join('')}</div>`
    : '';
  return `<div class="a11y-tree-node" style="padding-left:${indent}px">
    ${toggle}
    <span class="a11y-tree-role">${escapeHtml(node.role)}</span>
    ${node.name ? `<span class="a11y-tree-name">"${escapeHtml(node.name)}"</span>` : ''}
    ${children}
  </div>`;
}

export function generateTestA11ySection(test: TestResultData, licenseTier?: LicenseTier): string {
  const a11y = test.accessibility;
  if (!a11y || a11y.violations.length === 0) return '';

  const violations = a11y.violations;
  const hasStarter = isStarterPlus(licenseTier);
  const sectionId = `a11y-${escapeHtml(test.testId).replace(/[^a-zA-Z0-9-_]/g, '_')}`;

  let violationList = violations.map((v, idx) => {
    const violationId = `${sectionId}-v${idx}`;
    const hasNodes = hasStarter && v.nodes.length > 0;
    const nodeDetails = hasNodes ? renderNodeDetails(v.nodes) : '';

    return `<div class="a11y-violation" style="border-left-color: ${IMPACT_COLORS[v.impact] || IMPACT_COLORS.minor}">
      <div class="a11y-violation-header${hasNodes ? ' a11y-collapsible' : ''}" ${hasNodes ? `onclick="toggleA11yDetail('${violationId}')"` : ''}>
        ${impactBadge(v.impact)}
        <code class="a11y-rule-id">${escapeHtml(v.id)}</code>
        ${renderHelpLinks(v)}
        ${copyPromptButton(v, `Test: ${test.title} (${test.file})`)}
        ${hasNodes ? `<span class="a11y-detail-chevron" id="${violationId}-chevron">${icon('chevron-down', 12)}</span>` : ''}
        <span class="a11y-violation-desc">${escapeHtml(v.description)}</span>
      </div>
      ${hasNodes ? `<div class="a11y-detail-body" id="${violationId}-body" style="display:none">${nodeDetails}</div>` : ''}
    </div>`;
  }).join('');

  let treeViewer = '';
  if (hasStarter && a11y.tree) {
    treeViewer = `
      <div class="a11y-tree-section">
        <div class="a11y-tree-header" onclick="toggleA11yTree('${sectionId}')">
          <span>${icon('git-branch', 14)} Accessibility Tree</span>
          <span class="a11y-tree-chevron" id="${sectionId}-tree-chevron">${icon('chevron-down', 12)}</span>
        </div>
        <div class="a11y-tree-content" id="${sectionId}-tree" style="display:none">
          ${renderTreeNode(a11y.tree)}
        </div>
      </div>`;
  }

  return `
    <div class="detail-section a11y-section">
      <div class="a11y-section-header" onclick="toggleA11ySection('${sectionId}')">
        <span class="icon">${icon('accessibility')}</span> Accessibility
        <span class="a11y-count-badge">${violations.length}</span>
        <span class="a11y-section-chevron" id="${sectionId}-chevron">${icon('chevron-down', 12)}</span>
      </div>
      <div class="a11y-section-body" id="${sectionId}-body" style="display:none">
        ${violationList}
        ${treeViewer}
      </div>
    </div>`;
}

export function generateA11yTab(results: TestResultData[], suiteScore: A11ySuiteScore, aiSummary?: string): string {
  const ratingColor = RATING_COLORS[suiteScore.rating] || RATING_COLORS.fair;

  // AI Analysis section
  const aiSection = aiSummary ? `
    <div class="a11y-ai-section">
      <div class="a11y-ai-card">
        <div class="a11y-ai-header">
          <span class="a11y-ai-icon">${icon('bot', 16)}</span>
          <span class="a11y-ai-title">AI Accessibility Analysis</span>
        </div>
        <div class="a11y-ai-body ai-markdown">${renderMarkdownLite(aiSummary)}</div>
      </div>
    </div>` : '';

  // Summary cards
  const summaryCards = `
    <div class="a11y-summary-cards">
      <div class="a11y-summary-card">
        <div class="a11y-summary-value" style="color:${ratingColor}">${escapeHtml(suiteScore.rating.charAt(0).toUpperCase() + suiteScore.rating.slice(1))}</div>
        <div class="a11y-summary-label">Rating</div>
      </div>
      <div class="a11y-summary-card">
        <div class="a11y-summary-value">${suiteScore.totalViolations}</div>
        <div class="a11y-summary-label">Total Violations</div>
      </div>
      <div class="a11y-summary-card">
        <div class="a11y-summary-value">${suiteScore.testsScanned}</div>
        <div class="a11y-summary-label">Tests Scanned</div>
      </div>
      <div class="a11y-summary-card">
        <div class="a11y-summary-value">${suiteScore.testsWithViolations}</div>
        <div class="a11y-summary-label">Tests With Issues</div>
      </div>
    </div>`;

  // Severity breakdown bar
  const total = suiteScore.critical + suiteScore.serious + suiteScore.moderate + suiteScore.minor;
  const pct = (n: number) => total > 0 ? ((n / total) * 100).toFixed(1) : '0';
  const severityBar = `
    <div class="a11y-severity-section">
      <h3 class="a11y-section-title">Severity Breakdown</h3>
      <div class="a11y-severity-bar">
        ${suiteScore.critical > 0 ? `<div class="a11y-severity-seg" style="width:${pct(suiteScore.critical)}%;background:${IMPACT_COLORS.critical}" title="Critical: ${suiteScore.critical}"></div>` : ''}
        ${suiteScore.serious > 0 ? `<div class="a11y-severity-seg" style="width:${pct(suiteScore.serious)}%;background:${IMPACT_COLORS.serious}" title="Serious: ${suiteScore.serious}"></div>` : ''}
        ${suiteScore.moderate > 0 ? `<div class="a11y-severity-seg" style="width:${pct(suiteScore.moderate)}%;background:${IMPACT_COLORS.moderate}" title="Moderate: ${suiteScore.moderate}"></div>` : ''}
        ${suiteScore.minor > 0 ? `<div class="a11y-severity-seg" style="width:${pct(suiteScore.minor)}%;background:${IMPACT_COLORS.minor}" title="Minor: ${suiteScore.minor}"></div>` : ''}
      </div>
      <div class="a11y-severity-legend">
        <span class="a11y-legend-item"><span class="a11y-legend-dot" style="background:${IMPACT_COLORS.critical}"></span>Critical: ${suiteScore.critical}</span>
        <span class="a11y-legend-item"><span class="a11y-legend-dot" style="background:${IMPACT_COLORS.serious}"></span>Serious: ${suiteScore.serious}</span>
        <span class="a11y-legend-item"><span class="a11y-legend-dot" style="background:${IMPACT_COLORS.moderate}"></span>Moderate: ${suiteScore.moderate}</span>
        <span class="a11y-legend-item"><span class="a11y-legend-dot" style="background:${IMPACT_COLORS.minor}"></span>Minor: ${suiteScore.minor}</span>
      </div>
    </div>`;

  // Most common issues - aggregate across all tests with full node details
  const violationAgg = new Map<string, { count: number; impact: string; description: string; helpUrl: string; wcagTags: string[]; nodes: { target: string[]; html: string; failureSummary: string; testTitle: string }[] }>();
  for (const test of results) {
    if (!test.accessibility) continue;
    for (const v of test.accessibility.violations) {
      const existing = violationAgg.get(v.id);
      const nodeEntries = v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary, testTitle: test.title }));
      if (existing) {
        existing.count++;
        existing.nodes.push(...nodeEntries);
      } else {
        violationAgg.set(v.id, { count: 1, impact: v.impact, description: v.description, helpUrl: v.helpUrl, wcagTags: v.wcagTags, nodes: [...nodeEntries] });
      }
    }
  }
  const topIssues = Array.from(violationAgg.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const commonIssues = topIssues.length > 0 ? `
    <div class="a11y-common-section">
      <h3 class="a11y-section-title">Top Issues</h3>
      <div class="a11y-common-list">
        ${topIssues.map(([ruleId, info], idx) => {
          const itemId = `a11y-tab-issue-${idx}`;
          const wcagLink = getWcagLink(info.wcagTags);
          const dequeLink = info.helpUrl ? `<a class="a11y-help-link" href="${escapeHtml(info.helpUrl)}" target="_blank" rel="noopener">Docs</a>` : '';
          const nodeDetails = info.nodes.slice(0, 20).map(n => `
            <div class="a11y-node">
              <div class="a11y-node-meta"><span class="a11y-node-test-label">Test:</span> ${escapeHtml(n.testTitle)}</div>
              <code class="a11y-node-target">${escapeHtml(n.target.join(', '))}</code>
              <pre class="a11y-node-html">${escapeHtml(n.html)}</pre>
              ${n.failureSummary ? `<div class="a11y-node-fix">${escapeHtml(n.failureSummary)}</div>` : ''}
            </div>`).join('');
          const moreNodes = info.nodes.length > 20 ? `<div class="a11y-node-more">... and ${info.nodes.length - 20} more affected elements</div>` : '';

          return `
          <div class="a11y-common-item-wrap">
            <div class="a11y-common-item a11y-collapsible" onclick="toggleA11yDetail('${itemId}')">
              ${impactBadge(info.impact)}
              <code class="a11y-rule-id">${escapeHtml(ruleId)}</code>
              <span class="a11y-help-links">${wcagLink}${dequeLink}</span>
              ${copyPromptButton({ id: ruleId, impact: info.impact as A11yViolation['impact'], description: info.description, helpUrl: info.helpUrl, wcagTags: info.wcagTags, nodes: info.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) })}
              <span class="a11y-common-count">${info.nodes.length} elements across ${info.count} ${info.count === 1 ? 'test' : 'tests'}</span>
              <span class="a11y-detail-chevron" id="${itemId}-chevron">${icon('chevron-down', 12)}</span>
              <span class="a11y-common-desc">${escapeHtml(info.description)}</span>
            </div>
            <div class="a11y-detail-body" id="${itemId}-body" style="display:none">
              <div class="a11y-node-list">
                ${nodeDetails}
                ${moreNodes}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  // Worst offenders - tests with most violations
  const testViolations = results
    .filter(t => t.accessibility && t.accessibility.violations.length > 0)
    .map(t => ({ testId: t.testId, title: t.title, count: t.accessibility!.violations.length, violations: t.accessibility!.violations }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const worstOffenders = testViolations.length > 0 ? `
    <div class="a11y-offenders-section">
      <h3 class="a11y-section-title">Worst Offenders</h3>
      <div class="a11y-offenders-list">
        ${testViolations.map((t, idx) => {
          const itemId = `a11y-tab-offender-${idx}`;
          const violationSummary = t.violations.map(v => `
            <div class="a11y-violation" style="border-left-color: ${IMPACT_COLORS[v.impact] || IMPACT_COLORS.minor}">
              <div class="a11y-violation-header">
                ${impactBadge(v.impact)}
                <code class="a11y-rule-id">${escapeHtml(v.id)}</code>
                ${renderHelpLinks(v)}
                ${copyPromptButton(v, `Test: ${t.title}`)}
                <span class="a11y-violation-desc">${escapeHtml(v.description)}</span>
              </div>
              ${renderNodeDetails(v.nodes)}
            </div>`).join('');

          return `
          <div class="a11y-offender-wrap">
            <div class="a11y-offender-item a11y-collapsible" onclick="toggleA11yDetail('${itemId}')">
              <span class="a11y-offender-title">${escapeHtml(t.title)}</span>
              <span class="a11y-offender-count">${t.count} violations</span>
              <span class="a11y-detail-chevron" id="${itemId}-chevron">${icon('chevron-down', 12)}</span>
            </div>
            <div class="a11y-detail-body" id="${itemId}-body" style="display:none">
              ${violationSummary}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  return `
    <div class="view-header">
      <h2 class="view-title">${icon('accessibility')} Accessibility</h2>
    </div>
    <div class="a11y-tab-content">
      ${aiSection}
      ${summaryCards}
      ${severityBar}
      ${commonIssues}
      ${worstOffenders}
    </div>`;
}

export function generateA11yStyles(): string {
  return `
    /* Accessibility Section Styles */
    .a11y-impact-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }
    .a11y-section {
      margin-top: 16px;
    }
    .a11y-section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      background: var(--bg-secondary, #f8f9fa);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
      transition: background 0.15s;
    }
    .a11y-section-header:hover {
      background: var(--bg-card-hover, #eef0f2);
    }
    .a11y-count-badge {
      background: var(--accent-orange, #e67e22);
      color: #fff;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .a11y-section-chevron {
      margin-left: auto;
      transition: transform 0.2s;
    }
    .a11y-section-body {
      padding: 12px 0;
    }
    .a11y-violation {
      padding: 14px 16px;
      border-left: 3px solid var(--border-subtle, #e0e0e0);
      margin: 8px 0;
      border-radius: 0 8px 8px 0;
      background: var(--bg-card, #fff);
    }
    .a11y-violation-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      flex-wrap: wrap;
      row-gap: 6px;
    }
    .a11y-collapsible {
      cursor: pointer;
    }
    .a11y-collapsible:hover {
      opacity: 0.85;
    }
    .a11y-detail-chevron {
      margin-left: auto;
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .a11y-detail-body {
      overflow: hidden;
      padding: 4px 0 4px 4px;
    }
    .a11y-rule-id {
      font-size: 0.8rem;
      color: var(--text-secondary, #666);
      background: var(--bg-secondary, #f0f0f0);
      padding: 2px 8px;
      border-radius: 4px;
    }
    .a11y-violation-desc {
      font-size: 0.8rem;
      color: var(--text-primary, #333);
      flex-basis: 100%;
      order: 10;
    }
    .a11y-help-links {
      display: inline-flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .a11y-help-link {
      font-size: 0.72rem;
      color: var(--accent-blue, #3498db);
      text-decoration: none;
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--bg-secondary, #f0f0f0);
      white-space: nowrap;
    }
    .a11y-help-link:hover {
      text-decoration: underline;
      background: var(--bg-card-hover, #e8eaed);
    }
    .a11y-copy-prompt-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.72rem;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid var(--border-subtle, #e0e0e0);
      background: var(--bg-secondary, #f0f0f0);
      color: var(--text-secondary, #666);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s;
      flex-shrink: 0;
      margin-left: auto;
    }
    .a11y-copy-prompt-btn:hover {
      background: var(--bg-card-hover, #e8eaed);
      color: var(--text-primary, #333);
      border-color: var(--accent-blue, #3498db);
    }
    .a11y-copy-prompt-copied {
      background: var(--accent-green, #27ae60) !important;
      color: #fff !important;
      border-color: var(--accent-green, #27ae60) !important;
    }
    .a11y-wcag-link {
      color: var(--accent-purple, #8e44ad);
    }
    .a11y-node-list {
      margin-top: 10px;
      padding-left: 16px;
      border-left: 2px solid var(--border-subtle, #e0e0e0);
      margin-left: 4px;
    }
    .a11y-node {
      padding: 10px 12px;
      margin: 6px 0;
      background: var(--bg-secondary, #f8f9fa);
      border-radius: 6px;
      font-size: 0.78rem;
    }
    .a11y-node-meta {
      font-size: 0.72rem;
      color: var(--text-secondary, #888);
      margin-bottom: 6px;
    }
    .a11y-node-test-label {
      font-weight: 600;
      color: var(--text-secondary, #666);
    }
    .a11y-node-target {
      color: var(--accent-purple, #8e44ad);
      font-size: 0.78rem;
      font-weight: 500;
    }
    .a11y-node-html {
      margin: 8px 0;
      padding: 8px 12px;
      background: var(--bg-primary, #f0f0f0);
      border-radius: 6px;
      font-size: 0.72rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
    }
    .a11y-node-fix {
      color: var(--text-secondary, #666);
      font-style: italic;
      margin-top: 6px;
      line-height: 1.5;
    }
    .a11y-node-more {
      padding: 8px 12px;
      font-size: 0.75rem;
      color: var(--text-secondary, #888);
      font-style: italic;
    }

    /* A11y Tree */
    .a11y-tree-section {
      margin-top: 14px;
      border: 1px solid var(--border-subtle, #e0e0e0);
      border-radius: 8px;
      overflow: hidden;
    }
    .a11y-tree-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: var(--bg-secondary, #f8f9fa);
      cursor: pointer;
      font-size: 0.82rem;
      font-weight: 600;
      transition: background 0.15s;
    }
    .a11y-tree-header:hover {
      background: var(--bg-card-hover, #eef0f2);
    }
    .a11y-tree-content {
      padding: 12px 16px;
      max-height: 300px;
      overflow-y: auto;
      font-size: 0.78rem;
      font-family: var(--font-mono, monospace);
    }
    .a11y-tree-node {
      line-height: 1.7;
    }
    .a11y-tree-toggle {
      cursor: pointer;
      display: inline-block;
      width: 16px;
      transition: transform 0.2s;
    }
    .a11y-tree-leaf {
      visibility: hidden;
    }
    .a11y-tree-collapsed > .a11y-tree-children {
      display: none;
    }
    .a11y-tree-collapsed > .a11y-tree-toggle svg {
      transform: rotate(-90deg);
    }
    .a11y-tree-role {
      color: var(--accent-purple, #8e44ad);
      font-weight: 600;
    }
    .a11y-tree-name {
      color: var(--text-secondary, #666);
    }

    /* A11y Tab */
    .a11y-tab-content {
      padding: 24px 20px;
    }
    .a11y-summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .a11y-summary-card {
      background: var(--bg-card, #fff);
      border: 1px solid var(--border-subtle, #e0e0e0);
      border-radius: 12px;
      padding: 20px 16px;
      text-align: center;
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .a11y-summary-card:hover {
      border-color: var(--accent-blue, #3498db);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }
    .a11y-summary-value {
      font-size: 1.6rem;
      font-weight: 700;
    }
    .a11y-summary-label {
      font-size: 0.82rem;
      color: var(--text-secondary, #666);
      margin-top: 6px;
    }
    .a11y-section-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 14px;
      color: var(--text-primary, #333);
    }
    .a11y-severity-section {
      margin-bottom: 32px;
    }
    .a11y-severity-bar {
      display: flex;
      height: 28px;
      border-radius: 8px;
      overflow: hidden;
      background: var(--bg-secondary, #f0f0f0);
    }
    .a11y-severity-seg {
      transition: width 0.3s;
      min-width: 2px;
    }
    .a11y-severity-legend {
      display: flex;
      gap: 20px;
      margin-top: 12px;
      font-size: 0.82rem;
      color: var(--text-secondary, #666);
      flex-wrap: wrap;
    }
    .a11y-legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .a11y-legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .a11y-common-section,
    .a11y-offenders-section {
      margin-bottom: 32px;
    }
    .a11y-common-list,
    .a11y-offenders-list {
      background: var(--bg-card, #fff);
      border: 1px solid var(--border-subtle, #e0e0e0);
      border-radius: 10px;
      overflow: hidden;
    }
    .a11y-common-item-wrap,
    .a11y-offender-wrap {
      border-bottom: 1px solid var(--border-subtle, #e0e0e0);
    }
    .a11y-common-item-wrap:last-child,
    .a11y-offender-wrap:last-child {
      border-bottom: none;
    }
    .a11y-common-item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 14px 16px;
      font-size: 0.82rem;
      transition: background 0.1s;
      flex-wrap: wrap;
      row-gap: 6px;
    }
    .a11y-common-item:hover {
      background: var(--bg-secondary, #f8f9fa);
    }
    .a11y-common-desc {
      flex-basis: 100%;
      order: 10;
      color: var(--text-primary, #333);
      padding-left: 2px;
    }
    .a11y-common-count {
      background: var(--bg-secondary, #f0f0f0);
      padding: 3px 10px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.72rem;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .a11y-offender-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      font-size: 0.82rem;
      transition: background 0.1s;
    }
    .a11y-offender-item:hover {
      background: var(--bg-secondary, #f8f9fa);
    }
    .a11y-offender-title {
      color: var(--text-primary, #333);
      flex: 1;
      min-width: 0;
    }
    .a11y-offender-count {
      color: var(--accent-orange, #e67e22);
      font-weight: 600;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* A11y AI Section */
    .a11y-ai-section {
      margin-bottom: 32px;
    }
    .a11y-ai-card {
      background: var(--bg-card, #fff);
      border: 1px solid var(--accent-blue, #3498db);
      border-radius: 12px;
      overflow: hidden;
    }
    .a11y-ai-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: linear-gradient(135deg, rgba(52, 152, 219, 0.08), rgba(142, 68, 173, 0.08));
      font-weight: 600;
      font-size: 0.88rem;
      color: var(--text-primary, #333);
    }
    .a11y-ai-icon {
      display: flex;
      align-items: center;
      color: var(--accent-blue, #3498db);
    }
    .a11y-ai-body {
      padding: 16px 20px;
      font-size: 0.85rem;
      line-height: 1.65;
      color: var(--text-primary, #333);
    }
  `;
}

export function generateA11yScript(): string {
  return `
    function toggleA11ySection(sectionId) {
      var body = document.getElementById(sectionId + '-body');
      var chevron = document.getElementById(sectionId + '-chevron');
      if (!body) return;
      var isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
      }
    }

    function toggleA11yTree(sectionId) {
      var tree = document.getElementById(sectionId + '-tree');
      var chevron = document.getElementById(sectionId + '-tree-chevron');
      if (!tree) return;
      var isHidden = tree.style.display === 'none';
      tree.style.display = isHidden ? 'block' : 'none';
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
      }
    }

    function toggleA11yDetail(detailId) {
      var body = document.getElementById(detailId + '-body');
      var chevron = document.getElementById(detailId + '-chevron');
      if (!body) return;
      var isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (chevron) {
        chevron.style.transform = isHidden ? 'rotate(180deg)' : '';
      }
    }

    function copyA11yPrompt(btn) {
      try {
        var data = JSON.parse(btn.getAttribute('data-a11y-prompt'));
        var lines = [
          'Fix the following accessibility violation in my code:',
          '',
          'Rule: ' + data.rule + ' (' + data.impact + ')',
          'Description: ' + data.desc,
        ];
        if (data.wcag && data.wcag.length > 0) {
          lines.push('WCAG: ' + data.wcag.join(', '));
        }
        if (data.context) {
          lines.push('Context: ' + data.context);
        }
        if (data.nodes && data.nodes.length > 0) {
          lines.push('', 'Affected elements:');
          data.nodes.forEach(function(n) {
            lines.push('');
            lines.push('Selector: ' + n.selector);
            lines.push('HTML: ' + n.html);
            if (n.fix) lines.push('Fix: ' + n.fix);
          });
        }
        lines.push('', 'Please provide the corrected HTML/code to fix this issue.');
        var text = lines.join('\\n');
        var showCopied = function() {
          var orig = btn.innerHTML;
          btn.textContent = 'Copied!';
          btn.classList.add('a11y-copy-prompt-copied');
          setTimeout(function() { btn.innerHTML = orig; btn.classList.remove('a11y-copy-prompt-copied'); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(showCopied);
        } else {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          showCopied();
        }
      } catch(e) {
        console.error('Failed to copy prompt:', e);
      }
    }
  `;
}
