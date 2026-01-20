/**
 * Card Generator - Handles test card and test detail generation
 */

import type { TestResultData } from '../types';
import { formatDuration, escapeHtml, sanitizeId, renderMarkdownLite } from '../utils';

/**
 * Generate a single test card
 */
export function generateTestCard(test: TestResultData, showTraceSection: boolean): string {
  const isFlaky = test.flakinessScore !== undefined && test.flakinessScore >= 0.3;
  const isUnstable = test.flakinessScore !== undefined && test.flakinessScore >= 0.1 && test.flakinessScore < 0.3;
  const isSlow = test.performanceTrend?.startsWith('↑') || false;
  const isFaster = test.performanceTrend?.startsWith('↓') || false;
  const isNew = test.flakinessIndicator?.includes('New') || false;
  const hasDetails = test.error || test.aiSuggestion || test.steps.length > 0 || test.status !== 'passed';
  const cardId = sanitizeId(test.testId);

  // Determine badge class
  let badgeClass = 'new';
  if (test.flakinessIndicator?.includes('Stable')) badgeClass = 'stable';
  else if (test.flakinessIndicator?.includes('Unstable')) badgeClass = 'unstable';
  else if (test.flakinessIndicator?.includes('Flaky')) badgeClass = 'flaky';
  else if (test.flakinessIndicator?.includes('Skipped')) badgeClass = 'skipped';

  // Determine trend class
  let trendClass = 'stable';
  if (isSlow) trendClass = 'slower';
  else if (isFaster) trendClass = 'faster';

  // Determine stability badge class
  let stabilityClass = 'stability-high';
  if (test.stabilityScore) {
    if (test.stabilityScore.overall >= 90) stabilityClass = 'stability-high';
    else if (test.stabilityScore.overall >= 70) stabilityClass = 'stability-medium';
    else stabilityClass = 'stability-low';
  }

  return `
    <div id="card-${cardId}" class="test-card"
         data-status="${test.status}"
         data-flaky="${isFlaky}"
         data-unstable="${isUnstable}"
         data-slow="${isSlow}"
         data-new="${isNew}"
         data-grade="${test.stabilityScore?.grade || ''}">
      <div class="test-card-header" ${hasDetails ? `onclick="toggleDetails('${cardId}')"` : ''}>
        <div class="test-card-left">
          <div class="status-indicator ${test.status === 'passed' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed'}"></div>
          <div class="test-info">
            <div class="test-title">${escapeHtml(test.title)}</div>
            <div class="test-file">${escapeHtml(test.file)}</div>
          </div>
        </div>
        <div class="test-card-right">
          <span class="test-duration">${formatDuration(test.duration)}</span>
          ${test.stabilityScore ? `<span class="badge ${stabilityClass}" title="Stability Score: ${test.stabilityScore.overall}/100 (Flakiness: ${test.stabilityScore.flakiness}, Performance: ${test.stabilityScore.performance}, Reliability: ${test.stabilityScore.reliability})">${test.stabilityScore.grade} (${test.stabilityScore.overall})</span>` : ''}
          ${test.flakinessIndicator ? `<span class="badge ${badgeClass}">${test.flakinessIndicator.replace(/[🟢🟡🔴⚪]\s*/g, '')}</span>` : ''}
          ${test.performanceTrend ? `<span class="trend ${trendClass}">${test.performanceTrend}</span>` : ''}
          ${hasDetails ? `<span class="expand-icon">▶</span>` : ''}
        </div>
      </div>
      ${hasDetails ? generateTestDetails(test, cardId, showTraceSection) : ''}
    </div>
  `;
}

/**
 * Generate test details section (history, steps, errors, AI suggestions)
 */
export function generateTestDetails(test: TestResultData, cardId: string, showTraceSection: boolean): string {
  let historyDetails = '';
  let bodyDetails = '';

  // History visualization - show sparkline and duration trend if we have history
  if (test.history && test.history.length > 0) {
    const currentPassed = test.status === 'passed';
    const currentSkipped = test.status === 'skipped';
    const maxDuration = Math.max(...test.history.map(h => h.duration), test.duration);
    const nonSkippedHistory = test.history.filter(h => !h.skipped);
    const avgDuration = nonSkippedHistory.length > 0
      ? nonSkippedHistory.reduce((sum, h) => sum + h.duration, 0) / nonSkippedHistory.length
      : 0;
    const passCount = nonSkippedHistory.filter(h => h.passed).length;
    const passRate = nonSkippedHistory.length > 0 ? Math.round((passCount / nonSkippedHistory.length) * 100) : 0;

    // Determine if current run is slower/faster than average
    const currentTrendClass = test.duration > avgDuration * 1.2 ? 'slower' : test.duration < avgDuration * 0.8 ? 'faster' : '';

	    historyDetails += `
	      <div class="detail-section">
	        <div class="detail-label"><span class="icon">📊</span> Run History (Last ${test.history.length} runs)</div>
	        <div class="history-section">
	          <div class="history-column">
	            <div class="history-label">Pass/Fail</div>
	            <div class="sparkline-block">
	              <div class="sparkline">
	                ${test.history.map((h, i) => {
	                  const timestampLabel = escapeHtml(formatHistoryTimestamp(h.timestamp));
	                  const statusLabel = h.skipped ? 'Skipped' : h.passed ? 'Passed' : 'Failed';
	                  const runIdAttr = h.runId ? ` data-runid="${escapeHtml(h.runId)}"` : '';
	                  return `<div class="spark-dot history-dot ${h.skipped ? 'skip' : h.passed ? 'pass' : 'fail'}"${runIdAttr} data-testid="${escapeHtml(test.testId)}" data-ts="${timestampLabel}" title="Run ${i + 1}: ${statusLabel} • ${timestampLabel}"></div>`;
	                }).join('')}
	                <div class="spark-dot ${currentSkipped ? 'skip' : currentPassed ? 'pass' : 'fail'} current" title="Current: ${currentSkipped ? 'Skipped' : currentPassed ? 'Passed' : 'Failed'}"></div>
	              </div>
	              <div class="history-stats passfail">
	                <span class="history-stat">Pass rate: <span>${passRate}%</span></span>
	                <button type="button" class="history-back-btn" data-action="history-back" style="display:none">Back to current</button>
	              </div>
	            </div>
	          </div>
	          <div class="history-column">
	            <div class="history-label">Duration Trend</div>
	            <div class="duration-chart">
	              ${test.history.map((h, i) => {
                const height = maxDuration > 0 ? Math.max(4, (h.duration / maxDuration) * 28).toFixed(1) : '4';
                const runIdAttr = h.runId ? ` data-runid="${escapeHtml(h.runId)}"` : '';
                return `<div class="duration-bar history-duration"${runIdAttr} style="height: ${height}px" title="Run ${i + 1}: ${formatDuration(h.duration)}"></div>`;
              }).join('')}
              <div class="duration-bar current ${currentTrendClass}" style="height: ${maxDuration > 0 ? Math.max(4, (test.duration / maxDuration) * 28).toFixed(1) : '4'}px" title="Current: ${formatDuration(test.duration)}"></div>
            </div>
            <div class="history-stats">
              <span class="history-stat">Avg: <span data-role="avg-duration">${formatDuration(avgDuration)}</span></span>
              <span class="history-stat">Current: <span data-role="current-duration">${formatDuration(test.duration)}</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Step timings - show first as it's most useful for performance analysis
  if (test.steps.length > 0) {
    const maxDuration = Math.max(...test.steps.map((s) => s.duration));
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">⏱</span> Step Timings</div>
        <div class="steps-container">
          ${test.steps
            .map(
              (step) => `
            <div class="step-row ${step.isSlowest ? 'slowest' : ''}">
              <span class="step-title" title="${escapeHtml(step.title)}">${escapeHtml(step.title)}</span>
              <div class="step-bar-container">
                <div class="step-bar" style="width: ${maxDuration > 0 ? ((step.duration / maxDuration) * 100).toFixed(1) : '0'}%"></div>
              </div>
              <span class="step-duration">${formatDuration(step.duration)}</span>
              ${step.isSlowest ? '<span class="slowest-badge">Slowest</span>' : ''}
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (test.error) {
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">⚠</span> Error</div>
        <div class="error-box">${escapeHtml(test.error)}</div>
      </div>
    `;
  }

  const tracePaths = test.attachments?.traces?.length
    ? test.attachments.traces
    : (test.tracePath ? [test.tracePath] : []);
  const showTraceViewer = showTraceSection && test.status !== 'passed' && tracePaths.length > 0;
  if (showTraceViewer) {
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📊</span> Trace</div>
        <div class="trace-list">
          ${tracePaths.map((trace, idx) => {
            const suffix = tracePaths.length > 1 ? ` #${idx + 1}` : '';
            const safeTrace = escapeHtml(trace);
            const fileName = escapeHtml(trace.split(/[\\\\/]/).pop() || trace);

            return `
              <div class="trace-row">
                <div class="trace-meta">
                  <div class="trace-file">
                    <span class="trace-file-icon">📦</span>
                    <span class="trace-file-name" title="${safeTrace}">${fileName}${suffix}</span>
                  </div>
                  <div class="trace-path" title="${safeTrace}">${safeTrace}</div>
                </div>
                <div class="trace-actions">
                  <a href="${safeTrace}" class="attachment-link" download>⬇ Download</a>
                  <a href="#" class="attachment-link" data-trace="${safeTrace}" onclick="return viewTraceFromEl(this)">🔍 View</a>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  if (test.screenshot) {
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📸</span> Screenshot</div>
        <div class="screenshot-box">
          <img src="${test.screenshot}" alt="Failure screenshot" onclick="window.open(this.src, '_blank')" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"/>
          <div class="screenshot-fallback" style="display:none;">
            <span>Image blocked by security policy</span>
            <a href="${test.screenshot}" download class="download-btn">Download Screenshot</a>
          </div>
        </div>
      </div>
    `;
  }

  if (test.videoPath) {
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📎</span> Attachments</div>
        <div class="attachments">
          <a href="file://${test.videoPath}" class="attachment-link" target="_blank">🎬 Video</a>
        </div>
      </div>
    `;
  }

  if (test.aiSuggestion) {
    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">🤖</span> AI Suggestion</div>
        <div class="ai-box ai-markdown">${renderMarkdownLite(test.aiSuggestion)}</div>
      </div>
    `;
  }

  if (test.averageDuration !== undefined) {
    bodyDetails += `
      <div class="duration-compare">
        Average: ${formatDuration(test.averageDuration)} → Current: ${formatDuration(test.duration)}
      </div>
    `;
  }

  return `<div class="test-details">${historyDetails}<div class="details-body" data-details-body>${bodyDetails}</div></div>`;
}

function formatHistoryTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}

/**
 * Attention sets for highlighting tests requiring attention
 */
export interface AttentionSets {
  newFailures: Set<string>;
  regressions: Set<string>;
  fixed: Set<string>;
}

/**
 * Generate grouped tests by file - uses list items for selection behavior
 */
export function generateGroupedTests(results: TestResultData[], showTraceSection: boolean, attention: AttentionSets = { newFailures: new Set(), regressions: new Set(), fixed: new Set() }): string {
  // Group tests by file
  const groups = new Map<string, TestResultData[]>();
  for (const test of results) {
    const file = test.file;
    if (!groups.has(file)) {
      groups.set(file, []);
    }
    groups.get(file)!.push(test);
  }

  return Array.from(groups.entries()).map(([file, tests]) => {
    const passed = tests.filter(t => t.status === 'passed').length;
    const failed = tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length;
    const groupId = sanitizeId(file);

    // Generate list items (not full cards) so clicking selects and shows in detail panel
    const testListItems = tests.map(test => {
      const cardId = sanitizeId(test.testId);
      const statusClass = test.status === 'passed' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed';
      const isFlaky = test.flakinessScore !== undefined && test.flakinessScore >= 0.3;
      const isSlow = test.performanceTrend?.startsWith('↑') || false;
      const isNew = test.flakinessIndicator?.includes('New') || false;
      
      // Attention states from comparison
      const isNewFailure = attention.newFailures.has(test.testId);
      const isRegression = attention.regressions.has(test.testId);
      const isFixed = attention.fixed.has(test.testId);
      
      // Determine stability badge
      let stabilityBadge = '';
      if (test.stabilityScore) {
        const grade = test.stabilityScore.grade;
        const score = test.stabilityScore.overall;
        const gradeClass = score >= 90 ? 'grade-a' : score >= 80 ? 'grade-b' : score >= 70 ? 'grade-c' : score >= 60 ? 'grade-d' : 'grade-f';
        stabilityBadge = `<span class="stability-badge ${gradeClass}">${grade}</span>`;
      }

      return `
        <div class="test-list-item ${statusClass}" 
             id="list-item-${cardId}"
             data-testid="${escapeHtml(test.testId)}"
             data-status="${test.status}"
             data-flaky="${isFlaky}"
             data-slow="${isSlow}"
             data-new="${isNew}"
             data-new-failure="${isNewFailure}"
             data-regression="${isRegression}"
             data-fixed="${isFixed}"
             data-file="${escapeHtml(test.file)}"
             data-grade="${test.stabilityScore?.grade || ''}"
             onclick="selectTest('${cardId}')">
          <div class="test-item-status">
            <div class="status-dot ${statusClass}"></div>
          </div>
          <div class="test-item-info">
            <div class="test-item-title">${escapeHtml(test.title)}</div>
          </div>
          <div class="test-item-meta">
            ${isNewFailure ? '<span class="test-item-badge new-failure">New Failure</span>' : ''}
            ${isRegression ? '<span class="test-item-badge regression">Regression</span>' : ''}
            ${isFixed ? '<span class="test-item-badge fixed">Fixed</span>' : ''}
            ${stabilityBadge}
            <span class="test-item-duration">${formatDuration(test.duration)}</span>
            ${isFlaky ? '<span class="test-item-badge flaky">Flaky</span>' : ''}
            ${isSlow ? '<span class="test-item-badge slow">Slow</span>' : ''}
            ${isNew ? '<span class="test-item-badge new">New</span>' : ''}
          </div>
        </div>
      `;
    }).join('\n');

    return `
    <div id="group-${groupId}" class="file-group">
      <div class="file-group-header" onclick="toggleGroup('${groupId}')">
        <span class="expand-icon">▼</span>
        <span class="file-group-name">📄 ${escapeHtml(file)}</span>
        <div class="file-group-stats">
          ${passed > 0 ? `<span class="file-group-stat passed">${passed} passed</span>` : ''}
          ${failed > 0 ? `<span class="file-group-stat failed">${failed} failed</span>` : ''}
        </div>
      </div>
      <div class="file-group-content">
        ${testListItems}
      </div>
    </div>
  `;
  }).join('\n');
}
