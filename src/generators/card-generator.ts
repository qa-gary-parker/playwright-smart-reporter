/**
 * Card Generator - Handles test card and test detail generation
 */

import type { TestResultData, NetworkLogData, NetworkLogEntry } from '../types';
import { formatDuration, escapeHtml, sanitizeId, renderMarkdownLite } from '../utils';

/**
 * Get appropriate icon for attachment content type
 */
function getAttachmentIcon(contentType: string): string {
  if (contentType.startsWith('image/')) return '🖼️';
  if (contentType.startsWith('video/')) return '🎬';
  if (contentType.startsWith('audio/')) return '🔊';
  if (contentType.startsWith('text/')) return '📄';
  if (contentType.includes('json')) return '📋';
  if (contentType.includes('pdf')) return '📑';
  if (contentType.includes('zip') || contentType.includes('tar') || contentType.includes('gzip')) return '📦';
  return '📎';
}

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

  // Prepare tags and suite data attributes
  const tagsAttr = test.tags && test.tags.length > 0 ? ` data-tags="${test.tags.map(t => escapeHtml(t)).join(',')}"` : '';
  const suiteAttr = test.suite ? ` data-suite="${escapeHtml(test.suite)}"` : '';
  const suitesAttr = test.suites && test.suites.length > 0 ? ` data-suites="${test.suites.map(s => escapeHtml(s)).join(',')}"` : '';

  // Generate tags display
  const tagsHtml = test.tags && test.tags.length > 0
    ? `<div class="test-tags">${test.tags.map(t => `<span class="test-tag">${escapeHtml(t)}</span>`).join('')}</div>`
    : '';

  // Generate suite badge display
  const suiteHtml = test.suite
    ? `<span class="test-suite-badge" title="Suite: ${test.suites?.map(s => escapeHtml(s)).join(' > ') || escapeHtml(test.suite)}">${escapeHtml(test.suite)}</span>`
    : '';

  return `
    <div id="card-${cardId}" class="test-card"
         data-status="${test.status}"
         data-flaky="${isFlaky}"
         data-unstable="${isUnstable}"
         data-slow="${isSlow}"
         data-new="${isNew}"
         data-grade="${test.stabilityScore?.grade || ''}"${tagsAttr}${suiteAttr}${suitesAttr}>
      <div class="test-card-header" ${hasDetails ? `onclick="toggleDetails('${cardId}', event)"` : ''}>
        <div class="test-card-left">
          <div class="status-indicator ${test.status === 'passed' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed'}"></div>
          <div class="test-info">
            <div class="test-title-row">
              <span class="test-title">${escapeHtml(test.title)}</span>
              ${suiteHtml}
            </div>
            <div class="test-meta-row">
              <span class="test-file">${escapeHtml(test.file)}</span>
              ${tagsHtml}
            </div>
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

  // Network logs section (extracted from trace files)
  if (test.networkLogs && test.networkLogs.entries.length > 0) {
    bodyDetails += generateNetworkLogsSection(test.networkLogs, cardId);
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

  // Issue #15: Display custom attachments
  if (test.attachments?.custom && test.attachments.custom.length > 0) {
    const customAttachmentsList = test.attachments.custom.map(att => {
      const icon = getAttachmentIcon(att.contentType);
      if (att.path) {
        return `<a href="file://${escapeHtml(att.path)}" class="attachment-link" target="_blank">${icon} ${escapeHtml(att.name)}</a>`;
      } else if (att.body) {
        // Inline content - create a download link
        const dataUri = `data:${att.contentType};base64,${att.body}`;
        return `<a href="${dataUri}" class="attachment-link" download="${escapeHtml(att.name)}">${icon} ${escapeHtml(att.name)}</a>`;
      }
      return `<span class="attachment-name">${icon} ${escapeHtml(att.name)}</span>`;
    }).join('');

    bodyDetails += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📎</span> Custom Attachments</div>
        <div class="attachments">
          ${customAttachmentsList}
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

/**
 * Generate network logs section for test details
 */
function generateNetworkLogsSection(networkLogs: NetworkLogData, cardId: string): string {
  const { entries, summary } = networkLogs;

  // Summary stats
  const totalRequests = entries.length;
  const errorCount = summary.errors.length;
  const slowestEntry = summary.slowest;

  // Status breakdown
  const statusBreakdown = Object.entries(summary.byStatus)
    .map(([status, count]) => {
      const statusClass = parseInt(status) >= 400 ? 'error' : parseInt(status) >= 300 ? 'redirect' : 'success';
      return `<span class="network-status-badge ${statusClass}">${status}xx: ${count}</span>`;
    })
    .join('');

  // Generate entries HTML
  const entriesHtml = entries.map((entry, idx) => {
    const statusClass = entry.status >= 400 ? 'error' : entry.status >= 300 ? 'redirect' : 'success';
    const isSlowRequest = entry.duration > 1000;
    const entryId = `${cardId}-network-${idx}`;

    // Format URL for display (truncate if too long)
    const displayUrl = entry.urlPath.length > 60
      ? entry.urlPath.substring(0, 57) + '...'
      : entry.urlPath;

    // Timing waterfall bars
    let timingBars = '';
    if (entry.timings) {
      const totalTime = entry.duration || 1;
      const timingParts = [
        { name: 'DNS', value: entry.timings.dns, color: '#6366f1' },
        { name: 'Connect', value: entry.timings.connect, color: '#f59e0b' },
        { name: 'SSL', value: entry.timings.ssl, color: '#8b5cf6' },
        { name: 'Wait', value: entry.timings.wait, color: '#10b981' },
        { name: 'Receive', value: entry.timings.receive, color: '#3b82f6' },
      ].filter(t => t.value > 0);

      if (timingParts.length > 0) {
        timingBars = `
          <div class="network-timing-bar">
            ${timingParts.map(t => {
              const width = Math.max(2, (t.value / totalTime) * 100);
              return `<div class="timing-segment" style="width: ${width.toFixed(1)}%; background: ${t.color};" title="${t.name}: ${t.value}ms"></div>`;
            }).join('')}
          </div>
        `;
      }
    }

    // Request body preview (if JSON)
    let requestBodyHtml = '';
    if (entry.requestBody) {
      const bodyStr = typeof entry.requestBody === 'string'
        ? entry.requestBody
        : JSON.stringify(entry.requestBody, null, 2);
      const truncated = bodyStr.length > 500 ? bodyStr.substring(0, 500) + '...' : bodyStr;
      requestBodyHtml = `
        <div class="network-body request-body">
          <div class="network-body-label">Request Body:</div>
          <pre class="network-body-content">${escapeHtml(truncated)}</pre>
        </div>
      `;
    }

    return `
      <div class="network-entry ${statusClass}" data-entry-id="${entryId}">
        <div class="network-entry-header" onclick="toggleNetworkEntry('${entryId}')">
          <span class="network-method ${entry.method.toLowerCase()}">${entry.method}</span>
          <span class="network-url" title="${escapeHtml(entry.url)}">${escapeHtml(displayUrl)}</span>
          <span class="network-status ${statusClass}">${entry.status}</span>
          <span class="network-duration ${isSlowRequest ? 'slow' : ''}">${entry.duration}ms</span>
          <span class="network-size">${formatBytes(entry.responseSize)}</span>
          <span class="network-expand-icon">▶</span>
        </div>
        <div class="network-entry-details" id="${entryId}-details" style="display: none;">
          ${timingBars}
          <div class="network-meta">
            <div class="network-meta-item">
              <span class="meta-label">Content-Type:</span>
              <span class="meta-value">${escapeHtml(entry.contentType || 'unknown')}</span>
            </div>
            <div class="network-meta-item">
              <span class="meta-label">Request Size:</span>
              <span class="meta-value">${formatBytes(entry.requestSize)}</span>
            </div>
            <div class="network-meta-item">
              <span class="meta-label">Response Size:</span>
              <span class="meta-value">${formatBytes(entry.responseSize)}</span>
            </div>
          </div>
          ${requestBodyHtml}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="detail-section network-logs-section">
      <div class="detail-label">
        <span class="icon">🌐</span> Network Logs
        <span class="network-summary">
          ${totalRequests} requests
          ${errorCount > 0 ? `<span class="network-error-count">${errorCount} errors</span>` : ''}
          ${slowestEntry ? `<span class="network-slowest">slowest: ${slowestEntry.duration}ms</span>` : ''}
        </span>
      </div>
      <div class="network-status-summary">
        ${statusBreakdown}
      </div>
      <div class="network-entries">
        ${entriesHtml}
      </div>
    </div>
  `;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
