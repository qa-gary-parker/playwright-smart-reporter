/**
 * Accessibility Generator - UI components for a11y results in HTML reports
 */

import type { TestResultData, A11ySuiteScore, A11yViolation, A11yTreeSnapshot, LicenseTier } from '../types';
import { escapeHtml } from '../utils';
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

function isStarterPlus(tier?: LicenseTier): boolean {
  return tier === 'starter' || tier === 'pro' || tier === 'team';
}

function impactBadge(impact: string): string {
  const color = IMPACT_COLORS[impact] || IMPACT_COLORS.minor;
  return `<span class="a11y-impact-badge" style="background:${color}">${escapeHtml(impact)}</span>`;
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

  let violationList = violations.map(v => {
    let nodeDetails = '';
    if (hasStarter && v.nodes.length > 0) {
      nodeDetails = `<div class="a11y-node-list">${v.nodes.map(n => `
        <div class="a11y-node">
          <code class="a11y-node-target">${escapeHtml(n.target.join(', '))}</code>
          <pre class="a11y-node-html">${escapeHtml(n.html)}</pre>
          <div class="a11y-node-fix">${escapeHtml(n.failureSummary)}</div>
        </div>`).join('')}
      </div>`;
    }

    const helpLink = hasStarter && v.helpUrl
      ? `<a class="a11y-help-link" href="${escapeHtml(v.helpUrl)}" target="_blank" rel="noopener">Learn more</a>`
      : '';

    return `<div class="a11y-violation">
      <div class="a11y-violation-header">
        ${impactBadge(v.impact)}
        <code class="a11y-rule-id">${escapeHtml(v.id)}</code>
        <span class="a11y-violation-desc">${escapeHtml(v.description)}</span>
        ${helpLink}
      </div>
      ${nodeDetails}
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

export function generateA11yTab(results: TestResultData[], suiteScore: A11ySuiteScore): string {
  const ratingColor = RATING_COLORS[suiteScore.rating] || RATING_COLORS.fair;

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

  // Most common issues - aggregate across all tests
  const violationCounts = new Map<string, { count: number; impact: string; description: string; helpUrl: string }>();
  for (const test of results) {
    if (!test.accessibility) continue;
    for (const v of test.accessibility.violations) {
      const existing = violationCounts.get(v.id);
      if (existing) {
        existing.count++;
      } else {
        violationCounts.set(v.id, { count: 1, impact: v.impact, description: v.description, helpUrl: v.helpUrl });
      }
    }
  }
  const topIssues = Array.from(violationCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);

  const commonIssues = topIssues.length > 0 ? `
    <div class="a11y-common-section">
      <h3 class="a11y-section-title">Most Common Issues</h3>
      <div class="a11y-common-list">
        ${topIssues.map(([ruleId, info]) => `
          <div class="a11y-common-item">
            ${impactBadge(info.impact)}
            <code class="a11y-rule-id">${escapeHtml(ruleId)}</code>
            <span class="a11y-common-desc">${escapeHtml(info.description)}</span>
            <span class="a11y-common-count">${info.count}</span>
            ${info.helpUrl ? `<a class="a11y-help-link" href="${escapeHtml(info.helpUrl)}" target="_blank" rel="noopener">Docs</a>` : ''}
          </div>`).join('')}
      </div>
    </div>` : '';

  // Worst offenders - tests with most violations
  const testViolations = results
    .filter(t => t.accessibility && t.accessibility.violations.length > 0)
    .map(t => ({ testId: t.testId, title: t.title, count: t.accessibility!.violations.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const worstOffenders = testViolations.length > 0 ? `
    <div class="a11y-offenders-section">
      <h3 class="a11y-section-title">Worst Offenders</h3>
      <div class="a11y-offenders-list">
        ${testViolations.map(t => `
          <div class="a11y-offender-item" onclick="selectTest('${escapeHtml(t.testId.replace(/[^a-zA-Z0-9-_]/g, '_'))}'); switchView('tests');" style="cursor:pointer">
            <span class="a11y-offender-title">${escapeHtml(t.title)}</span>
            <span class="a11y-offender-count">${t.count} violations</span>
          </div>`).join('')}
      </div>
    </div>` : '';

  return `
    <div class="view-header">
      <h2 class="view-title">${icon('accessibility')} Accessibility</h2>
    </div>
    <div class="a11y-tab-content">
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
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .a11y-section {
      margin-top: 12px;
    }
    .a11y-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-secondary, #f8f9fa);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.85rem;
    }
    .a11y-section-header:hover {
      background: var(--bg-card-hover, #eef0f2);
    }
    .a11y-count-badge {
      background: var(--accent-orange, #e67e22);
      color: #fff;
      padding: 1px 7px;
      border-radius: 10px;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .a11y-section-chevron {
      margin-left: auto;
      transition: transform 0.2s;
    }
    .a11y-section-body {
      padding: 8px 0;
    }
    .a11y-violation {
      padding: 8px 12px;
      border-left: 3px solid var(--border-subtle, #e0e0e0);
      margin: 6px 0;
      border-radius: 0 6px 6px 0;
      background: var(--bg-card, #fff);
    }
    .a11y-violation-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .a11y-rule-id {
      font-size: 0.8rem;
      color: var(--text-secondary, #666);
      background: var(--bg-secondary, #f0f0f0);
      padding: 1px 6px;
      border-radius: 4px;
    }
    .a11y-violation-desc {
      font-size: 0.8rem;
      color: var(--text-primary, #333);
    }
    .a11y-help-link {
      font-size: 0.75rem;
      color: var(--accent-blue, #3498db);
      text-decoration: none;
      margin-left: auto;
    }
    .a11y-help-link:hover {
      text-decoration: underline;
    }
    .a11y-node-list {
      margin-top: 6px;
      padding-left: 12px;
    }
    .a11y-node {
      padding: 6px 8px;
      margin: 4px 0;
      background: var(--bg-secondary, #f8f9fa);
      border-radius: 4px;
      font-size: 0.75rem;
    }
    .a11y-node-target {
      color: var(--accent-purple, #8e44ad);
      font-size: 0.75rem;
    }
    .a11y-node-html {
      margin: 4px 0;
      padding: 4px 8px;
      background: var(--bg-primary, #f0f0f0);
      border-radius: 4px;
      font-size: 0.7rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .a11y-node-fix {
      color: var(--text-secondary, #666);
      font-style: italic;
    }

    /* A11y Tree */
    .a11y-tree-section {
      margin-top: 10px;
      border: 1px solid var(--border-subtle, #e0e0e0);
      border-radius: 8px;
      overflow: hidden;
    }
    .a11y-tree-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-secondary, #f8f9fa);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .a11y-tree-header:hover {
      background: var(--bg-card-hover, #eef0f2);
    }
    .a11y-tree-content {
      padding: 8px;
      max-height: 300px;
      overflow-y: auto;
      font-size: 0.75rem;
      font-family: var(--font-mono, monospace);
    }
    .a11y-tree-node {
      line-height: 1.6;
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
      padding: 16px 0;
    }
    .a11y-summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .a11y-summary-card {
      background: var(--bg-card, #fff);
      border: 1px solid var(--border-subtle, #e0e0e0);
      border-radius: 10px;
      padding: 16px;
      text-align: center;
    }
    .a11y-summary-value {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .a11y-summary-label {
      font-size: 0.8rem;
      color: var(--text-secondary, #666);
      margin-top: 4px;
    }
    .a11y-section-title {
      font-size: 0.95rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text-primary, #333);
    }
    .a11y-severity-section {
      margin-bottom: 24px;
    }
    .a11y-severity-bar {
      display: flex;
      height: 24px;
      border-radius: 6px;
      overflow: hidden;
      background: var(--bg-secondary, #f0f0f0);
    }
    .a11y-severity-seg {
      transition: width 0.3s;
      min-width: 2px;
    }
    .a11y-severity-legend {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      font-size: 0.8rem;
      color: var(--text-secondary, #666);
      flex-wrap: wrap;
    }
    .a11y-legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .a11y-legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .a11y-common-section,
    .a11y-offenders-section {
      margin-bottom: 24px;
    }
    .a11y-common-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle, #e0e0e0);
      font-size: 0.8rem;
    }
    .a11y-common-item:last-child {
      border-bottom: none;
    }
    .a11y-common-desc {
      flex: 1;
      color: var(--text-primary, #333);
    }
    .a11y-common-count {
      background: var(--bg-secondary, #f0f0f0);
      padding: 2px 8px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.75rem;
    }
    .a11y-offender-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-subtle, #e0e0e0);
      font-size: 0.8rem;
    }
    .a11y-offender-item:hover {
      background: var(--bg-card-hover, #eef0f2);
    }
    .a11y-offender-item:last-child {
      border-bottom: none;
    }
    .a11y-offender-title {
      color: var(--text-primary, #333);
    }
    .a11y-offender-count {
      color: var(--accent-orange, #e67e22);
      font-weight: 600;
      white-space: nowrap;
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
  `;
}
