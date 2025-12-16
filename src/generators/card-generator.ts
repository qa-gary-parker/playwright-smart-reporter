/**
 * Card Generator - Handles test card and test detail generation
 */

import type { TestResultData } from '../types';
import { formatDuration, escapeHtml, sanitizeId, renderMarkdownLite } from '../utils';

/**
 * Generate a single test card
 */
export function generateTestCard(test: TestResultData): string {
  const isFlaky = test.flakinessScore !== undefined && test.flakinessScore >= 0.3;
  const isUnstable = test.flakinessScore !== undefined && test.flakinessScore >= 0.1 && test.flakinessScore < 0.3;
  const isSlow = test.performanceTrend?.startsWith('↑') || false;
  const isFaster = test.performanceTrend?.startsWith('↓') || false;
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
         data-slow="${isSlow}"
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
      ${hasDetails ? generateTestDetails(test, cardId) : ''}
    </div>
  `;
}

/**
 * Generate test details section (history, steps, errors, AI suggestions)
 */
export function generateTestDetails(test: TestResultData, cardId: string): string {
  let details = '';

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

    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📊</span> Run History (Last ${test.history.length} runs)</div>
        <div class="history-section">
          <div class="history-column">
            <div class="history-label">Pass/Fail</div>
            <div class="sparkline">
              ${test.history.map((h, i) => `<div class="spark-dot ${h.skipped ? 'skip' : h.passed ? 'pass' : 'fail'}" title="Run ${i + 1}: ${h.skipped ? 'Skipped' : h.passed ? 'Passed' : 'Failed'}"></div>`).join('')}
              <div class="spark-dot ${currentSkipped ? 'skip' : currentPassed ? 'pass' : 'fail'} current" title="Current: ${currentSkipped ? 'Skipped' : currentPassed ? 'Passed' : 'Failed'}"></div>
            </div>
            <div class="history-stats">
              <span class="history-stat">Pass rate: <span>${passRate}%</span></span>
            </div>
          </div>
          <div class="history-column">
            <div class="history-label">Duration Trend</div>
            <div class="duration-chart">
              ${test.history.map((h, i) => {
                const height = maxDuration > 0 ? Math.max(4, (h.duration / maxDuration) * 28) : 4;
                return `<div class="duration-bar" style="height: ${height}px" title="Run ${i + 1}: ${formatDuration(h.duration)}"></div>`;
              }).join('')}
              <div class="duration-bar current ${currentTrendClass}" style="height: ${maxDuration > 0 ? Math.max(4, (test.duration / maxDuration) * 28) : 4}px" title="Current: ${formatDuration(test.duration)}"></div>
            </div>
            <div class="history-stats">
              <span class="history-stat">Avg: <span>${formatDuration(avgDuration)}</span></span>
              <span class="history-stat">Current: <span>${formatDuration(test.duration)}</span></span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // Step timings - show first as it's most useful for performance analysis
  if (test.steps.length > 0) {
    const maxDuration = Math.max(...test.steps.map((s) => s.duration));
    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">⏱</span> Step Timings</div>
        <div class="steps-container">
          ${test.steps
            .map(
              (step) => `
            <div class="step-row ${step.isSlowest ? 'slowest' : ''}">
              <span class="step-title" title="${escapeHtml(step.title)}">${escapeHtml(step.title)}</span>
              <div class="step-bar-container">
                <div class="step-bar" style="width: ${maxDuration > 0 ? (step.duration / maxDuration) * 100 : 0}%"></div>
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
    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">⚠</span> Error</div>
        <div class="error-box">${escapeHtml(test.error)}</div>
      </div>
    `;
  }

  if (test.screenshot) {
    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📸</span> Screenshot</div>
        <div class="screenshot-box">
          <img src="${test.screenshot}" alt="Failure screenshot" onclick="window.open(this.src, '_blank')"/>
        </div>
      </div>
    `;
  }

  if (test.videoPath) {
    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">📎</span> Attachments</div>
        <div class="attachments">
          <a href="file://${test.videoPath}" class="attachment-link" target="_blank">🎬 Video</a>
        </div>
      </div>
    `;
  }

  if (test.aiSuggestion) {
    details += `
      <div class="detail-section">
        <div class="detail-label"><span class="icon">🤖</span> AI Suggestion</div>
        <div class="ai-box ai-markdown">${renderMarkdownLite(test.aiSuggestion)}</div>
      </div>
    `;
  }

  if (test.averageDuration !== undefined) {
    details += `
      <div class="duration-compare">
        Average: ${formatDuration(test.averageDuration)} → Current: ${formatDuration(test.duration)}
      </div>
    `;
  }

  return `<div class="test-details">${details}</div>`;
}

/**
 * Generate grouped tests by file
 */
export function generateGroupedTests(results: TestResultData[]): string {
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
        ${tests.map(test => generateTestCard(test)).join('\n')}
      </div>
    </div>
  `;
  }).join('\n');
}
