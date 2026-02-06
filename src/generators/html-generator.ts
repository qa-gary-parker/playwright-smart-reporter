/**
 * HTML Generator - Main orchestrator for HTML report generation
 * Coordinates all other generators and generates the complete HTML document
 * 
 * REDESIGNED: Modern app-shell layout with sidebar, top bar, and master-detail view
 */

import type { TestResultData, TestHistory, RunComparison, RunSnapshotFile, SmartReporterOptions, FailureCluster, CIInfo } from '../types';
import { formatDuration, escapeHtml, sanitizeId } from '../utils';
import { generateTrendChart } from './chart-generator';
import { generateGroupedTests, generateTestCard, AttentionSets } from './card-generator';
import { generateGallery, generateGalleryScript } from './gallery-generator';
import { generateComparison, generateComparisonScript } from './comparison-generator';
// Issue #13: Inline trace viewer integration
import { generateJSZipScript, generateTraceViewerHtml, generateTraceViewerStyles, generateTraceViewerScript } from './trace-viewer-generator';

export interface HtmlGeneratorData {
  results: TestResultData[];
  history: TestHistory;
  startTime: number;
  options: SmartReporterOptions;
  comparison?: RunComparison;
  historyRunSnapshots?: Record<string, RunSnapshotFile>;
  failureClusters?: FailureCluster[];
  ciInfo?: CIInfo;
}

/**
 * Generate file tree structure for sidebar
 */
function generateFileTree(results: TestResultData[]): string {
  const fileGroups = new Map<string, { passed: number; failed: number; total: number }>();
  
  for (const test of results) {
    const file = test.file;
    if (!fileGroups.has(file)) {
      fileGroups.set(file, { passed: 0, failed: 0, total: 0 });
    }
    const group = fileGroups.get(file)!;
    group.total++;
    if (test.status === 'passed') group.passed++;
    else if (test.status === 'failed' || test.status === 'timedOut') group.failed++;
  }

  return Array.from(fileGroups.entries()).map(([file, stats]) => {
    const statusClass = stats.failed > 0 ? 'has-failures' : 'all-passed';
    const fileName = file.split(/[\\/]/).pop() || file;
    return `
      <div class="file-tree-item ${statusClass}" data-file="${escapeHtml(file)}" onclick="filterByFile('${escapeHtml(file)}')">
        <span class="file-tree-icon">📄</span>
        <span class="file-tree-name" title="${escapeHtml(file)}">${escapeHtml(fileName)}</span>
        <span class="file-tree-stats">
          ${stats.passed > 0 ? `<span class="file-stat passed">${stats.passed}</span>` : ''}
          ${stats.failed > 0 ? `<span class="file-stat failed">${stats.failed}</span>` : ''}
        </span>
      </div>
    `;
  }).join('');
}

/**
 * Generate test list items for the main panel
 */
function generateTestListItems(results: TestResultData[], showTraceSection: boolean, attention: AttentionSets = { newFailures: new Set(), regressions: new Set(), fixed: new Set() }): string {
  return results.map(test => {
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

    const statusLabel = test.status === 'passed' ? 'Passed' : test.status === 'skipped' ? 'Skipped' : 'Failed';
    return `
      <div class="test-list-item ${statusClass}"
           id="list-item-${cardId}"
           role="listitem"
           aria-label="${escapeHtml(test.title)} - ${statusLabel}"
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
           data-tags="${test.tags?.join(',') || ''}"
           data-suite="${test.suite || ''}"
           data-suites="${test.suites?.join(',') || ''}"
           onclick="selectTest('${cardId}')"
           tabindex="0"
           onkeydown="if(event.key==='Enter')selectTest('${cardId}')">
        <div class="test-item-status" aria-hidden="true">
          <div class="status-dot ${statusClass}"></div>
        </div>
        <div class="test-item-info">
          <div class="test-item-title">${escapeHtml(test.title)}</div>
          <div class="test-item-file">${escapeHtml(test.file)}</div>
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
  }).join('');
}

/**
 * Generate the Overview content with executive summary
 */
function generateOverviewContent(
  results: TestResultData[],
  comparison: RunComparison | undefined,
  failureClusters: FailureCluster[] | undefined,
  passed: number,
  failed: number,
  skipped: number,
  flaky: number,
  slow: number,
  newTests: number,
  total: number,
  passRate: number,
  totalDuration: number,
  history: TestHistory
): string {
  // Calculate deltas from comparison
  const prevPassed = comparison?.baselineRun.passed ?? passed;
  const prevFailed = comparison?.baselineRun.failed ?? failed;
  const prevPassRate = comparison?.baselineRun.total ? Math.round((comparison.baselineRun.passed / comparison.baselineRun.total) * 100) : passRate;
  const prevDuration = comparison?.baselineRun.duration ?? totalDuration;
  
  const passRateDelta = passRate - prevPassRate;
  const durationDelta = totalDuration - prevDuration;
  const durationDeltaPercent = prevDuration > 0 ? Math.round((durationDelta / prevDuration) * 100) : 0;

  // New failures and fixed tests from comparison
  const newFailures = comparison?.changes.newFailures ?? [];
  const fixedTests = comparison?.changes.fixedTests ?? [];
  const regressions = comparison?.changes.regressions ?? [];

  // Calculate suite health score (0-100)
  const passRateScore = passRate;
  const flakinessScore = total > 0 ? Math.max(0, 100 - (flaky / total) * 200) : 100;
  const performanceScore = total > 0 ? Math.max(0, 100 - (slow / total) * 200) : 100;
  const suiteHealthScore = Math.round((passRateScore * 0.5) + (flakinessScore * 0.3) + (performanceScore * 0.2));
  const healthGrade = suiteHealthScore >= 90 ? 'A' : suiteHealthScore >= 80 ? 'B' : suiteHealthScore >= 70 ? 'C' : suiteHealthScore >= 60 ? 'D' : 'F';
  const healthClass = suiteHealthScore >= 90 ? 'excellent' : suiteHealthScore >= 70 ? 'good' : suiteHealthScore >= 50 ? 'fair' : 'poor';

  // Find slowest test and most flaky test
  const slowestTest = [...results].sort((a, b) => b.duration - a.duration)[0];
  const mostFlakyTest = [...results].filter(r => r.flakinessScore !== undefined).sort((a, b) => (b.flakinessScore ?? 0) - (a.flakinessScore ?? 0))[0];

  // Pass rate sparkline from history
  const passRateHistory = (history.summaries ?? []).slice(-10).map(s => {
    const rate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
    return { rate, passed: s.passed, failed: s.failed };
  });

  // Generate failure clusters section
  const clustersHtml = (failureClusters && failureClusters.length > 0) ? `
    <div class="overview-section">
      <div class="section-header">
        <span class="section-icon">🔍</span>
        <span class="section-title">Failure Clusters</span>
      </div>
      <div class="failure-clusters-grid">
        ${failureClusters.slice(0, 5).map(cluster => {
          const firstError = cluster.tests[0]?.error || '';
          const errorPreview = firstError.split('\n')[0].slice(0, 100) + (firstError.length > 100 ? '...' : '');
          const affectedFiles = [...new Set(cluster.tests.map(t => t.file))];
          return `
          <div class="cluster-card" onclick="filterTests('failed'); switchView('tests');">
            <div class="cluster-header">
              <div class="cluster-icon">⚠️</div>
              <div class="cluster-type">${escapeHtml(cluster.errorType)}</div>
              <div class="cluster-count">${cluster.count} test${cluster.count > 1 ? 's' : ''}</div>
            </div>
            ${errorPreview ? `<div class="cluster-error">${escapeHtml(errorPreview)}</div>` : ''}
            <div class="cluster-tests">
              ${cluster.tests.slice(0, 3).map(t => `<span class="cluster-test-name">${escapeHtml(t.title)}</span>`).join('')}
              ${cluster.tests.length > 3 ? `<span class="cluster-more">+${cluster.tests.length - 3} more</span>` : ''}
            </div>
            <div class="cluster-files">
              ${affectedFiles.slice(0, 2).map(f => `<span class="cluster-file">${escapeHtml(f)}</span>`).join('')}
              ${affectedFiles.length > 2 ? `<span class="cluster-more">+${affectedFiles.length - 2} files</span>` : ''}
            </div>
          </div>
        `}).join('')}
      </div>
    </div>
  ` : '';

  // Generate attention required section
  const hasAttentionItems = newFailures.length > 0 || fixedTests.length > 0 || regressions.length > 0 || flaky > 0;
  const attentionHtml = hasAttentionItems ? `
    <div class="overview-section attention-section">
      <div class="section-header">
        <span class="section-icon">⚡</span>
        <span class="section-title">Attention Required</span>
      </div>
      <div class="attention-grid">
        ${newFailures.length > 0 ? `
          <div class="attention-card critical" onclick="filterTests('new-failure'); switchView('tests');">
            <div class="attention-value">${newFailures.length}</div>
            <div class="attention-label">New Failures</div>
            <div class="attention-desc">Tests that were passing, now failing</div>
          </div>
        ` : ''}
        ${regressions.length > 0 ? `
          <div class="attention-card warning" onclick="filterTests('regression'); switchView('tests');">
            <div class="attention-value">${regressions.length}</div>
            <div class="attention-label">Performance Regressions</div>
            <div class="attention-desc">Tests that got slower</div>
          </div>
        ` : ''}
        ${flaky > 0 ? `
          <div class="attention-card warning" onclick="filterTests('flaky'); switchView('tests');">
            <div class="attention-value">${flaky}</div>
            <div class="attention-label">Flaky Tests</div>
            <div class="attention-desc">Tests with unstable results</div>
          </div>
        ` : ''}
        ${fixedTests.length > 0 ? `
          <div class="attention-card success" onclick="filterTests('fixed'); switchView('tests');">
            <div class="attention-value">${fixedTests.length}</div>
            <div class="attention-label">Fixed Tests</div>
            <div class="attention-desc">Tests that were failing, now passing</div>
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  return `
    <!-- Hero Stats Row -->
    <div class="hero-stats">
      <div class="hero-stat-card health ${healthClass}">
        <div class="health-gauge">
          <svg class="health-ring" viewBox="0 0 100 100">
            <circle class="health-ring-bg" cx="50" cy="50" r="42" />
            <circle class="health-ring-fill" cx="50" cy="50" r="42" 
                    stroke-dasharray="${suiteHealthScore * 2.64} 264"
                    stroke-dashoffset="0" />
          </svg>
          <div class="health-score">
            <span class="health-grade">${healthGrade}</span>
            <span class="health-value">${suiteHealthScore}</span>
          </div>
        </div>
        <div class="hero-stat-info">
          <div class="hero-stat-label">Suite Health</div>
          <div class="health-breakdown">
            <span>Pass: ${passRate}%</span>
            <span>Stability: ${Math.round(flakinessScore)}%</span>
            <span>Perf: ${Math.round(performanceScore)}%</span>
          </div>
        </div>
      </div>

      <div class="hero-stat-card">
        <div class="hero-stat-main">
          <div class="hero-stat-value">${passRate}%</div>
          ${passRateDelta !== 0 ? `<div class="hero-stat-delta ${passRateDelta > 0 ? 'positive' : 'negative'}">${passRateDelta > 0 ? '↑' : '↓'}${Math.abs(passRateDelta)}%</div>` : ''}
        </div>
        <div class="hero-stat-label">Pass Rate</div>
        <div class="hero-stat-detail">${passed}/${total} tests</div>
      </div>

      <div class="hero-stat-card">
        <div class="hero-stat-main">
          <div class="hero-stat-value">${formatDuration(totalDuration)}</div>
          ${durationDeltaPercent !== 0 ? `<div class="hero-stat-delta ${durationDeltaPercent < 0 ? 'positive' : 'negative'}">${durationDeltaPercent < 0 ? '↓' : '↑'}${Math.abs(durationDeltaPercent)}%</div>` : ''}
        </div>
        <div class="hero-stat-label">Duration</div>
        <div class="hero-stat-detail">Total run time</div>
      </div>

      <div class="hero-stat-card mini-comparison">
        <div class="mini-bars">
          <div class="mini-bar-row clickable" onclick="filterByStatus('passed')" title="View passed tests" role="button" tabindex="0">
            <span class="mini-bar-label">Passed</span>
            <div class="mini-bar-track">
              <div class="mini-bar passed" style="width: ${((passed / Math.max(total, 1)) * 100).toFixed(1)}%"></div>
            </div>
            <span class="mini-bar-value">${passed}</span>
          </div>
          <div class="mini-bar-row clickable" onclick="filterByStatus('failed')" title="View failed tests" role="button" tabindex="0">
            <span class="mini-bar-label">Failed</span>
            <div class="mini-bar-track">
              <div class="mini-bar failed" style="width: ${((failed / Math.max(total, 1)) * 100).toFixed(1)}%"></div>
            </div>
            <span class="mini-bar-value">${failed}</span>
          </div>
          <div class="mini-bar-row clickable" onclick="filterByStatus('skipped')" title="View skipped tests" role="button" tabindex="0">
            <span class="mini-bar-label">Skipped</span>
            <div class="mini-bar-track">
              <div class="mini-bar skipped" style="width: ${((skipped / Math.max(total, 1)) * 100).toFixed(1)}%"></div>
            </div>
            <span class="mini-bar-value">${skipped}</span>
          </div>
        </div>
      </div>
    </div>

    ${attentionHtml}

    ${clustersHtml}

    <!-- Quick Insights -->
    <div class="overview-section">
      <div class="section-header">
        <span class="section-icon">💡</span>
        <span class="section-title">Quick Insights</span>
      </div>
      <div class="insights-grid">
        ${slowestTest ? `
          <div class="insight-card" onclick="selectTest('${sanitizeId(slowestTest.testId)}'); switchView('tests');">
            <div class="insight-icon">🐢</div>
            <div class="insight-content">
              <div class="insight-label">Slowest Test</div>
              <div class="insight-title">${escapeHtml(slowestTest.title)}</div>
              <div class="insight-value">${formatDuration(slowestTest.duration)}</div>
            </div>
          </div>
        ` : ''}
        ${mostFlakyTest && mostFlakyTest.flakinessScore && mostFlakyTest.flakinessScore > 0 ? `
          <div class="insight-card" onclick="selectTest('${sanitizeId(mostFlakyTest.testId)}'); switchView('tests');">
            <div class="insight-icon">⚡</div>
            <div class="insight-content">
              <div class="insight-label">Most Flaky Test</div>
              <div class="insight-title">${escapeHtml(mostFlakyTest.title)}</div>
              <div class="insight-value">${Math.round(mostFlakyTest.flakinessScore * 100)}% failure rate</div>
            </div>
          </div>
        ` : ''}
        <div class="insight-card clickable" onclick="switchView('tests')" title="View all tests">
          <div class="insight-icon">📊</div>
          <div class="insight-content">
            <div class="insight-label">Test Distribution</div>
            <div class="insight-mini-stats">
              <span class="mini-stat"><span class="dot passed"></span>${passed} passed</span>
              <span class="mini-stat"><span class="dot failed"></span>${failed} failed</span>
              <span class="mini-stat"><span class="dot skipped"></span>${skipped} skipped</span>
            </div>
          </div>
        </div>
        <div class="insight-card clickable" onclick="switchView('trends')" title="View trends">
          <div class="insight-icon">📈</div>
          <div class="insight-content">
            <div class="insight-label">Pass Rate Trend</div>
            <div class="mini-sparkline">
              ${passRateHistory.length > 0 ? passRateHistory.map((h, i) => `
                <div class="spark-col" title="Run ${i + 1}: ${h.rate}%">
                  <div class="spark-bar" style="height: ${h.rate}%"></div>
                </div>
              `).join('') : '<span class="no-data">No history available</span>'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Generate complete HTML report with new app-shell layout
 */
export function generateHtml(data: HtmlGeneratorData): string {
  const { results, history, startTime, options, comparison, historyRunSnapshots, failureClusters, ciInfo } = data;

  const totalDuration = Date.now() - startTime;

  // Issue #17 & #16: Use outcome-based counting for accurate stats
  // - Flaky tests (outcome='flaky') passed on retry - count as passed AND flaky
  // - Expected failures (outcome='expected', expectedStatus='failed') - count as passed
  // - Unexpected failures (outcome='unexpected') - count as failed
  const passed = results.filter((r) =>
    r.status === 'passed' ||
    r.outcome === 'expected' ||  // Expected failures behaved as expected
    r.outcome === 'flaky'        // Flaky tests passed on retry
  ).length;
  const failed = results.filter((r) =>
    r.outcome === 'unexpected' &&
    (r.status === 'failed' || r.status === 'timedOut')
  ).length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  // Flaky: tests that passed on retry (outcome='flaky')
  // This is more accurate than flakinessScore which is history-based
  const flaky = results.filter((r) => r.outcome === 'flaky').length;
  const slow = results.filter((r) =>
    r.performanceTrend?.startsWith('↑')
  ).length;
  const newTests = results.filter((r) =>
    r.flakinessIndicator?.includes('New')
  ).length;
  const total = results.length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  // Calculate stability grade counts
  const gradeA = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'A').length;
  const gradeB = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'B').length;
  const gradeC = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'C').length;
  const gradeD = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'D').length;
  const gradeF = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'F').length;

  // Build attention sets from comparison data
  const attentionSets: AttentionSets = {
    newFailures: new Set(comparison?.changes.newFailures.map(t => t.testId) ?? []),
    regressions: new Set(comparison?.changes.regressions.map(t => t.testId) ?? []),
    fixed: new Set(comparison?.changes.fixedTests.map(t => t.testId) ?? [])
  };
  const newFailuresCount = attentionSets.newFailures.size;
  const regressionsCount = attentionSets.regressions.size;
  const fixedCount = attentionSets.fixed.size;
  const hasAttention = newFailuresCount > 0 || regressionsCount > 0 || fixedCount > 0;

  // Extract unique tags and suites from all tests
  const allTags = new Map<string, number>(); // tag -> count
  const allSuites = new Map<string, number>(); // suite -> count
  for (const r of results) {
    if (r.tags) {
      for (const tag of r.tags) {
        allTags.set(tag, (allTags.get(tag) || 0) + 1);
      }
    }
    if (r.suite) {
      allSuites.set(r.suite, (allSuites.get(r.suite) || 0) + 1);
    }
  }
  // Sort tags and suites by count (descending)
  const sortedTags = [...allTags.entries()].sort((a, b) => b[1] - a[1]);
  const sortedSuites = [...allSuites.entries()].sort((a, b) => b[1] - a[1]);

  // Sort results: attention items first (new failures, regressions, fixed), then rest
  const sortedResults = [...results].sort((a, b) => {
    const aIsAttention = attentionSets.newFailures.has(a.testId) || attentionSets.regressions.has(a.testId) || attentionSets.fixed.has(a.testId);
    const bIsAttention = attentionSets.newFailures.has(b.testId) || attentionSets.regressions.has(b.testId) || attentionSets.fixed.has(b.testId);
    
    if (aIsAttention && !bIsAttention) return -1;
    if (!aIsAttention && bIsAttention) return 1;
    
    // Within attention items, prioritize: new failures > regressions > fixed
    if (aIsAttention && bIsAttention) {
      const aPriority = attentionSets.newFailures.has(a.testId) ? 0 : attentionSets.regressions.has(a.testId) ? 1 : 2;
      const bPriority = attentionSets.newFailures.has(b.testId) ? 0 : attentionSets.regressions.has(b.testId) ? 1 : 2;
      return aPriority - bPriority;
    }
    
    return 0;
  });

  // Issue #19: Strip large binary data from embedded JSON to prevent RangeError with large test suites
  // The HTML already renders screenshots/traces in cards and gallery, so JavaScript doesn't need them
  const lightenedResults = results.map(test => {
    // Destructure to exclude large fields
    const { screenshot, traceData, networkLogs, attachments, ...rest } = test;
    // Keep attachment metadata but remove base64 screenshot data
    const lightenedAttachments = attachments ? {
      screenshots: attachments.screenshots?.map(s => s.startsWith('data:') ? '[base64-screenshot]' : s) || [],
      videos: attachments.videos || [],
      traces: attachments.traces || [],
      custom: attachments.custom?.map(c => ({
        ...c,
        body: c.body ? '[base64-content]' : undefined,
      })) || [],
    } : undefined;
    return {
      ...rest,
      // Keep file paths but not base64 data
      screenshot: screenshot?.startsWith('data:') ? '[base64-screenshot]' : screenshot,
      tracePath: test.tracePath, // Keep path for trace viewer links
      attachments: lightenedAttachments,
    };
  });

  // Escape JSON for safe embedding in HTML <script> tags
  const testsJson = JSON.stringify(lightenedResults)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  // Feature flags
  const showGallery = options.enableGalleryView !== false;
  const showComparison = (options.enableComparison !== false && !!comparison);
  const cspSafe = options.cspSafe === true;
  const enableTraceViewer = options.enableTraceViewer !== false;
  const showTraceSection = enableTraceViewer;
  const enableHistoryDrilldown = options.enableHistoryDrilldown === true;
  // Issue #19: Also lighten history snapshots to prevent RangeError
  const lightenedHistorySnapshots = enableHistoryDrilldown && historyRunSnapshots
    ? Object.fromEntries(
        Object.entries(historyRunSnapshots).map(([runId, snapshot]) => [
          runId,
          {
            ...snapshot,
            tests: Object.fromEntries(
              Object.entries(snapshot.tests || {}).map(([testId, testSnap]) => [
                testId,
                {
                  ...testSnap,
                  attachments: testSnap.attachments ? {
                    screenshots: testSnap.attachments.screenshots?.map(s => s.startsWith('data:') ? '[base64-screenshot]' : s) || [],
                    videos: testSnap.attachments.videos || [],
                    traces: testSnap.attachments.traces || [],
                    custom: testSnap.attachments.custom?.map(c => ({
                      ...c,
                      body: c.body ? '[base64-content]' : undefined,
                    })) || [],
                  } : undefined,
                },
              ])
            ),
          },
        ])
      )
    : {};
  const historyRunSnapshotsJson = enableHistoryDrilldown
    ? JSON.stringify(lightenedHistorySnapshots)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
    : '{}';

  // Google Fonts links (only included when not in CSP-safe mode)
  const fontLinks = cspSafe ? '' : `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">`;

  // Stats data for JavaScript
  const statsData = JSON.stringify({ passed, failed, skipped, flaky, slow, newTests, total, passRate, gradeA, gradeB, gradeC, gradeD, gradeF, totalDuration });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Test Report</title>${fontLinks}
  <style>
${generateStyles(passRate, cspSafe)}
  </style>
</head>
<body>
  <!-- Skip to main content for accessibility -->
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <!-- App Shell -->
  <div class="app-shell" role="application">
    <!-- Top Bar -->
    <header class="top-bar">
      <div class="top-bar-left">
        <button class="sidebar-toggle" onclick="toggleSidebar()" title="Toggle Sidebar (⌘B)" aria-label="Toggle sidebar navigation" aria-expanded="true" aria-controls="sidebar">
          <span class="hamburger-icon" aria-hidden="true">☰</span>
        </button>
        <div class="logo">
          <div class="logo-text">
            <span class="logo-title">StageWright Local</span>
            <span class="logo-subtitle">Get your test stage right.</span>
          </div>
        </div>
        <nav class="breadcrumbs">
          <span class="breadcrumb active" data-view="tests">Tests</span>
          <span class="breadcrumb-separator">›</span>
          <span class="breadcrumb" id="breadcrumb-detail"></span>
        </nav>
      </div>
      <div class="top-bar-right">
        <button class="search-trigger" onclick="openSearch()" title="Search (⌘K)" aria-label="Search tests">
          <span class="search-icon-btn">🔍</span>
          <span class="search-label">Search...</span>
          <kbd class="search-kbd">⌘K</kbd>
        </button>
        <div class="export-dropdown" id="exportDropdown">
          <button class="top-bar-btn" onclick="toggleExportMenu()" title="Export" aria-haspopup="true" aria-expanded="false">
            <span>📥</span>
            <span class="btn-label">Export</span>
          </button>
          <div class="export-menu" role="menu">
            <button class="export-menu-item" onclick="exportJSON()" role="menuitem">
              <span>📄</span> JSON
            </button>
            <button class="export-menu-item" onclick="exportCSV()" role="menuitem">
              <span>📊</span> CSV
            </button>
            <button class="export-menu-item" onclick="showSummaryExport()" role="menuitem">
              <span>📋</span> Summary Card
            </button>
          </div>
        </div>
        <div class="theme-dropdown" id="themeDropdown">
          <button class="theme-toggle" onclick="toggleThemeMenu()" title="Theme" aria-label="Change theme" aria-haspopup="true" aria-expanded="false">
            <span class="theme-toggle-icon" id="themeIcon">🌙</span>
            <span class="theme-label" id="themeLabel">Dark</span>
          </button>
          <div class="theme-menu" role="menu">
            <button class="theme-menu-item" onclick="setTheme('system')" role="menuitem" data-theme="system">
              <span>💻</span> System
            </button>
            <button class="theme-menu-item" onclick="setTheme('light')" role="menuitem" data-theme="light">
              <span>☀️</span> Light
            </button>
            <button class="theme-menu-item" onclick="setTheme('dark')" role="menuitem" data-theme="dark">
              <span>🌙</span> Dark
            </button>
          </div>
        </div>
        <div class="timestamp">${new Date().toLocaleString()}</div>
      </div>
    </header>

    ${ciInfo ? `
    <!-- CI Environment Info Bar -->
    <div class="ci-info-bar">
      <span class="ci-provider">${escapeHtml(ciInfo.provider.toUpperCase())}</span>
      ${ciInfo.branch ? `<span class="ci-item"><span class="ci-label">Branch:</span> ${escapeHtml(ciInfo.branch)}</span>` : ''}
      ${ciInfo.commit ? `<span class="ci-item"><span class="ci-label">Commit:</span> <code>${escapeHtml(ciInfo.commit)}</code></span>` : ''}
      ${ciInfo.buildId ? `<span class="ci-item"><span class="ci-label">Build:</span> #${escapeHtml(ciInfo.buildId)}</span>` : ''}
    </div>
    ` : ''}

    <!-- Mobile sidebar overlay -->
    <div class="sidebar-overlay" id="sidebarOverlay" onclick="toggleSidebar()"></div>

    <!-- Toast notifications container -->
    <div class="toast-container" id="toastContainer" aria-live="polite"></div>

    <!-- Sidebar -->
    <aside class="sidebar" id="sidebar">
      <!-- Progress Ring -->
      <div class="sidebar-progress">
        <div class="progress-ring-container clickable" onclick="switchView('tests')" title="View all tests" role="button" tabindex="0">
          <svg class="progress-ring" width="80" height="80">
            <circle class="progress-ring-bg" cx="40" cy="40" r="34"/>
            <circle class="progress-ring-fill" cx="40" cy="40" r="34"
                    stroke-dasharray="213.6"
                    stroke-dashoffset="${(213.6 - (213.6 * passRate) / 100).toFixed(1)}"/>
          </svg>
          <div class="progress-ring-value">${passRate}%</div>
        </div>
        <div class="progress-label">Pass Rate</div>
      </div>

      <!-- Quick Stats -->
      <div class="sidebar-stats" role="group" aria-label="Test statistics">
        <button class="mini-stat passed" onclick="filterTests('passed')" title="Passed tests" aria-label="${passed} passed tests - click to filter">
          <span class="mini-stat-value">${passed}</span>
          <span class="mini-stat-label">Passed</span>
        </button>
        <button class="mini-stat failed" onclick="filterTests('failed')" title="Failed tests" aria-label="${failed} failed tests - click to filter">
          <span class="mini-stat-value">${failed}</span>
          <span class="mini-stat-label">Failed</span>
        </button>
        <button class="mini-stat flaky" onclick="filterTests('flaky')" title="Flaky tests" aria-label="${flaky} flaky tests - click to filter">
          <span class="mini-stat-value">${flaky}</span>
          <span class="mini-stat-label">Flaky</span>
        </button>
      </div>

      <!-- Navigation -->
      <nav class="sidebar-nav" aria-label="Main navigation">
        <div class="nav-section-title" id="nav-section-label">Navigation</div>
        <div role="tablist" aria-labelledby="nav-section-label">
          <button class="nav-item active" data-view="overview" onclick="switchView('overview')" role="tab" aria-selected="true" aria-controls="view-overview">
            <span class="nav-icon" aria-hidden="true">📊</span>
            <span class="nav-label">Overview</span>
          </button>
          <button class="nav-item" data-view="tests" onclick="switchView('tests')" role="tab" aria-selected="false" aria-controls="view-tests">
            <span class="nav-icon" aria-hidden="true">🧪</span>
            <span class="nav-label">Tests</span>
            <span class="nav-badge" aria-label="${total} total tests">${total}</span>
          </button>
          <button class="nav-item" data-view="trends" onclick="switchView('trends')" role="tab" aria-selected="false" aria-controls="view-trends">
            <span class="nav-icon" aria-hidden="true">📈</span>
            <span class="nav-label">Trends</span>
          </button>
          ${showComparison ? `
          <button class="nav-item" data-view="comparison" onclick="switchView('comparison')" role="tab" aria-selected="false" aria-controls="view-comparison">
            <span class="nav-icon" aria-hidden="true">⚖️</span>
            <span class="nav-label">Comparison</span>
          </button>
          ` : ''}
          ${showGallery ? `
          <button class="nav-item" data-view="gallery" onclick="switchView('gallery')" role="tab" aria-selected="false" aria-controls="view-gallery">
            <span class="nav-icon" aria-hidden="true">🖼️</span>
            <span class="nav-label">Gallery</span>
          </button>
          ` : ''}
        </div>
      </nav>

      <!-- Filters -->
      <div class="sidebar-filters" role="region" aria-label="Test filters">
        <div class="nav-section-title">Filters <button class="clear-filters-btn" onclick="clearAllFilters()" title="Clear all filters" aria-label="Clear all filters">✕</button></div>
        ${hasAttention ? `
        <div class="filter-group" data-group="attention" role="group" aria-label="Attention filters">
          <div class="filter-group-title" id="attention-filter-label">Attention</div>
          <div class="filter-chips attention-chips" role="group" aria-labelledby="attention-filter-label">
            ${newFailuresCount > 0 ? `<button class="filter-chip attention-new-failure" data-filter="new-failure" data-group="attention" onclick="toggleFilter(this)" aria-pressed="false">New Failure (${newFailuresCount})</button>` : ''}
            ${regressionsCount > 0 ? `<button class="filter-chip attention-regression" data-filter="regression" data-group="attention" onclick="toggleFilter(this)" aria-pressed="false">Regression (${regressionsCount})</button>` : ''}
            ${fixedCount > 0 ? `<button class="filter-chip attention-fixed" data-filter="fixed" data-group="attention" onclick="toggleFilter(this)" aria-pressed="false">Fixed (${fixedCount})</button>` : ''}
          </div>
        </div>
        ` : ''}
        <div class="filter-group" data-group="status" role="group" aria-label="Status filters">
          <div class="filter-group-title" id="status-filter-label">Status</div>
          <div class="filter-chips" role="group" aria-labelledby="status-filter-label">
            <button class="filter-chip" data-filter="passed" data-group="status" onclick="toggleFilter(this)" aria-pressed="false">Passed</button>
            <button class="filter-chip" data-filter="failed" data-group="status" onclick="toggleFilter(this)" aria-pressed="false">Failed</button>
            <button class="filter-chip" data-filter="skipped" data-group="status" onclick="toggleFilter(this)" aria-pressed="false">Skipped</button>
          </div>
        </div>
        <div class="filter-group" data-group="health" role="group" aria-label="Health filters">
          <div class="filter-group-title" id="health-filter-label">Health</div>
          <div class="filter-chips" role="group" aria-labelledby="health-filter-label">
            <button class="filter-chip" data-filter="flaky" data-group="health" onclick="toggleFilter(this)" aria-pressed="false">Flaky (${flaky})</button>
            <button class="filter-chip" data-filter="slow" data-group="health" onclick="toggleFilter(this)" aria-pressed="false">Slow (${slow})</button>
            <button class="filter-chip" data-filter="new" data-group="health" onclick="toggleFilter(this)" aria-pressed="false">New (${newTests})</button>
          </div>
        </div>
        <div class="filter-group" data-group="grade" role="group" aria-label="Grade filters">
          <div class="filter-group-title" id="grade-filter-label">Grade</div>
          <div class="filter-chips grade-chips" role="group" aria-labelledby="grade-filter-label">
            <button class="filter-chip grade-a" data-filter="grade-a" data-group="grade" onclick="toggleFilter(this)" aria-pressed="false" aria-label="Grade A">A</button>
            <button class="filter-chip grade-b" data-filter="grade-b" data-group="grade" onclick="toggleFilter(this)" aria-pressed="false" aria-label="Grade B">B</button>
            <button class="filter-chip grade-c" data-filter="grade-c" data-group="grade" onclick="toggleFilter(this)" aria-pressed="false" aria-label="Grade C">C</button>
            <button class="filter-chip grade-d" data-filter="grade-d" data-group="grade" onclick="toggleFilter(this)" aria-pressed="false" aria-label="Grade D">D</button>
            <button class="filter-chip grade-f" data-filter="grade-f" data-group="grade" onclick="toggleFilter(this)" aria-pressed="false" aria-label="Grade F">F</button>
          </div>
        </div>
        ${sortedSuites.length > 0 ? `
        <div class="filter-group" data-group="suite" role="group" aria-label="Suite filters">
          <div class="filter-group-title" id="suite-filter-label">Suite</div>
          <div class="filter-chips suite-chips" role="group" aria-labelledby="suite-filter-label">
            ${sortedSuites.slice(0, 8).map(([suite, count]) =>
              `<button class="filter-chip suite-chip" data-filter="suite-${escapeHtml(suite)}" data-group="suite" data-suite-name="${escapeHtml(suite)}" onclick="toggleFilter(this)" aria-pressed="false" title="${escapeHtml(suite)} (${count} tests)">${escapeHtml(suite.length > 15 ? suite.slice(0, 12) + '...' : suite)} (${count})</button>`
            ).join('')}
          </div>
        </div>
        ` : ''}
        ${sortedTags.length > 0 ? `
        <div class="filter-group" data-group="tag" role="group" aria-label="Tag filters">
          <div class="filter-group-title" id="tag-filter-label">Tags</div>
          <div class="filter-chips tag-chips" role="group" aria-labelledby="tag-filter-label">
            ${sortedTags.slice(0, 8).map(([tag, count]) =>
              `<button class="filter-chip tag-chip" data-filter="tag-${escapeHtml(tag)}" data-group="tag" data-tag-name="${escapeHtml(tag)}" onclick="toggleFilter(this)" aria-pressed="false" title="${escapeHtml(tag)} (${count} tests)">${escapeHtml(tag)} (${count})</button>`
            ).join('')}
          </div>
        </div>
        ` : ''}
      </div>

      <!-- File Tree -->
      <div class="sidebar-files">
        <div class="nav-section-title">Specs</div>
        <div class="file-tree">
          ${generateFileTree(results)}
        </div>
      </div>

      <!-- Duration -->
      <div class="sidebar-footer">
        <div class="run-duration">
          <span class="duration-icon">⏱️</span>
          <span class="duration-value">${formatDuration(totalDuration)}</span>
        </div>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content" id="main-content" tabindex="-1" aria-label="Test report content">
      <!-- Overview View -->
      <section class="view-panel" id="view-overview" role="tabpanel" aria-label="Overview">
        <div class="view-header">
          <h2 class="view-title">Overview</h2>
        </div>
        <div class="overview-content">
          ${generateOverviewContent(results, comparison, failureClusters, passed, failed, skipped, flaky, slow, newTests, total, passRate, totalDuration, history)}
        </div>
      </section>

      <!-- Tests View (Master-Detail) -->
      <section class="view-panel" id="view-tests" role="tabpanel" aria-label="Tests" style="display: none;">
        <div class="master-detail-layout">
          <!-- Test List (Master) -->
          <div class="test-list-panel">
            <div class="test-list-header">
              <div class="test-list-tabs" role="tablist" aria-label="Test grouping options">
                <button class="tab-btn active" data-tab="all" onclick="switchTestTab('all')" role="tab" aria-selected="true" aria-controls="tab-all">All Tests</button>
                <button class="tab-btn" data-tab="by-file" onclick="switchTestTab('by-file')" role="tab" aria-selected="false" aria-controls="tab-by-file">By Spec</button>
                <button class="tab-btn" data-tab="by-status" onclick="switchTestTab('by-status')" role="tab" aria-selected="false" aria-controls="tab-by-status">By Status</button>
                <button class="tab-btn" data-tab="by-stability" onclick="switchTestTab('by-stability')" role="tab" aria-selected="false" aria-controls="tab-by-stability">By Stability</button>
              </div>
              <div class="test-list-search">
                <input type="text" class="inline-search" placeholder="Filter tests..." oninput="searchTests(this.value)" aria-label="Filter tests by name">
              </div>
            </div>
            <div class="test-list-content">
              <!-- Empty state for no results -->
              <div class="empty-state" id="emptyState" style="display: none;">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-title">No tests found</div>
                <div class="empty-state-message">No tests match your current filters. Try adjusting your search or filter criteria.</div>
                <button class="empty-state-action" onclick="clearAllFilters()">Clear filters</button>
              </div>
              <!-- All Tests Tab -->
              <div class="test-tab-content active" id="tab-all" role="tabpanel" aria-labelledby="tab-all-label">
                <div role="list" aria-label="All tests">
                  ${generateTestListItems(sortedResults, showTraceSection, attentionSets)}
                </div>
              </div>
              <!-- By Spec Tab -->
              <div class="test-tab-content" id="tab-by-file" role="tabpanel" aria-labelledby="tab-by-file-label">
                ${generateGroupedTests(sortedResults, showTraceSection, attentionSets)}
              </div>
              <!-- By Status Tab -->
              <div class="test-tab-content" id="tab-by-status" role="tabpanel" aria-labelledby="tab-by-status-label">
                <div class="status-group failed-group">
                  <div class="status-group-header">
                    <span class="status-group-dot failed"></span>
                    <span class="status-group-title">Failed (${failed})</span>
                  </div>
                  ${generateTestListItems(sortedResults.filter(r => r.status === 'failed' || r.status === 'timedOut'), showTraceSection, attentionSets)}
                </div>
                <div class="status-group passed-group">
                  <div class="status-group-header">
                    <span class="status-group-dot passed"></span>
                    <span class="status-group-title">Passed (${passed})</span>
                  </div>
                  ${generateTestListItems(sortedResults.filter(r => r.status === 'passed'), showTraceSection, attentionSets)}
                </div>
                <div class="status-group skipped-group">
                  <div class="status-group-header">
                    <span class="status-group-dot skipped"></span>
                    <span class="status-group-title">Skipped (${skipped})</span>
                  </div>
                  ${generateTestListItems(sortedResults.filter(r => r.status === 'skipped'), showTraceSection, attentionSets)}
                </div>
              </div>
              <!-- By Stability Tab -->
              <div class="test-tab-content" id="tab-by-stability">
                ${['A', 'B', 'C', 'D', 'F'].map(grade => {
                  const gradeTests = sortedResults.filter(r => r.stabilityScore?.grade === grade);
                  if (gradeTests.length === 0) return '';
                  return `
                    <div class="stability-group grade-${grade.toLowerCase()}-group">
                      <div class="stability-group-header">
                        <span class="stability-badge ${grade.toLowerCase()}">${grade}</span>
                        <span class="stability-group-title">Grade ${grade} (${gradeTests.length})</span>
                      </div>
                      ${generateTestListItems(gradeTests, showTraceSection, attentionSets)}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>

          <!-- Test Detail (Detail) -->
          <div class="test-detail-panel" id="test-detail-panel">
            <div class="detail-placeholder">
              <div class="placeholder-icon">🧪</div>
              <div class="placeholder-text">Select a test to view details</div>
              <div class="placeholder-hint">Click on any test in the list</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Trends View -->
      <section class="view-panel" id="view-trends" role="tabpanel" aria-label="Trends" style="display: none;">
        <div class="view-header">
          <h2 class="view-title">Trends</h2>
        </div>
        <div class="trends-content">
          ${generateTrendChart({ results, history, startTime })}
        </div>
      </section>

      <!-- Comparison View -->
      ${showComparison ? `
      <section class="view-panel" id="view-comparison" role="tabpanel" aria-label="Comparison" style="display: none;">
        <div class="view-header">
          <h2 class="view-title">Run Comparison</h2>
        </div>
        <div class="comparison-content">
          ${generateComparison(comparison!)}
        </div>
      </section>
      ` : ''}

      <!-- Gallery View -->
      ${showGallery ? `
      <section class="view-panel" id="view-gallery" role="tabpanel" aria-label="Gallery" style="display: none;">
        <div class="view-header">
          <h2 class="view-title">Attachments Gallery</h2>
        </div>
        <div class="gallery-content">
          ${generateGallery(results)}
        </div>
      </section>
      ` : ''}
    </main>
  </div>

  <!-- Search Modal -->
  <div class="search-modal" id="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-modal-title" aria-hidden="true">
    <div class="search-modal-backdrop" onclick="closeSearch()"></div>
    <div class="search-modal-content">
      <div class="search-modal-header">
        <span class="search-modal-icon" aria-hidden="true">🔍</span>
        <label for="search-modal-input" class="visually-hidden" id="search-modal-title">Search tests</label>
        <input type="text" class="search-modal-input" id="search-modal-input" placeholder="Search tests..." oninput="handleSearchInput(this.value)" aria-describedby="search-modal-hint">
        <span id="search-modal-hint" class="visually-hidden">Press Escape to close</span>
        <kbd class="search-modal-esc" aria-hidden="true">ESC</kbd>
      </div>
      <div class="search-modal-results" id="search-modal-results" role="listbox" aria-label="Search results"></div>
    </div>
  </div>

  <!-- Issue #13: Inline Trace Viewer Modal -->
  ${enableTraceViewer ? generateTraceViewerHtml() : ''}

  <!-- Hidden data containers for detail rendering -->
  <div id="test-cards-data" style="display: none;">
    ${results.map(test => generateTestCard(test, showTraceSection)).join('\n')}
  </div>

  <!-- Issue #13: JSZip library for trace extraction -->
  ${enableTraceViewer ? `<script>${generateJSZipScript()}</script>` : ''}

  <script>
${generateScripts(testsJson, showGallery, showComparison, enableTraceViewer, enableHistoryDrilldown, historyRunSnapshotsJson, statsData)}

${enableTraceViewer ? generateTraceViewerScript() : ''}
  </script>
</body>
</html>`;
}

/**
 * Generate all CSS styles for the new app-shell layout
 */
function generateStyles(passRate: number, cspSafe: boolean = false): string {
  // Font families - use system fonts in CSP-safe mode
  const primaryFont = cspSafe
    ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    : "'Space Grotesk', system-ui, sans-serif";
  const monoFont = cspSafe
    ? "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"
    : "'JetBrains Mono', ui-monospace, monospace";

  return `    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a24;
      --bg-card-hover: #22222e;
      --bg-sidebar: #0d0d14;
      --border-subtle: #2a2a3a;
      --border-glow: #3b3b4f;
      --text-primary: #f0f0f5;
      --text-secondary: #8888a0;
      --text-muted: #5a5a70;
      --accent-green: #00ff88;
      --accent-green-dim: #00cc6a;
      --accent-red: #ff4466;
      --accent-red-dim: #cc3355;
      --accent-yellow: #ffcc00;
      --accent-yellow-dim: #ccaa00;
      --accent-blue: #00aaff;
      --accent-blue-dim: #0088cc;
      --accent-purple: #aa66ff;
      --accent-orange: #ff8844;
      --sidebar-width: 260px;
      --topbar-height: 56px;
    }

    /* Light theme - respects system preference */
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        --bg-primary: #f5f5f7;
        --bg-secondary: #ffffff;
        --bg-card: #ffffff;
        --bg-card-hover: #f0f0f2;
        --bg-sidebar: #fafafa;
        --border-subtle: #e0e0e5;
        --border-glow: #d0d0d8;
        --text-primary: #1a1a1f;
        --text-secondary: #5a5a6e;
        --text-muted: #8a8a9a;
        --accent-green: #00aa55;
        --accent-green-dim: #008844;
        --accent-red: #dd3344;
        --accent-red-dim: #bb2233;
        --accent-yellow: #cc9900;
        --accent-yellow-dim: #aa7700;
        --accent-blue: #0077cc;
        --accent-blue-dim: #005599;
        --accent-purple: #8844cc;
        --accent-orange: #dd6622;
      }
    }

    /* Manual dark theme override */
    :root[data-theme="dark"] {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a24;
      --bg-card-hover: #22222e;
      --bg-sidebar: #0d0d14;
      --border-subtle: #2a2a3a;
      --border-glow: #3b3b4f;
      --text-primary: #f0f0f5;
      --text-secondary: #8888a0;
      --text-muted: #5a5a70;
      --accent-green: #00ff88;
      --accent-green-dim: #00cc6a;
      --accent-red: #ff4466;
      --accent-red-dim: #cc3355;
      --accent-yellow: #ffcc00;
      --accent-yellow-dim: #ccaa00;
      --accent-blue: #00aaff;
      --accent-blue-dim: #0088cc;
      --accent-purple: #aa66ff;
      --accent-orange: #ff8844;
    }

    /* Manual light theme override */
    :root[data-theme="light"] {
      --bg-primary: #f5f5f7;
      --bg-secondary: #ffffff;
      --bg-card: #ffffff;
      --bg-card-hover: #f0f0f2;
      --bg-sidebar: #fafafa;
      --border-subtle: #e0e0e5;
      --border-glow: #d0d0d8;
      --text-primary: #1a1a1f;
      --text-secondary: #5a5a6e;
      --text-muted: #8a8a9a;
      --accent-green: #00aa55;
      --accent-green-dim: #008844;
      --accent-red: #dd3344;
      --accent-red-dim: #bb2233;
      --accent-yellow: #cc9900;
      --accent-yellow-dim: #aa7700;
      --accent-blue: #0077cc;
      --accent-blue-dim: #005599;
      --accent-purple: #8844cc;
      --accent-orange: #dd6622;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    button {
      background: none;
      border: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }

    body {
      font-family: ${primaryFont};
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
      line-height: 1.5;
    }

    /* ============================================
       APP SHELL LAYOUT
    ============================================ */
    .app-shell {
      display: grid;
      grid-template-areas:
        "topbar topbar"
        "sidebar main";
      grid-template-columns: var(--sidebar-width) 1fr;
      grid-template-rows: var(--topbar-height) 1fr;
      height: 100vh;
      overflow: hidden;
      transition: grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .app-shell.sidebar-collapsed {
      grid-template-columns: 0 1fr;
    }

    .app-shell.sidebar-collapsed .sidebar {
      transform: translateX(-100%);
      opacity: 0;
    }

    /* ============================================
       TOP BAR
    ============================================ */
    .top-bar {
      grid-area: topbar;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1rem;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-subtle);
      z-index: 100;
    }

    .top-bar-left {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .sidebar-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      background: transparent;
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
    }

    .sidebar-toggle:hover {
      background: var(--bg-card);
      border-color: var(--border-glow);
      color: var(--text-primary);
    }

    .hamburger-icon {
      font-size: 1.1rem;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      font-weight: 700;
      color: var(--bg-primary);
    }

    .logo-icon-img {
      width: 32px;
      height: 32px;
      object-fit: contain;
    }

    .logo-text {
      display: flex;
      flex-direction: column;
      line-height: 1.2;
    }

    .logo-title {
      font-size: 0.95rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .logo-subtitle {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-family: ${monoFont};
    }

    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-left: 1rem;
      padding-left: 1rem;
      border-left: 1px solid var(--border-subtle);
    }

    .breadcrumb {
      font-size: 0.85rem;
      color: var(--text-muted);
      cursor: pointer;
      transition: color 0.2s;
    }

    .breadcrumb:hover { color: var(--text-secondary); }
    .breadcrumb.active { color: var(--text-primary); font-weight: 500; }

    .breadcrumb-separator {
      color: var(--text-muted);
      font-size: 0.75rem;
    }

    .search-trigger {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
      min-width: 200px;
    }

    .search-trigger:hover {
      border-color: var(--border-glow);
      color: var(--text-secondary);
    }

    .search-icon-btn { font-size: 0.85rem; }
    .search-label { flex: 1; text-align: left; font-size: 0.85rem; }
    .search-kbd {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.15rem 0.4rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
    }

    .top-bar-btn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.75rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      cursor: pointer;
      font-family: ${monoFont};
      font-size: 0.8rem;
      transition: all 0.2s;
    }

    .top-bar-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    .btn-label { font-size: 0.8rem; }

    .timestamp {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
      padding: 0.4rem 0.75rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
    }

    /* ============================================
       SIDEBAR
    ============================================ */
    .sidebar {
      grid-area: sidebar;
      display: flex;
      flex-direction: column;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border-subtle);
      min-height: 0; /* Allow grid cell to shrink below content height */
      overflow-y: auto;
      overflow-x: hidden;
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
    }

    /* Hidden by default on desktop */
    .sidebar-overlay {
      display: none;
    }

    .sidebar-progress {
      padding: 1.25rem;
      text-align: center;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .progress-ring-container {
      position: relative;
      width: 80px;
      height: 80px;
      margin: 0 auto;
    }

    .progress-ring-container.clickable {
      cursor: pointer;
      transition: transform 0.2s, filter 0.2s;
    }

    .progress-ring-container.clickable:hover {
      transform: scale(1.05);
      filter: brightness(1.1);
    }

    .progress-ring {
      transform: rotate(-90deg);
    }

    .progress-ring-bg {
      fill: none;
      stroke: var(--border-subtle);
      stroke-width: 6;
    }

    .progress-ring-fill {
      fill: none;
      stroke: var(--accent-green);
      stroke-width: 6;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.5s ease;
      filter: drop-shadow(0 0 6px var(--accent-green));
    }

    .progress-ring-value {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ${monoFont};
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent-green);
    }

    .progress-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
    }

    .sidebar-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
      padding: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .mini-stat {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mini-stat:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
      transform: translateY(-1px);
    }

    .mini-stat-value {
      font-family: ${monoFont};
      font-size: 1rem;
      font-weight: 700;
    }

    .mini-stat-label {
      font-size: 0.6rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .mini-stat.passed .mini-stat-value { color: var(--accent-green); }
    .mini-stat.failed .mini-stat-value { color: var(--accent-red); }
    .mini-stat.flaky .mini-stat-value { color: var(--accent-yellow); }

    .sidebar-nav {
      padding: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .sidebar-nav [role="tablist"] {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .nav-section-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .clear-filters-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.7rem;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      opacity: 0.6;
      transition: all 0.2s;
    }

    .clear-filters-btn:hover {
      opacity: 1;
      background: var(--bg-card);
      color: var(--text-primary);
    }

    .nav-item {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      padding: 0.6rem 0.75rem;
      border-radius: 8px;
      color: var(--text-secondary);
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.85rem;
      text-align: left;
    }

    .nav-item:hover {
      background: var(--bg-card);
      color: var(--text-primary);
    }

    .nav-item.active {
      background: var(--bg-card);
      color: var(--accent-green);
      border-left: 3px solid var(--accent-green);
      padding-left: calc(0.75rem - 3px);
    }

    .nav-icon { font-size: 1rem; flex-shrink: 0; }
    .nav-label { flex: 1; font-weight: 500; white-space: nowrap; }
    .nav-badge {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      background: var(--bg-secondary);
      border-radius: 10px;
      color: var(--text-muted);
    }

    .sidebar-filters {
      padding: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .filter-group {
      margin-bottom: 0.75rem;
    }

    .filter-group:last-child { margin-bottom: 0; }

    .filter-group-title {
      font-size: 0.65rem;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
      padding-left: 0.25rem;
    }

    .filter-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .filter-chip {
      font-family: ${monoFont};
      font-size: 0.65rem;
      padding: 0.35rem 0.6rem;
      border-radius: 20px;
      border: 1px solid var(--border-subtle);
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-chip:hover {
      background: var(--bg-card);
      color: var(--text-secondary);
      border-color: var(--border-glow);
    }

    .filter-chip.active {
      background: var(--bg-card);
      color: var(--accent-blue);
      border-color: var(--accent-blue);
    }

    .grade-chips .filter-chip {
      min-width: 28px;
      text-align: center;
    }

    .filter-chip.grade-a { border-color: var(--accent-green-dim); }
    .filter-chip.grade-a:hover, .filter-chip.grade-a.active { background: var(--accent-green); color: var(--bg-primary); border-color: var(--accent-green); }
    .filter-chip.grade-b { border-color: var(--accent-blue-dim); }
    .filter-chip.grade-b:hover, .filter-chip.grade-b.active { background: var(--accent-blue); color: var(--bg-primary); border-color: var(--accent-blue); }
    .filter-chip.grade-c { border-color: var(--accent-yellow-dim); }
    .filter-chip.grade-c:hover, .filter-chip.grade-c.active { background: var(--accent-yellow); color: var(--bg-primary); border-color: var(--accent-yellow); }
    .filter-chip.grade-d { border-color: var(--accent-orange); }
    .filter-chip.grade-d:hover, .filter-chip.grade-d.active { background: var(--accent-orange); color: var(--bg-primary); border-color: var(--accent-orange); }
    .filter-chip.grade-f { border-color: var(--accent-red-dim); }
    .filter-chip.grade-f:hover, .filter-chip.grade-f.active { background: var(--accent-red); color: var(--bg-primary); border-color: var(--accent-red); }

    /* Attention filter chips */
    .attention-chips .filter-chip {
      font-weight: 500;
    }
    .filter-chip.attention-new-failure { border-color: var(--accent-red-dim); }
    .filter-chip.attention-new-failure:hover:not(.active) { 
      background: rgba(255, 68, 102, 0.15); 
      color: var(--accent-red); 
      border-color: var(--accent-red); 
    }
    .filter-chip.attention-new-failure.active { 
      background: var(--accent-red); 
      color: var(--bg-primary); 
      border-color: var(--accent-red); 
    }
    .filter-chip.attention-regression { border-color: var(--accent-orange); }
    .filter-chip.attention-regression:hover:not(.active) { 
      background: rgba(255, 136, 68, 0.15); 
      color: var(--accent-orange); 
      border-color: var(--accent-orange); 
    }
    .filter-chip.attention-regression.active { 
      background: var(--accent-orange); 
      color: var(--bg-primary); 
      border-color: var(--accent-orange); 
    }
    .filter-chip.attention-fixed { border-color: var(--accent-green-dim); }
    .filter-chip.attention-fixed:hover:not(.active) { 
      background: rgba(0, 255, 136, 0.15); 
      color: var(--accent-green); 
      border-color: var(--accent-green); 
    }
    .filter-chip.attention-fixed.active { 
      background: var(--accent-green); 
      color: var(--bg-primary); 
      border-color: var(--accent-green); 
    }

    .sidebar-files {
      padding: 0.75rem;
      flex-shrink: 0;
    }

    .file-tree {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .file-tree-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
      font-size: 0.8rem;
    }

    .file-tree-item:hover {
      background: var(--bg-card);
    }

    .file-tree-item.active {
      background: var(--bg-card);
      box-shadow: inset 2px 0 0 var(--accent-blue);
    }

    .file-tree-icon { font-size: 0.85rem; }
    .file-tree-name {
      flex: 1;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .file-tree-item.has-failures .file-tree-name { color: var(--accent-red); }
    .file-tree-item.all-passed .file-tree-name { color: var(--text-secondary); }

    .file-tree-stats {
      display: flex;
      gap: 0.25rem;
    }

    .file-stat {
      font-family: ${monoFont};
      font-size: 0.65rem;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
    }

    .file-stat.passed { color: var(--accent-green); background: rgba(0, 255, 136, 0.1); }
    .file-stat.failed { color: var(--accent-red); background: rgba(255, 68, 102, 0.1); }

    .sidebar-footer {
      padding: 0.75rem;
      border-top: 1px solid var(--border-subtle);
      flex-shrink: 0;
    }

    .run-duration {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* ============================================
       MAIN CONTENT AREA
    ============================================ */
    .main-content {
      grid-area: main;
      overflow-y: auto;
      background: var(--bg-primary);
    }

    .view-panel {
      height: 100%;
      overflow-y: auto;
    }

    .view-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
    }

    .view-title {
      font-size: 1.25rem;
      font-weight: 600;
    }

    /* ============================================
       OVERVIEW VIEW
    ============================================ */
    .overview-content {
      padding: 1.5rem;
    }

    .overview-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card.large {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      transition: all 0.2s;
    }

    .stat-card.large:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    }

    .stat-icon {
      font-size: 1.5rem;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      background: var(--bg-secondary);
    }

    .stat-card.large.passed { border-left: 3px solid var(--accent-green); }
    .stat-card.large.passed .stat-icon { background: rgba(0, 255, 136, 0.1); color: var(--accent-green); }
    .stat-card.large.failed { border-left: 3px solid var(--accent-red); }
    .stat-card.large.failed .stat-icon { background: rgba(255, 68, 102, 0.1); color: var(--accent-red); }
    .stat-card.large.skipped { border-left: 3px solid var(--text-muted); }
    .stat-card.large.skipped .stat-icon { background: rgba(90, 90, 112, 0.1); color: var(--text-muted); }
    .stat-card.large.flaky { border-left: 3px solid var(--accent-yellow); }
    .stat-card.large.flaky .stat-icon { background: rgba(255, 204, 0, 0.1); color: var(--accent-yellow); }
    .stat-card.large.slow { border-left: 3px solid var(--accent-orange); }
    .stat-card.large.slow .stat-icon { background: rgba(255, 136, 68, 0.1); color: var(--accent-orange); }
    .stat-card.large.duration { border-left: 3px solid var(--accent-blue); }
    .stat-card.large.duration .stat-icon { background: rgba(0, 170, 255, 0.1); color: var(--accent-blue); }

    .stat-content { flex: 1; }

    .stat-card.large .stat-value {
      font-family: ${monoFont};
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .stat-card.large .stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .overview-trends {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.5rem;
    }

    /* ============================================
       OVERVIEW - HERO STATS
    ============================================ */
    .hero-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .hero-stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.25rem;
      transition: all 0.2s;
    }

    .hero-stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    }

    .hero-stat-card.health {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .health-gauge {
      position: relative;
      width: 80px;
      height: 80px;
    }

    .health-ring {
      transform: rotate(-90deg);
      width: 100%;
      height: 100%;
    }

    .health-ring-bg {
      fill: none;
      stroke: var(--border-subtle);
      stroke-width: 8;
    }

    .health-ring-fill {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dasharray 0.5s ease;
    }

    .hero-stat-card.health.excellent .health-ring-fill { stroke: var(--accent-green); }
    .hero-stat-card.health.good .health-ring-fill { stroke: var(--accent-blue); }
    .hero-stat-card.health.fair .health-ring-fill { stroke: var(--accent-yellow); }
    .hero-stat-card.health.poor .health-ring-fill { stroke: var(--accent-red); }

    .health-score {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }

    .health-grade {
      font-size: 1.5rem;
      font-weight: 800;
      display: block;
    }

    .hero-stat-card.health.excellent .health-grade { color: var(--accent-green); }
    .hero-stat-card.health.good .health-grade { color: var(--accent-blue); }
    .hero-stat-card.health.fair .health-grade { color: var(--accent-yellow); }
    .hero-stat-card.health.poor .health-grade { color: var(--accent-red); }

    .health-value {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .hero-stat-info {
      flex: 1;
    }

    .health-breakdown {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    .hero-stat-main {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .hero-stat-value {
      font-family: ${monoFont};
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .hero-stat-delta {
      font-size: 0.85rem;
      font-weight: 600;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
    }

    .hero-stat-delta.positive {
      color: var(--accent-green);
      background: rgba(0, 255, 136, 0.1);
    }

    .hero-stat-delta.negative {
      color: var(--accent-red);
      background: rgba(255, 68, 102, 0.1);
    }

    .hero-stat-label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .hero-stat-detail {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    /* Mini Comparison Bars */
    .mini-comparison {
      padding: 1rem;
    }

    .mini-bars {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .mini-bar-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .mini-bar-row.clickable {
      cursor: pointer;
      padding: 0.35rem 0.5rem;
      margin: -0.35rem -0.5rem;
      border-radius: 6px;
      transition: background 0.2s;
    }

    .mini-bar-row.clickable:hover {
      background: var(--bg-card-hover);
    }

    .mini-bar-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      width: 50px;
    }

    .mini-bar-track {
      flex: 1;
      height: 8px;
      background: var(--bg-secondary);
      border-radius: 4px;
      overflow: hidden;
    }

    .mini-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .mini-bar.passed { background: var(--accent-green); }
    .mini-bar.failed { background: var(--accent-red); }
    .mini-bar.skipped { background: var(--text-muted); }

    .mini-bar-value {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-secondary);
      width: 30px;
      text-align: right;
    }

    /* ============================================
       OVERVIEW - ATTENTION SECTION
    ============================================ */
    .overview-section {
      margin-bottom: 1.5rem;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .section-icon {
      font-size: 1.1rem;
    }

    .section-title {
      font-size: 0.9rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }

    .attention-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
    }

    .attention-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 1rem;
      cursor: pointer;
      transition: all 0.2s;
      border-left: 4px solid transparent;
    }

    .attention-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .attention-card.critical {
      border-left-color: var(--accent-red);
      background: linear-gradient(135deg, rgba(255, 68, 102, 0.05) 0%, transparent 50%);
    }

    .attention-card.warning {
      border-left-color: var(--accent-yellow);
      background: linear-gradient(135deg, rgba(255, 204, 0, 0.05) 0%, transparent 50%);
    }

    .attention-card.success {
      border-left-color: var(--accent-green);
      background: linear-gradient(135deg, rgba(0, 255, 136, 0.05) 0%, transparent 50%);
    }

    .attention-value {
      font-family: ${monoFont};
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .attention-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }

    .attention-desc {
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    /* ============================================
       OVERVIEW - FAILURE CLUSTERS
    ============================================ */
    .failure-clusters-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
    }

    .cluster-card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-left: 3px solid var(--accent-red);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .cluster-card:hover {
      background: var(--bg-card-hover);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .cluster-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .cluster-icon {
      font-size: 1rem;
    }

    .cluster-type {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent-red);
      flex: 1;
    }

    .cluster-count {
      font-size: 0.7rem;
      color: var(--text-muted);
      background: var(--bg-secondary);
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
    }

    .cluster-error {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cluster-tests {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }

    .cluster-test-name {
      font-size: 0.7rem;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 150px;
    }

    .cluster-files {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.25rem;
    }

    .cluster-file {
      font-family: ${monoFont};
      font-size: 0.65rem;
      color: var(--text-muted);
    }

    .cluster-more {
      font-size: 0.65rem;
      color: var(--text-muted);
      font-style: italic;
    }

    /* ============================================
       OVERVIEW - QUICK INSIGHTS
    ============================================ */
    .insights-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1rem;
    }

    .insight-card {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .insight-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    .insight-icon {
      font-size: 1.5rem;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg-secondary);
      border-radius: 10px;
    }

    .insight-content {
      flex: 1;
      min-width: 0;
    }

    .insight-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 0.25rem;
    }

    .insight-title {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .insight-value {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }

    .insight-mini-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 0.25rem;
    }

    .mini-stat {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      color: var(--text-secondary);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .dot.passed { background: var(--accent-green); }
    .dot.failed { background: var(--accent-red); }
    .dot.skipped { background: var(--text-muted); }

    .mini-sparkline {
      display: flex;
      align-items: flex-end;
      gap: 3px;
      height: 30px;
      margin-top: 0.5rem;
    }

    .spark-col {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: flex-end;
    }

    .spark-bar {
      width: 100%;
      background: var(--accent-green);
      border-radius: 2px;
      min-height: 3px;
      transition: height 0.3s ease;
    }

    .mini-sparkline .no-data {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    /* ============================================
       TESTS VIEW - MASTER-DETAIL LAYOUT
    ============================================ */
    .master-detail-layout {
      display: grid;
      grid-template-columns: 380px 1fr;
      height: 100%;
    }

    .test-list-panel {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      overflow: hidden;
    }

    .test-list-header {
      padding: 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      background: var(--bg-card);
    }

    .test-list-tabs {
      display: flex;
      gap: 0.25rem;
      margin-bottom: 0.75rem;
    }

    .tab-btn {
      font-size: 0.75rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      font-weight: 500;
    }

    .tab-btn:hover {
      background: var(--bg-card);
      color: var(--text-secondary);
    }

    .tab-btn.active {
      background: var(--bg-card);
      color: var(--accent-blue);
      border-color: var(--accent-blue);
    }

    .test-list-search {
      width: 100%;
    }

    .inline-search {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: ${monoFont};
      font-size: 0.8rem;
    }

    .inline-search:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .inline-search::placeholder { color: var(--text-muted); }

    .test-list-content {
      flex: 1;
      overflow-y: auto;
    }

    .test-tab-content {
      display: none;
      padding: 0.5rem;
    }

    .test-tab-content.active { display: block; }

    /* Test List Items */
    .test-list-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      margin-bottom: 0.25rem;
      background: var(--bg-card);
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .test-list-item:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-subtle);
    }

    .test-list-item.selected {
      background: var(--bg-card-hover);
      border-color: var(--accent-blue);
      box-shadow: inset 3px 0 0 var(--accent-blue);
    }

    .test-item-status { flex-shrink: 0; }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .status-dot.passed { background: var(--accent-green); box-shadow: 0 0 8px var(--accent-green); }
    .status-dot.failed { background: var(--accent-red); box-shadow: 0 0 8px var(--accent-red); }
    .status-dot.skipped { background: var(--text-muted); }

    .test-item-info {
      flex: 1;
      min-width: 0;
    }

    .test-item-title {
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .test-item-file {
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .test-item-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .test-item-duration {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .test-item-badge {
      font-family: ${monoFont};
      font-size: 0.6rem;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .test-item-badge.flaky { background: rgba(255, 204, 0, 0.15); color: var(--accent-yellow); }
    .test-item-badge.slow { background: rgba(255, 136, 68, 0.15); color: var(--accent-orange); }
    .test-item-badge.new { background: rgba(0, 170, 255, 0.15); color: var(--accent-blue); }
    
    /* Attention badges - more prominent */
    .test-item-badge.new-failure { 
      background: rgba(255, 68, 102, 0.2); 
      color: var(--accent-red); 
      font-weight: 600;
      animation: pulse-badge 2s ease-in-out infinite;
    }
    .test-item-badge.regression { 
      background: rgba(255, 136, 68, 0.2); 
      color: var(--accent-orange);
      font-weight: 600;
    }
    .test-item-badge.fixed { 
      background: rgba(0, 255, 136, 0.2); 
      color: var(--accent-green);
      font-weight: 600;
    }

    @keyframes pulse-badge {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .stability-badge {
      font-family: ${monoFont};
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
    }

    .stability-badge.grade-a { background: rgba(0, 255, 136, 0.15); color: var(--accent-green); }
    .stability-badge.grade-b { background: rgba(0, 170, 255, 0.15); color: var(--accent-blue); }
    .stability-badge.grade-c { background: rgba(255, 204, 0, 0.15); color: var(--accent-yellow); }
    .stability-badge.grade-d { background: rgba(255, 136, 68, 0.15); color: var(--accent-orange); }
    .stability-badge.grade-f { background: rgba(255, 68, 102, 0.15); color: var(--accent-red); }

    /* Status/Stability Groups */
    .status-group, .stability-group {
      margin-bottom: 1rem;
    }

    .status-group-header, .stability-group-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .status-group-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-group-dot.passed { background: var(--accent-green); }
    .status-group-dot.failed { background: var(--accent-red); }
    .status-group-dot.skipped { background: var(--text-muted); }

    /* Test Detail Panel */
    .test-detail-panel {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      background: var(--bg-primary);
    }

    .detail-placeholder {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      color: var(--text-muted);
    }

    .placeholder-icon { font-size: 4rem; opacity: 0.3; }
    .placeholder-text { font-size: 1.1rem; }
    .placeholder-hint { font-size: 0.85rem; opacity: 0.6; }

    /* Detail View Content (when test is selected) */
    .detail-view-content {
      padding: 1.5rem;
    }

    .detail-view-header {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 1.5rem;
    }

    .detail-status-indicator {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 0.25rem;
    }

    .detail-status-indicator.passed { background: var(--accent-green); box-shadow: 0 0 12px var(--accent-green); }
    .detail-status-indicator.failed { background: var(--accent-red); box-shadow: 0 0 12px var(--accent-red); }
    .detail-status-indicator.skipped { background: var(--text-muted); }

    .detail-info { flex: 1; min-width: 0; }

    .detail-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 0.25rem 0;
      word-break: break-word;
    }

    .detail-file {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .detail-duration {
      font-family: ${monoFont};
      font-size: 1rem;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    /* Make test-card work inside detail panel */
    .test-detail-panel .test-card {
      background: transparent;
      border: none;
      border-radius: 0;
    }

    .test-detail-panel .test-card-header {
      padding: 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
      cursor: default;
    }

    .test-detail-panel .test-details {
      display: block !important;
      padding: 1.5rem;
      background: transparent;
      border-top: none;
    }

    /* ============================================
       SEARCH MODAL
    ============================================ */
    .search-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 1000;
      align-items: flex-start;
      justify-content: center;
      padding-top: 15vh;
    }

    .search-modal.open { display: flex; }

    .search-modal-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
    }

    .search-modal-content {
      position: relative;
      width: 100%;
      max-width: 600px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }

    .search-modal-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .search-modal-icon { font-size: 1.25rem; color: var(--text-muted); }

    .search-modal-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: 1rem;
      font-family: inherit;
    }

    .search-modal-input::placeholder { color: var(--text-muted); }

    .search-modal-esc {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      color: var(--text-muted);
    }

    .search-modal-results {
      max-height: 400px;
      overflow-y: auto;
    }

    .search-result-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: background 0.15s;
    }

    .search-result-item:hover {
      background: var(--bg-card-hover);
    }

    .search-result-item .status-dot { flex-shrink: 0; }

    .search-result-info { flex: 1; min-width: 0; }

    .search-result-title {
      font-size: 0.9rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .search-result-file {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* ============================================
       EXISTING STYLES (preserved from original)
    ============================================ */

    .progress-ring .value {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: ${monoFont};
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent-green);
    }

    /* Trend Chart - Pass Rate Over Time */
    .trend-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: linear-gradient(135deg, var(--bg-card) 0%, var(--bg-secondary) 100%);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      position: relative;
      overflow: hidden;
    }

    .trend-section::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--accent-green), var(--accent-blue));
      opacity: 0.8;
    }

    .trend-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      cursor: pointer;
      user-select: none;
    }

    .trend-header:hover .section-toggle {
      color: var(--text-primary);
    }

    .trend-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .trend-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: ${monoFont};
    }

    .section-toggle {
      color: var(--text-muted);
      font-size: 0.8rem;
      transition: transform 0.2s ease, color 0.2s ease;
      margin-left: 0.5rem;
    }

    .collapsible-section.collapsed .section-toggle {
      transform: rotate(-90deg);
    }

    .collapsible-section.collapsed .section-content {
      display: none;
    }

    .section-content {
      animation: slideDown 0.2s ease;
    }

    .trend-message {
      padding: 1.5rem;
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      text-align: center;
      color: var(--text-secondary);
    }

    .trend-message p {
      margin: 0.5rem 0;
    }

    .trend-message code {
      background: var(--bg-secondary);
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      font-family: ${monoFont};
      font-size: 0.85em;
    }

    .trend-chart {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      height: 140px;
      padding: 20px 16px 12px;
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      position: relative;
    }

    /* Grid lines */
    .trend-chart::before {
      content: '';
      position: absolute;
      left: 8px;
      right: 8px;
      top: 25%;
      border-top: 1px dashed var(--border-subtle);
    }

    .trend-chart::after {
      content: '';
      position: absolute;
      left: 8px;
      right: 8px;
      top: 50%;
      border-top: 1px dashed var(--border-subtle);
    }

    .trend-bar-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 40px;
      max-width: 60px;
      z-index: 1;
    }

    .trend-bar {
      width: 100%;
      background: linear-gradient(180deg, var(--accent-green) 0%, var(--accent-green-dim) 100%);
      border-radius: 6px 6px 2px 2px;
      transition: all 0.3s ease;
      position: relative;
      box-shadow: 0 2px 8px rgba(0, 255, 136, 0.2);
    }

    .trend-bar:hover {
      transform: scaleY(1.02);
      box-shadow: 0 4px 16px rgba(0, 255, 136, 0.3);
    }

    .trend-bar.low {
      background: linear-gradient(180deg, var(--accent-red) 0%, var(--accent-red-dim) 100%);
      box-shadow: 0 2px 8px rgba(255, 68, 102, 0.2);
    }

    .trend-bar.low:hover {
      box-shadow: 0 4px 16px rgba(255, 68, 102, 0.3);
    }

    .trend-bar.medium {
      background: linear-gradient(180deg, var(--accent-yellow) 0%, var(--accent-yellow-dim) 100%);
      box-shadow: 0 2px 8px rgba(255, 204, 0, 0.2);
    }

    .trend-bar.medium:hover {
      box-shadow: 0 4px 16px rgba(255, 204, 0, 0.3);
    }

    .trend-bar.current {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), 0 2px 8px rgba(0, 255, 136, 0.3);
      border: 2px solid var(--text-primary);
    }

    .trend-label {
      font-family: ${monoFont};
      font-size: 0.65rem;
      color: var(--text-muted);
      white-space: nowrap;
      margin-top: 4px;
    }


    /* Stacked Bar Styles */
    .trend-stacked-bar {
      width: 100%;
      display: flex;
      flex-direction: column;
      border-radius: 6px 6px 2px 2px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .trend-segment {
      width: 100%;
      transition: all 0.2s ease;
      position: relative;
      cursor: pointer;
    }

    .trend-segment-label {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-family: ${monoFont};
      font-size: 0.65rem;
      font-weight: 600;
      color: var(--bg-primary);
      background: rgba(0, 0, 0, 0.7);
      padding: 3px 6px;
      border-radius: 4px;
      white-space: nowrap;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 10;
    }

    .trend-segment:hover .trend-segment-label {
      opacity: 1;
    }

    .trend-segment.passed {
      background: linear-gradient(180deg, var(--accent-green) 0%, var(--accent-green-dim) 100%);
    }

    .trend-segment.passed:hover {
      background: linear-gradient(180deg, #00ffaa 0%, var(--accent-green) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.3), 0 0 12px rgba(0, 255, 136, 0.5);
      z-index: 2;
    }

    .trend-segment.passed .trend-segment-label {
      color: var(--accent-green);
    }

    .trend-segment.failed {
      background: linear-gradient(180deg, var(--accent-red) 0%, var(--accent-red-dim) 100%);
    }

    .trend-segment.failed:hover {
      background: linear-gradient(180deg, #ff6688 0%, var(--accent-red) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.3), 0 0 12px rgba(255, 68, 102, 0.5);
      z-index: 2;
    }

    .trend-segment.failed .trend-segment-label {
      color: var(--accent-red);
    }

    .trend-segment.skipped {
      background: linear-gradient(180deg, var(--text-muted) 0%, #444455 100%);
    }

    .trend-segment.skipped:hover {
      background: linear-gradient(180deg, #8888bb 0%, var(--text-muted) 100%);
      box-shadow: inset 0 0 15px rgba(255, 255, 255, 0.2), 0 0 12px rgba(136, 136, 187, 0.4);
      z-index: 2;
    }

    .trend-segment.skipped .trend-segment-label {
      color: #aaaacc;
    }

    .trend-bar-wrapper.current .trend-stacked-bar {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), 0 2px 8px rgba(0, 255, 136, 0.3);
      border: 2px solid var(--text-primary);
    }

    /* Chart Bar Hover Effects */
    .chart-bar {
      cursor: default;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .chart-bar-clickable {
      cursor: pointer;
    }

    .chart-bar:hover {
      opacity: 1 !important;
      filter: brightness(1.1);
    }

    .bar-group {
      cursor: default;
    }

    .bar-group.clickable {
      cursor: pointer;
    }

    .bar-group.clickable:hover .chart-bar {
      transform: translateY(-2px);
      filter: brightness(1.2);
    }

    .bar-group:hover .chart-bar {
      transform: translateY(-2px);
    }

    /* History Banner */
    .history-banner {
      display: none;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      margin-top: 0.75rem;
      background: linear-gradient(135deg, rgba(0, 170, 255, 0.1) 0%, rgba(168, 85, 247, 0.1) 100%);
      border: 1px solid var(--accent-blue-dim);
      border-radius: 8px;
    }

    .history-banner-icon {
      font-size: 1.25rem;
    }

    .history-banner-text {
      flex: 1;
      font-size: 0.85rem;
      color: var(--text-secondary);
    }

    .history-banner-text strong {
      color: var(--accent-blue);
    }

    .history-banner-close {
      padding: 0.4rem 0.75rem;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--accent-blue);
      color: var(--bg-primary);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .history-banner-close:hover {
      filter: brightness(1.1);
    }

    /* Historical test item badge */
    .test-item-badge.historical {
      background: rgba(168, 85, 247, 0.15);
      color: #a855f7;
    }

    .test-list-item.historical-item {
      border-left: 3px solid #a855f7;
    }

    /* Chart Tooltip */
    .chart-tooltip {
      position: absolute;
      display: none;
      background: var(--bg-card);
      color: var(--text-primary);
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--border-subtle);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      pointer-events: none;
      z-index: 10000;
      white-space: nowrap;
    }

    .line-chart-container {
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .chart-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-primary);
      margin: 0 0 1rem 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .all-charts-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1.25rem;
      margin-top: 1rem;
    }

    @media (max-width: 1024px) {
      .all-charts-grid {
        grid-template-columns: 1fr;
      }
    }

    .secondary-trends-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.25rem;
      margin-top: 1rem;
    }

    @media (max-width: 1024px) {
      .secondary-trends-grid {
        grid-template-columns: 1fr;
      }
    }

    /* Secondary Trend Sections (Duration, Flaky, Slow) - Aligned with main trends */
    .secondary-trends {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      margin-top: 1.75rem;
      max-width: 100%;
    }

    .secondary-trend-section {
      background: var(--bg-primary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
      padding: 1rem 0;
      width: 100%;
    }

    .secondary-trend-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.875rem;
      padding: 0 16px;
    }

    .secondary-trend-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .secondary-trend-chart {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      height: 50px;
      padding: 8px 16px 12px;
      overflow-x: auto;
      flex-wrap: nowrap;
      scrollbar-width: auto;
      scrollbar-color: rgba(100, 100, 100, 0.6) rgba(0, 0, 0, 0.08);
    }

    .secondary-trend-chart::-webkit-scrollbar {
      height: 10px;
    }

    .secondary-trend-chart::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.08);
      border-radius: 4px;
    }

    .secondary-trend-chart::-webkit-scrollbar-thumb {
      background: rgba(100, 100, 100, 0.6);
      border-radius: 4px;
      min-width: 40px;
    }

    .secondary-trend-chart::-webkit-scrollbar-thumb:hover {
      background: rgba(100, 100, 100, 0.9);
    }

    /* Force scrollbars to always be visible */
    .secondary-trend-chart::-webkit-scrollbar-button {
      display: none;
    }

    .secondary-bar-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-width: 40px;
      max-width: 60px;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    .secondary-bar-wrapper:hover {
      transform: translateY(-2px);
    }

    .secondary-bar-wrapper:hover .secondary-value {
      color: var(--text-primary);
    }

    .secondary-bar {
      width: 100%;
      border-radius: 6px 6px 2px 2px;
      transition: all 0.2s ease;
    }

    .secondary-bar:hover {
      transform: scaleY(1.05);
    }

    .secondary-bar.current {
      box-shadow: 0 0 20px rgba(0, 255, 136, 0.4), 0 2px 8px rgba(0, 255, 136, 0.3);
      border: 2px solid var(--text-primary);
    }

    /* Duration bars */
    .secondary-bar.duration {
      background: linear-gradient(180deg, var(--accent-purple) 0%, #7744cc 100%);
      box-shadow: 0 2px 8px rgba(170, 102, 255, 0.2);
    }

    .secondary-bar.duration:hover {
      box-shadow: 0 4px 16px rgba(170, 102, 255, 0.3);
      background: linear-gradient(180deg, #bb88ff 0%, var(--accent-purple) 100%);
    }

    /* Flaky bars */
    .secondary-bar.flaky {
      background: linear-gradient(180deg, var(--accent-yellow) 0%, var(--accent-yellow-dim) 100%);
      box-shadow: 0 2px 8px rgba(255, 204, 0, 0.2);
    }

    .secondary-bar.flaky:hover {
      box-shadow: 0 4px 16px rgba(255, 204, 0, 0.3);
      background: linear-gradient(180deg, #ffdd44 0%, var(--accent-yellow) 100%);
    }

    /* Slow bars */
    .secondary-bar.slow {
      background: linear-gradient(180deg, var(--accent-orange) 0%, #cc6633 100%);
      box-shadow: 0 2px 8px rgba(255, 136, 68, 0.2);
    }

    .secondary-bar.slow:hover {
      box-shadow: 0 4px 16px rgba(255, 136, 68, 0.3);
      background: linear-gradient(180deg, #ffaa66 0%, var(--accent-orange) 100%);
    }

    .secondary-value {
      font-family: ${monoFont};
      font-size: 0.6rem;
      color: var(--text-muted);
      margin-top: 4px;
      transition: color 0.2s ease;
    }

    /* Individual Test History Sparkline */
    .history-section {
      display: flex;
      gap: 2rem;
      padding: 1rem;
      background: var(--bg-primary);
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }

    .history-column {
      flex: 1;
    }

	    .history-label {
	      font-size: 0.65rem;
	      text-transform: uppercase;
	      letter-spacing: 0.1em;
	      color: var(--text-muted);
	      margin-bottom: 0.5rem;
	    }

	    .sparkline-block {
	      display: inline-flex;
	      flex-direction: column;
	      align-items: flex-start;
	      width: fit-content;
	    }

	    .sparkline {
	      display: flex;
	      gap: 3px;
	      align-items: center;
	      height: 24px;
    }

    .spark-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      transition: transform 0.2s ease;
      position: relative;
    }

    .spark-dot:hover {
      transform: scale(1.4);
    }

    .spark-dot[data-ts]:hover::after {
      content: attr(data-ts);
      position: absolute;
      bottom: 160%;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-card);
      color: var(--text-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 0.35rem 0.5rem;
      font-size: 0.75rem;
      font-family: ${monoFont};
      white-space: nowrap;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      pointer-events: none;
      z-index: 100000;
    }

    .spark-dot.pass {
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
    }

    .spark-dot.fail {
      background: var(--accent-red);
      box-shadow: 0 0 6px var(--accent-red);
    }

    .spark-dot.skip {
      background: var(--text-muted);
    }

	    .spark-dot.current {
	      width: 10px;
	      height: 10px;
	      border: 2px solid var(--text-primary);
	    }

	    .history-dot {
	      cursor: pointer;
	    }

	    .history-dot.selected {
	      outline: 2px solid rgba(255, 255, 255, 0.85);
	      outline-offset: 2px;
	    }

	    .duration-bar.selected {
	      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.75);
	    }

	    .history-stats.passfail {
	      display: flex;
	      align-items: center;
	      justify-content: space-between;
	      gap: 0.75rem;
	      width: 100%;
	    }

	    .history-back-btn {
	      appearance: none;
	      border: 1px solid var(--border-subtle);
	      background: var(--bg-secondary);
	      color: var(--text-primary);
	      font-size: 0.75rem;
	      font-weight: 600;
	      padding: 0.25rem 0.5rem;
	      border-radius: 8px;
	      cursor: pointer;
	    }

	    .history-back-btn:hover {
	      border-color: var(--border-glow);
	      background: var(--bg-card-hover);
	    }

	    /* Duration Trend Mini Chart */
	    .duration-chart {
	      display: flex;
	      align-items: flex-end;
      gap: 2px;
      height: 32px;
      padding: 4px 0;
    }

    .duration-bar {
      width: 8px;
      min-height: 4px;
      background: var(--accent-blue);
      border-radius: 2px 2px 0 0;
      transition: all 0.2s ease;
    }

    .duration-bar:hover {
      filter: brightness(1.2);
    }

    .duration-bar.current {
      background: var(--accent-purple);
      box-shadow: 0 0 8px var(--accent-purple);
    }

    .duration-bar.slower {
      background: var(--accent-orange);
    }

    .duration-bar.faster {
      background: var(--accent-green);
    }

    .history-stats {
      display: flex;
      gap: 1rem;
      margin-top: 0.5rem;
    }

    .history-stat {
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .history-stat span {
      color: var(--text-secondary);
    }

    /* Filters */
    .filters {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
    }

    .filter-btn {
      font-family: ${monoFont};
      font-size: 0.8rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-card);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .filter-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
      color: var(--text-primary);
    }

    .filter-btn.active {
      background: var(--text-primary);
      color: var(--bg-primary);
      border-color: var(--text-primary);
    }

    /* Stability Score Filters */
    .stability-filters {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: -0.5rem;
    }

    .filter-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-right: 0.5rem;
    }

    .filter-btn.stability-grade {
      min-width: 50px;
    }

    .filter-btn.stability-grade.active {
      box-shadow: 0 0 12px rgba(255, 255, 255, 0.3);
    }

    /* Search Container */
    .search-container {
      margin-bottom: 1rem;
    }

    .search-wrapper {
      position: relative;
    }

    .search-icon {
      position: absolute;
      left: 1rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 0.75rem 1rem;
      padding-left: 2.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: ${monoFont};
      font-size: 0.9rem;
      transition: all 0.2s;
    }

    .search-input:focus {
      outline: none;
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 3px rgba(0, 170, 255, 0.1);
    }

    .search-input::placeholder {
      color: var(--text-muted);
    }

    /* Test Cards */
    .test-list { display: flex; flex-direction: column; gap: 0.75rem; }

    .test-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      overflow: hidden;
      transition: all 0.2s ease;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    /* Allow history tooltips to escape the card when expanded */
    .test-card.expanded {
      overflow: visible;
      position: relative;
      z-index: 1;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .test-card:hover {
      border-color: var(--border-glow);
      background: var(--bg-card-hover);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    }

    .test-card.keyboard-focus {
      border-color: var(--accent-blue);
      box-shadow: 0 0 0 2px rgba(0, 170, 255, 0.3);
      background: var(--bg-card-hover);
    }

    .test-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      cursor: pointer;
      gap: 1rem;
    }

    .test-card-left {
      display: flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
      flex: 1;
    }

    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-indicator.passed {
      background: var(--accent-green);
      box-shadow: 0 0 8px rgba(0, 255, 136, 0.4);
    }

    .status-indicator.failed {
      background: var(--accent-red);
      box-shadow: 0 0 8px rgba(255, 68, 102, 0.5);
    }

    .status-indicator.skipped {
      background: var(--text-muted);
      box-shadow: none;
    }

    .test-info { min-width: 0; flex: 1; }

    .test-title {
      font-weight: 600;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .test-file {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .test-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .test-meta-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .test-badges-row {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex-wrap: wrap;
      margin-top: 0.4rem;
      padding-top: 0.4rem;
      border-top: 1px dashed var(--border-color);
    }

    .badge-separator {
      width: 1px;
      height: 14px;
      background: var(--border-color);
      margin: 0 0.15rem;
      flex-shrink: 0;
    }

    .test-suite-badge {
      font-family: ${monoFont};
      font-size: 0.65rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
    }

    .test-tags {
      display: inline-flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }

    .test-tag {
      font-family: ${monoFont};
      font-size: 0.6rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: var(--accent-blue);
      color: white;
      font-weight: 500;
      white-space: nowrap;
    }

    .test-browser-badge {
      font-family: ${monoFont};
      font-size: 0.6rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: var(--accent-purple);
      color: white;
      font-weight: 500;
      white-space: nowrap;
    }

    .test-project-badge {
      font-family: ${monoFont};
      font-size: 0.6rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: var(--bg-hover);
      border: 1px solid var(--accent-purple);
      color: var(--accent-purple);
      font-weight: 500;
      white-space: nowrap;
    }

    .test-annotation-badge {
      font-family: ${monoFont};
      font-size: 0.6rem;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      background: var(--bg-hover);
      color: var(--text-secondary);
      font-weight: 500;
      white-space: nowrap;
    }

    .test-annotation-badge.annotation-slow {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }

    .test-annotation-badge.annotation-fixme,
    .test-annotation-badge.annotation-fix {
      background: #fce7f3;
      color: #9d174d;
      border: 1px solid #f9a8d4;
    }

    .test-annotation-badge.annotation-skip {
      background: #e0e7ff;
      color: #3730a3;
      border: 1px solid #a5b4fc;
    }

    .test-annotation-badge.annotation-issue,
    .test-annotation-badge.annotation-bug {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }

    .test-annotation-badge.annotation-critical {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #f87171;
    }

    .test-annotation-badge.annotation-experimental {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #6ee7b7;
    }

    .suite-chips .filter-chip,
    .tag-chips .filter-chip {
      background: var(--bg-card);
    }

    .suite-chips .filter-chip.active {
      background: var(--accent-purple);
      color: white;
      border-color: var(--accent-purple);
    }

    .tag-chips .filter-chip.active {
      background: var(--accent-blue);
      color: white;
      border-color: var(--accent-blue);
    }

    .test-card-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .test-duration {
      font-family: ${monoFont};
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .badge {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      border: 1px solid;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .badge.stable {
      color: var(--accent-green);
      border-color: var(--accent-green-dim);
      background: rgba(0, 255, 136, 0.1);
    }

    .badge.unstable {
      color: var(--accent-yellow);
      border-color: var(--accent-yellow-dim);
      background: rgba(255, 204, 0, 0.1);
    }

    .badge.flaky {
      color: var(--accent-red);
      border-color: var(--accent-red-dim);
      background: rgba(255, 68, 102, 0.1);
    }

    .badge.new {
      color: var(--text-muted);
      border-color: var(--border-subtle);
      background: rgba(90, 90, 112, 0.1);
    }

    .badge.skipped {
      color: var(--text-muted);
      border-color: var(--border-subtle);
      background: rgba(90, 90, 112, 0.1);
    }

    .badge.stability-high {
      color: var(--accent-green);
      border-color: var(--accent-green-dim);
      background: rgba(0, 255, 136, 0.1);
      font-weight: 600;
    }

    .badge.stability-medium {
      color: var(--accent-yellow);
      border-color: var(--accent-yellow-dim);
      background: rgba(255, 204, 0, 0.1);
      font-weight: 600;
    }

    .badge.stability-low {
      color: var(--accent-red);
      border-color: var(--accent-red-dim);
      background: rgba(255, 68, 102, 0.1);
      font-weight: 600;
    }

    .trend {
      font-family: ${monoFont};
      font-size: 0.75rem;
    }

    .trend.slower { color: var(--accent-orange); }
    .trend.faster { color: var(--accent-green); }
    .trend.stable { color: var(--text-muted); }

    .expand-icon {
      color: var(--text-muted);
      transition: transform 0.2s ease;
      font-size: 0.75rem;
    }

    .test-card.expanded .expand-icon {
      transform: rotate(90deg);
    }

    /* Test Details */
    .test-details {
      display: none;
      padding: 1rem 1.25rem;
      border-top: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
    }

    .test-card.expanded .test-details {
      display: block;
      animation: slideDown 0.2s ease;
    }

    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .detail-section {
      margin-bottom: 1rem;
    }

    .detail-section:last-child {
      margin-bottom: 0;
    }

    .detail-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .detail-label .icon {
      font-size: 1rem;
    }

    .error-box {
      font-family: ${monoFont};
      font-size: 0.8rem;
      background: rgba(255, 68, 102, 0.1);
      border: 1px solid var(--accent-red-dim);
      border-radius: 8px;
      padding: 1rem;
      color: var(--accent-red);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .stack-box {
      font-family: ${monoFont};
      font-size: 0.75rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text-secondary);
      overflow-x: auto;
      max-height: 200px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .ai-box {
      background: linear-gradient(135deg, rgba(0, 170, 255, 0.1) 0%, rgba(170, 102, 255, 0.1) 100%);
      border: 1px solid var(--accent-blue-dim);
      border-radius: 8px;
      padding: 1rem;
      color: var(--text-primary);
      font-size: 0.9rem;
      position: relative;
    }

    .ai-box::before {
      content: '';
      position: absolute;
      top: -1px;
      left: 20px;
      right: 20px;
      height: 2px;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      border-radius: 2px;
    }

    /* AI Markdown Rendering */
    .ai-markdown p { margin: 0.5rem 0; }
    .ai-markdown p:first-child { margin-top: 0; }
    .ai-markdown p:last-child { margin-bottom: 0; }

    .ai-markdown .ai-heading {
      margin: 0.75rem 0 0.35rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }

    .ai-markdown .ai-h1,
    .ai-markdown .ai-h2 { font-size: 1.05rem; }
    .ai-markdown .ai-h3 { font-size: 1rem; }
    .ai-markdown .ai-h4,
    .ai-markdown .ai-h5,
    .ai-markdown .ai-h6 { font-size: 0.95rem; }

    .ai-markdown .ai-list {
      margin: 0.5rem 0;
      padding-left: 1.25rem;
    }
    .ai-markdown .ai-list li { margin: 0.15rem 0; }

    .ai-markdown .ai-inline-code {
      font-family: ${monoFont};
      font-size: 0.85em;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0.1rem 0.35rem;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .ai-markdown .ai-code-block {
      margin: 0.75rem 0;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      overflow: hidden;
      background: var(--bg-primary);
      position: relative;
    }

    .ai-markdown .ai-code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(0, 0, 0, 0.15);
    }

    .ai-markdown .ai-code-lang {
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .ai-markdown .copy-btn {
      background: transparent;
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: ${monoFont};
    }

    .ai-markdown .copy-btn:hover {
      background: var(--border-subtle);
      color: var(--text-primary);
    }

    .ai-markdown .copy-btn.copied {
      background: var(--accent-green);
      border-color: var(--accent-green);
      color: var(--bg-primary);
    }

    .ai-markdown pre {
      margin: 0;
      padding: 0.85rem 0.95rem;
      overflow-x: auto;
    }

    .ai-markdown pre code {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-secondary);
      white-space: pre;
      display: block;
    }

    /* Network Logs Section */
    .network-logs-section {
      margin-top: 1rem;
    }

    .network-logs-section .detail-label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .network-summary {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-weight: normal;
      margin-left: 0.5rem;
    }

    .network-error-count {
      color: var(--accent-red);
      margin-left: 0.5rem;
    }

    .network-slowest {
      color: var(--accent-orange);
      margin-left: 0.5rem;
    }

    .network-status-summary {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      flex-wrap: wrap;
    }

    .network-status-badge {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
    }

    .network-status-badge.success { border-color: var(--accent-green); color: var(--accent-green); }
    .network-status-badge.redirect { border-color: var(--accent-orange); color: var(--accent-orange); }
    .network-status-badge.error { border-color: var(--accent-red); color: var(--accent-red); }

    .network-entries {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 350px;
      overflow-y: auto;
      padding: 2px;
    }

    .network-entry {
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      overflow: hidden;
      flex-shrink: 0;
    }

    .network-entry.error {
      border-left: 3px solid var(--accent-red);
    }

    .network-entry-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.2s ease;
      min-height: 36px;
      box-sizing: border-box;
    }

    .network-entry-header:hover {
      background: rgba(255, 255, 255, 0.03);
    }

    .network-method {
      font-family: ${monoFont};
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      min-width: 45px;
      text-align: center;
      flex-shrink: 0;
    }

    .network-method.get { background: rgba(59, 130, 246, 0.2); color: #3b82f6; }
    .network-method.post { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
    .network-method.put { background: rgba(249, 115, 22, 0.2); color: #f97316; }
    .network-method.patch { background: rgba(168, 85, 247, 0.2); color: #a855f7; }
    .network-method.delete { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

    .network-url {
      flex: 1;
      min-width: 0;
      font-family: ${monoFont};
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .network-status {
      font-family: ${monoFont};
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .network-status.success { color: var(--accent-green); }
    .network-status.redirect { color: var(--accent-orange); }
    .network-status.error { color: var(--accent-red); }

    .network-duration {
      font-family: ${monoFont};
      font-size: 11px;
      color: var(--text-muted);
      min-width: 50px;
      text-align: right;
      flex-shrink: 0;
    }

    .network-duration.slow {
      color: var(--accent-orange);
    }

    .network-size {
      font-family: ${monoFont};
      font-size: 10px;
      color: var(--text-muted);
      min-width: 50px;
      text-align: right;
      flex-shrink: 0;
    }

    .network-expand-icon {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }

    .network-entry.expanded .network-expand-icon {
      transform: rotate(90deg);
    }

    .network-entry-details {
      padding: 12px;
      background: rgba(0, 0, 0, 0.2);
      border-top: 1px solid var(--border-subtle);
    }

    .network-timing-bar {
      display: flex;
      height: 8px;
      border-radius: 4px;
      overflow: hidden;
      background: var(--border-subtle);
      margin-bottom: 12px;
    }

    .timing-segment {
      height: 100%;
      min-width: 2px;
    }

    .network-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }

    .network-meta-item {
      display: flex;
      gap: 6px;
      font-size: 12px;
    }

    .network-meta-item .meta-label {
      color: var(--text-muted);
    }

    .network-meta-item .meta-value {
      font-family: ${monoFont};
      color: var(--text-secondary);
    }

    .network-body {
      margin-top: 8px;
    }

    .network-body-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .network-body-content {
      font-family: ${monoFont};
      font-size: 11px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 4px;
      padding: 8px;
      margin: 0;
      overflow-x: auto;
      max-height: 150px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .duration-compare {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* Step Timings */
    .steps-container {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .step-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: var(--bg-primary);
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
    }

    .step-row.slowest {
      border-color: var(--accent-orange);
      background: rgba(255, 136, 68, 0.1);
    }

    .step-bar-container {
      flex: 1;
      height: 6px;
      background: var(--border-subtle);
      border-radius: 3px;
      overflow: hidden;
    }

    .step-bar {
      height: 100%;
      background: var(--accent-blue);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .step-row.slowest .step-bar {
      background: var(--accent-orange);
    }

    .step-title {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-secondary);
      min-width: 0;
      flex: 2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .step-row.slowest .step-title {
      color: var(--accent-orange);
    }

    .step-duration {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
      min-width: 60px;
      text-align: right;
    }

    .step-row.slowest .step-duration {
      color: var(--accent-orange);
      font-weight: 600;
    }

    .slowest-badge {
      font-size: 0.65rem;
      padding: 0.15rem 0.4rem;
      background: var(--accent-orange);
      color: var(--bg-primary);
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    /* File Groups */
    .file-group {
      margin-bottom: 1rem;
    }

    .file-group-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 0.5rem;
      transition: all 0.2s;
    }

    .file-group-header:hover {
      border-color: var(--border-glow);
    }

    .file-group-header .expand-icon {
      transition: transform 0.2s;
    }

    .file-group.collapsed .file-group-header .expand-icon {
      transform: rotate(-90deg);
    }

    .file-group-name {
      font-family: ${monoFont};
      font-size: 0.9rem;
      color: var(--text-primary);
      flex: 1;
    }

    .file-group-stats {
      display: flex;
      gap: 0.5rem;
      font-size: 0.75rem;
    }

    .file-group-stat {
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-family: ${monoFont};
    }

    .file-group-stat.passed { color: var(--accent-green); background: rgba(0, 255, 136, 0.1); }
    .file-group-stat.failed { color: var(--accent-red); background: rgba(255, 68, 102, 0.1); }

    .file-group-content {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding-left: 1rem;
    }

    .file-group.collapsed .file-group-content {
      display: none;
    }

    /* Screenshot Display */
    .screenshot-box {
      margin-top: 0.5rem;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border-subtle);
    }

    .screenshot-box img {
      width: 100%;
      height: auto;
      display: block;
      cursor: pointer;
      transition: transform 0.2s;
    }

    .screenshot-box img:hover {
      transform: scale(1.02);
    }

    /* Screenshot fallback for CSP-blocked images */
    .screenshot-fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 2rem;
      background: var(--bg-secondary);
      border: 2px dashed var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .download-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--accent-blue);
      color: white;
      border: none;
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 0.2s;
    }

    .download-btn:hover {
      background: #0095e0;
    }

    /* Gallery fallback for CSP-blocked images */
    .gallery-fallback {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      height: 100%;
      min-height: 120px;
      background: var(--bg-secondary);
      border: 2px dashed var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      font-size: 0.75rem;
    }

    .download-btn-small {
      padding: 0.3rem 0.6rem;
      background: var(--accent-blue);
      color: white;
      border: none;
      border-radius: 4px;
      text-decoration: none;
      font-size: 0.7rem;
      cursor: pointer;
    }

    .download-btn-small:hover {
      background: #0095e0;
    }

    .attachments {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .trace-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .trace-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--bg-primary);
    }

    .trace-meta {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .trace-file {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .trace-file-name {
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .trace-path {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .trace-actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
      padding-top: 0.1rem;
    }

    .trace-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .trace-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.75rem;
      border: 1px solid var(--border-subtle);
      border-radius: 10px;
      background: var(--bg-primary);
    }

    .trace-meta {
      min-width: 0;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .trace-file {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }

    .trace-file-name {
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .trace-path {
      font-family: ${monoFont};
      font-size: 0.75rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .trace-actions {
      display: flex;
      gap: 0.5rem;
      flex-shrink: 0;
      padding-top: 0.1rem;
    }

    .attachment-link {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      color: var(--accent-blue);
      text-decoration: none;
      font-family: ${monoFont};
      font-size: 0.8rem;
      transition: all 0.2s;
    }

    .attachment-link:hover {
      border-color: var(--accent-blue);
      background: rgba(0, 170, 255, 0.1);
    }

    .export-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      color: var(--text-secondary);
      font-family: ${monoFont};
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .export-btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--accent-blue);
      color: var(--accent-blue);
    }

    /* Gallery Styles */
    .gallery-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
    }

    .gallery-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .gallery-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
    }

    .gallery-filters {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .gallery-filter-btn {
      font-family: ${monoFont};
      font-size: 0.75rem;
      padding: 0.4rem 0.8rem;
      border-radius: 6px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .gallery-filter-btn:hover {
      border-color: var(--border-glow);
      color: var(--text-primary);
    }

    .gallery-filter-btn.active {
      background: var(--text-primary);
      color: var(--bg-primary);
      border-color: var(--text-primary);
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }

    .gallery-item {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .gallery-item:hover {
      border-color: var(--border-glow);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .gallery-item-preview {
      position: relative;
      width: 100%;
      height: 150px;
      overflow: hidden;
      background: var(--bg-primary);
    }

    .gallery-item-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .gallery-item-preview.video-preview,
    .gallery-item-preview.trace-preview {
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, var(--bg-secondary), var(--bg-primary));
    }

    .gallery-item-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    .gallery-item:hover .gallery-item-overlay {
      opacity: 1;
    }

    .gallery-item-icon {
      font-size: 2rem;
    }

    .gallery-item-info {
      padding: 0.75rem;
    }

    .gallery-item-title {
      font-size: 0.75rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 0.25rem;
    }

    .gallery-item-status {
      font-family: ${monoFont};
      font-size: 0.65rem;
      padding: 0.2rem 0.4rem;
      border-radius: 4px;
      display: inline-block;
    }

    .gallery-item-status.passed {
      color: var(--accent-green);
      background: rgba(0, 255, 136, 0.1);
    }

    .gallery-item-status.failed {
      color: var(--accent-red);
      background: rgba(255, 68, 102, 0.1);
    }

    .gallery-item-status.skipped {
      color: var(--text-muted);
      background: rgba(90, 90, 112, 0.1);
    }

    .gallery-item-link {
      display: inline-block;
      margin-top: 0.5rem;
      font-size: 0.7rem;
      color: var(--accent-blue);
      text-decoration: none;
    }

    .gallery-item-link:hover {
      text-decoration: underline;
    }

    /* Trace-specific styling */
    .trace-item .gallery-item-preview {
      background: linear-gradient(135deg, #1e3a5f, #0f1922);
    }

    .trace-icon-wrapper {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .trace-file-icon {
      font-size: 2.5rem;
      filter: grayscale(0.3);
    }

    .trace-file-type {
      font-family: ${monoFont};
      font-size: 0.8rem;
      color: var(--accent-blue);
      background: rgba(59, 130, 246, 0.1);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }

    .gallery-trace-download {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      color: var(--text-primary);
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.05));
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 6px;
      text-decoration: none;
      transition: all 0.2s ease;
      font-weight: 500;
    }

    .gallery-trace-download:hover {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(59, 130, 246, 0.15));
      border-color: rgba(59, 130, 246, 0.5);
      transform: translateY(-1px);
    }

    .download-icon {
      font-size: 1rem;
      display: flex;
      align-items: center;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      z-index: 1000;
      justify-content: center;
      align-items: center;
      padding: 2rem;
    }

    .lightbox-close {
      position: absolute;
      top: 2rem;
      right: 2rem;
      font-size: 3rem;
      color: var(--text-primary);
      cursor: pointer;
      line-height: 1;
    }

    .lightbox-content {
      max-width: 90%;
      max-height: 90%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    .lightbox-img {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
      border-radius: 8px;
    }

    .lightbox-info {
      text-align: center;
    }

    .lightbox-test-title {
      font-size: 1.25rem;
      color: var(--text-primary);
      margin-bottom: 0.5rem;
    }

    .lightbox-status {
      font-family: ${monoFont};
      font-size: 0.875rem;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      display: inline-block;
    }

    .lightbox-nav {
      display: flex;
      gap: 1rem;
    }

    .lightbox-prev,
    .lightbox-next {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      color: var(--text-primary);
      font-size: 1.5rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .lightbox-prev:hover,
    .lightbox-next:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
    }

    /* Comparison Styles */
    .comparison-section {
      margin-bottom: 2rem;
      padding: 1.5rem;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
    }

    .comparison-header {
      margin-bottom: 1.5rem;
    }

    .comparison-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 0.25rem;
    }

    .comparison-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: ${monoFont};
    }

    .comparison-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .comparison-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }

    .comparison-card-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-muted);
      margin-bottom: 0.5rem;
    }

    .comparison-card-value {
      font-family: ${monoFont};
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text-primary);
    }

    .comparison-card-value.positive {
      color: var(--accent-green);
    }

    .comparison-card-value.negative {
      color: var(--accent-red);
    }

    .comparison-delta {
      display: block;
      font-size: 0.75rem;
      margin-top: 0.25rem;
      font-weight: 400;
    }

    .comparison-delta.neutral {
      color: var(--text-muted);
    }

    .comparison-details {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .comparison-section-wrapper {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      border-radius: 8px;
      overflow: hidden;
    }

    .comparison-section-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .comparison-section-header:hover {
      background: var(--bg-card-hover);
    }

    .comparison-section-header.failure-section {
      border-left: 3px solid var(--accent-red);
    }

    .comparison-section-header.fixed-section {
      border-left: 3px solid var(--accent-green);
    }

    .comparison-section-header.regression-section {
      border-left: 3px solid var(--accent-orange);
    }

    .comparison-section-header.improvement-section {
      border-left: 3px solid var(--accent-blue);
    }

    .comparison-section-header.new-section {
      border-left: 3px solid var(--accent-purple);
    }

    .comparison-section-title {
      flex: 1;
      font-weight: 600;
      color: var(--text-primary);
    }

    .comparison-section-count {
      font-family: ${monoFont};
      font-size: 0.75rem;
      padding: 0.2rem 0.6rem;
      background: var(--bg-primary);
      border-radius: 4px;
      color: var(--text-secondary);
    }

    .comparison-section-content {
      padding: 0.5rem;
      border-top: 1px solid var(--border-subtle);
    }

    .comparison-item {
      background: var(--bg-primary);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
    }

    .comparison-item:last-child {
      margin-bottom: 0;
    }

    .comparison-item-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .comparison-item-status {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .comparison-item-status.passed {
      background: var(--accent-green);
    }

    .comparison-item-status.failed {
      background: var(--accent-red);
    }

    .comparison-item-status.skipped {
      background: var(--text-muted);
    }

    .comparison-item-info {
      flex: 1;
      min-width: 0;
    }

    .comparison-item-title {
      font-size: 0.875rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .comparison-item-file {
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .comparison-item-duration-badge {
      font-family: ${monoFont};
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      background: var(--bg-secondary);
      border-radius: 4px;
      color: var(--text-secondary);
    }

    .comparison-item-details {
      margin-top: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: ${monoFont};
      font-size: 0.75rem;
    }

    .comparison-item-duration {
      color: var(--text-muted);
    }

    .comparison-item-change {
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
    }

    .comparison-item-change.positive {
      color: var(--accent-green);
      background: rgba(0, 255, 136, 0.1);
    }

    .comparison-item-change.negative {
      color: var(--accent-orange);
      background: rgba(255, 136, 68, 0.1);
    }

    .comparison-item-error {
      margin-top: 0.5rem;
      font-family: ${monoFont};
      font-size: 0.7rem;
      color: var(--accent-red);
      background: rgba(255, 68, 102, 0.1);
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--accent-red-dim);
    }

    /* ============================================
       TOAST NOTIFICATIONS
    ============================================ */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .toast {
      background: var(--bg-card);
      border: 1px solid var(--border-glow);
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transform: translateX(120%);
      opacity: 0;
      transition: transform 0.3s ease, opacity 0.3s ease;
      pointer-events: auto;
      max-width: 320px;
    }

    .toast.show {
      transform: translateX(0);
      opacity: 1;
    }

    .toast-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
    }

    .toast-message {
      font-size: 0.85rem;
      color: var(--text-primary);
    }

    .toast.success { border-color: var(--accent-green); }
    .toast.success .toast-icon { color: var(--accent-green); }
    .toast.error { border-color: var(--accent-red); }
    .toast.error .toast-icon { color: var(--accent-red); }
    .toast.info { border-color: var(--accent-blue); }
    .toast.info .toast-icon { color: var(--accent-blue); }

    /* ============================================
       THEME DROPDOWN
    ============================================ */
    .theme-dropdown {
      position: relative;
      display: inline-block;
    }

    .theme-toggle {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 6px;
      padding: 6px 10px;
      cursor: pointer;
      color: var(--text-secondary);
      font-size: 0.85rem;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .theme-toggle:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-glow);
      color: var(--text-primary);
    }

    .theme-toggle-icon { font-size: 1rem; }
    .theme-label { font-size: 0.8rem; }

    .theme-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--bg-card);
      border: 1px solid var(--border-glow);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 1000;
      min-width: 120px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(-8px);
      transition: all 0.2s ease;
    }

    .theme-dropdown.open .theme-menu {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .theme-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      font-size: 0.85rem;
    }

    .theme-menu-item:first-child { border-radius: 8px 8px 0 0; }
    .theme-menu-item:last-child { border-radius: 0 0 8px 8px; }

    .theme-menu-item:hover {
      background: var(--bg-card-hover);
      color: var(--text-primary);
    }

    .theme-menu-item.active {
      background: var(--bg-card-hover);
      color: var(--accent-blue);
    }

    .theme-menu-item.active::after {
      content: '✓';
      margin-left: auto;
      font-size: 0.9rem;
    }

    @media (max-width: 768px) {
      .theme-label { display: none; }
    }

    /* ============================================
       ACCESSIBILITY - FOCUS INDICATORS
    ============================================ */
    *:focus-visible {
      outline: 2px solid var(--accent-blue);
      outline-offset: 2px;
    }

    button:focus-visible,
    .filter-chip:focus-visible,
    .nav-item:focus-visible,
    .test-card:focus-visible,
    .gallery-item:focus-visible {
      outline: 2px solid var(--accent-blue);
      outline-offset: 2px;
      box-shadow: 0 0 0 4px rgba(0, 170, 255, 0.2);
    }

    /* Skip to main content link for screen readers */
    .skip-link {
      position: absolute;
      top: -40px;
      left: 0;
      background: var(--accent-blue);
      color: white;
      padding: 8px 16px;
      z-index: 10001;
      text-decoration: none;
      font-weight: 600;
      border-radius: 0 0 8px 0;
      transition: top 0.3s ease;
    }

    .skip-link:focus {
      top: 0;
    }

    /* Visually hidden but accessible to screen readers */
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    /* ============================================
       EMPTY STATE UI
    ============================================ */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 2rem;
      text-align: center;
      color: var(--text-muted);
    }

    .empty-state-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .empty-state-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .empty-state-message {
      font-size: 0.9rem;
      max-width: 300px;
      line-height: 1.5;
    }

    .empty-state-action {
      margin-top: 1rem;
      padding: 8px 16px;
      background: var(--accent-blue);
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      transition: background 0.2s ease;
    }

    .empty-state-action:hover {
      background: var(--accent-blue-dim);
    }

    /* ============================================
       MOBILE RESPONSIVE - PERSISTENT SIDEBAR
    ============================================ */
    @media (max-width: 768px) {
      :root {
        --sidebar-width: 200px;
      }

      .app-shell {
        grid-template-columns: var(--sidebar-width) 1fr;
      }

      .app-shell.sidebar-collapsed {
        grid-template-columns: 0 1fr;
      }

      .app-shell.sidebar-collapsed .sidebar {
        transform: translateX(-100%);
      }

      .sidebar {
        width: var(--sidebar-width);
      }

      /* Hide overlay on mobile - sidebar is persistent */
      .sidebar-overlay {
        display: none;
      }

      .top-bar-left .breadcrumbs {
        display: none;
      }

      .search-label, .btn-label, .search-kbd {
        display: none;
      }

      .filter-chips {
        flex-wrap: wrap;
      }

      /* Compact sidebar elements */
      .sidebar-progress {
        padding: 0.75rem;
      }

      .progress-ring-container {
        width: 60px;
        height: 60px;
      }

      .progress-ring {
        width: 60px;
        height: 60px;
      }

      .progress-ring circle {
        cx: 30;
        cy: 30;
        r: 25;
      }

      .progress-ring-value {
        font-size: 0.9rem;
      }

      .nav-item {
        padding: 0.5rem 0.6rem;
        font-size: 0.8rem;
      }

      .nav-icon {
        font-size: 0.9rem;
      }

      .mini-stat {
        padding: 0.4rem;
      }

      .mini-stat-value {
        font-size: 0.85rem;
      }

      .mini-stat-label {
        font-size: 0.55rem;
      }
    }

    /* ============================================
       SMOOTH TRANSITIONS
    ============================================ */
    .test-card,
    .gallery-item,
    .nav-item,
    .filter-chip,
    .sidebar,
    .main-panel {
      transition: all 0.2s ease;
    }

    .view-panel {
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .test-card-details {
      animation: slideDown 0.2s ease;
    }

    @keyframes slideDown {
      from { opacity: 0; max-height: 0; }
      to { opacity: 1; max-height: 2000px; }
    }

    /* ============================================
       PRINT STYLESHEET
    ============================================ */
    @media print {
      body {
        background: white;
        color: black;
        overflow: visible;
        height: auto;
      }

      .app-shell {
        display: block;
      }

      .sidebar,
      .top-bar,
      .filter-chips,
      .search-trigger,
      .theme-toggle,
      .toast-container,
      .lightbox {
        display: none !important;
      }

      .main-panel {
        padding: 0;
        overflow: visible;
        height: auto;
      }

      .test-card {
        break-inside: avoid;
        page-break-inside: avoid;
        border: 1px solid #ccc;
        margin-bottom: 1rem;
      }

      .test-card-details {
        display: block !important;
        max-height: none !important;
      }

      .view-panel {
        display: block !important;
      }

      a {
        text-decoration: underline;
      }

      .progress-ring,
      .trend-section,
      .gallery-section {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }

    /* ============================================
       CSV EXPORT BUTTON
    ============================================ */
    .export-dropdown {
      position: relative;
      display: inline-block;
    }

    .export-menu {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      background: var(--bg-card);
      border: 1px solid var(--border-glow);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 1000;
      min-width: 140px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(-8px);
      transition: all 0.2s ease;
    }

    .export-dropdown.open .export-menu {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .export-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
      font-size: 0.85rem;
    }

    .export-menu-item:first-child {
      border-radius: 8px 8px 0 0;
    }

    .export-menu-item:last-child {
      border-radius: 0 0 8px 8px;
    }

    .export-menu-item:hover {
      background: var(--bg-card-hover);
      color: var(--text-primary);
    }

    /* ============================================
       CI INFO BAR
    ============================================ */
    .ci-info-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 6px 20px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.75rem;
      color: var(--text-secondary);
      font-family: ${monoFont};
    }
    .ci-provider {
      background: var(--accent-blue);
      color: #fff;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.65rem;
      letter-spacing: 0.5px;
    }
    .ci-item { display: flex; align-items: center; gap: 4px; }
    .ci-label { color: var(--text-muted); }
    .ci-info-bar code {
      background: var(--bg-card);
      padding: 1px 6px;
      border-radius: 3px;
      font-family: ${monoFont};
    }

    /* ============================================
       STEP TIMELINE / FLAMECHART
    ============================================ */
    .step-timeline {
      position: relative;
      width: 100%;
      height: 40px;
      background: var(--bg-secondary);
      border-radius: 6px;
      overflow: hidden;
      margin: 8px 0;
      cursor: default;
    }
    .step-timeline-bar {
      position: absolute;
      top: 0;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      color: var(--text-primary);
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      padding: 0 4px;
      transition: opacity 0.15s;
      cursor: pointer;
      border-right: 1px solid var(--bg-primary);
    }
    .step-timeline-bar:hover {
      opacity: 0.85;
      z-index: 1;
      outline: 2px solid var(--text-primary);
    }
    .step-timeline-bar.cat-navigation { background: #3b82f6; }
    .step-timeline-bar.cat-assertion { background: #22c55e; }
    .step-timeline-bar.cat-action { background: #a855f7; }
    .step-timeline-bar.cat-api { background: #f59e0b; }
    .step-timeline-bar.cat-wait { background: #6b7280; }
    .step-timeline-bar.cat-other { background: #64748b; }
    .step-timeline-legend {
      display: flex;
      gap: 12px;
      margin-top: 4px;
      font-size: 0.65rem;
      color: var(--text-muted);
      flex-wrap: wrap;
    }
    .step-timeline-legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .step-timeline-legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }

    /* ============================================
       ENHANCED TREND CHARTS
    ============================================ */
    .trend-moving-avg {
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .chart-anomaly-marker {
      stroke: var(--accent-red);
      stroke-width: 2;
      fill: none;
    }
    .chart-bar-anomaly {
      stroke: var(--accent-red) !important;
      stroke-width: 2 !important;
      stroke-dasharray: 4 2;
    }
    .trend-avg-label {
      font-size: 9px;
      fill: var(--accent-yellow);
      font-style: italic;
    }

    /* ============================================
       FAILURE DIFF VIEW
    ============================================ */
    .diff-container {
      background: var(--bg-secondary);
      border-radius: 8px;
      overflow: hidden;
      margin: 8px 0;
      font-family: ${monoFont};
      font-size: 0.75rem;
      border: 1px solid var(--border-subtle);
    }
    .diff-header {
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      background: var(--bg-card);
      border-bottom: 1px solid var(--border-subtle);
      font-size: 0.7rem;
      color: var(--text-muted);
    }
    .diff-line {
      padding: 2px 12px;
      font-family: ${monoFont};
      font-size: 0.75rem;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .diff-line.diff-expected {
      background: rgba(255, 68, 102, 0.1);
      color: var(--accent-red);
    }
    .diff-line.diff-expected::before {
      content: "- ";
      opacity: 0.5;
    }
    .diff-line.diff-actual {
      background: rgba(0, 255, 136, 0.1);
      color: var(--accent-green);
    }
    .diff-line.diff-actual::before {
      content: "+ ";
      opacity: 0.5;
    }
    .diff-line.diff-same {
      color: var(--text-muted);
    }
    .diff-line.diff-same::before {
      content: "  ";
      opacity: 0.5;
    }

    /* ============================================
       KEYBOARD SHORTCUTS
    ============================================ */
    .keyboard-hints {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 12px;
      padding: 16px 20px;
      font-size: 0.75rem;
      color: var(--text-secondary);
      z-index: 1000;
      display: none;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      max-width: 320px;
    }
    .keyboard-hints.visible { display: block; }
    .keyboard-hints h4 {
      margin: 0 0 8px;
      color: var(--text-primary);
      font-size: 0.8rem;
    }
    .keyboard-hint-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }
    .keyboard-hint-row kbd {
      background: var(--bg-secondary);
      border: 1px solid var(--border-subtle);
      padding: 1px 6px;
      border-radius: 4px;
      font-family: ${monoFont};
      font-size: 0.7rem;
      min-width: 24px;
      text-align: center;
    }

    /* ============================================
       VIRTUAL SCROLLING
    ============================================ */
    .virtual-scroll-container {
      height: calc(100vh - 200px);
      overflow-y: auto;
      position: relative;
    }
    .virtual-scroll-spacer {
      width: 100%;
    }
    .virtual-scroll-viewport {
      position: absolute;
      width: 100%;
    }
    .test-list-item-count {
      padding: 8px 16px;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-subtle);
    }

    /* ============================================
       EXPORTABLE SUMMARY CARD
    ============================================ */
    .summary-export-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .summary-export-modal.visible { display: flex; }
    .summary-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 16px 64px rgba(0,0,0,0.4);
    }
    .summary-card-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    .summary-card-subtitle {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .summary-card-stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 20px;
    }
    .summary-stat {
      text-align: center;
    }
    .summary-stat-value {
      font-size: 1.5rem;
      font-weight: 700;
      font-family: ${monoFont};
    }
    .summary-stat-value.passed { color: var(--accent-green); }
    .summary-stat-value.failed { color: var(--accent-red); }
    .summary-stat-value.rate { color: var(--accent-blue); }
    .summary-stat-label {
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .summary-card-bar {
      height: 8px;
      background: var(--bg-secondary);
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    .summary-card-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s;
    }
    .summary-card-footer {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-top: 16px;
    }
    .summary-card-btn {
      padding: 8px 16px;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
      background: var(--bg-secondary);
      color: var(--text-primary);
      cursor: pointer;
      font-size: 0.8rem;
      font-family: ${primaryFont};
    }
    .summary-card-btn:hover { background: var(--bg-card-hover); }
    .summary-card-btn.primary {
      background: var(--accent-blue);
      color: #fff;
      border-color: var(--accent-blue);
    }

    /* Issue #13: Inline Trace Viewer Styles */
    ${generateTraceViewerStyles(monoFont)}
`;
}

/**
 * Generate all JavaScript for the new app-shell layout
 */
function generateScripts(
  testsJson: string,
  includeGallery: boolean,
  includeComparison: boolean,
  enableTraceViewer: boolean,
  enableHistoryDrilldown: boolean,
  historyRunSnapshotsJson: string,
  statsData: string
): string {
  return `    const tests = ${testsJson};
    const stats = ${statsData};
    const traceViewerEnabled = ${enableTraceViewer ? 'true' : 'false'};
    const historyDrilldownEnabled = ${enableHistoryDrilldown ? 'true' : 'false'};
    const historyRunSnapshots = ${historyRunSnapshotsJson};
    const detailsBodyCache = new WeakMap();
    let currentView = 'overview';
    let selectedTestId = null;
    let currentTestTab = 'all';

    /* ============================================
       APP SHELL NAVIGATION
    ============================================ */

    function toggleSidebar() {
      const appShell = document.querySelector('.app-shell');
      const toggleBtn = document.querySelector('.sidebar-toggle');

      // Same collapse behavior for all screen sizes
      appShell.classList.toggle('sidebar-collapsed');
      const isExpanded = !appShell.classList.contains('sidebar-collapsed');
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function switchView(view) {
      // Update nav items and ARIA states
      document.querySelectorAll('.nav-item').forEach(item => {
        const isActive = item.dataset.view === view;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      // Hide all view panels
      document.querySelectorAll('.view-panel').forEach(panel => {
        panel.style.display = 'none';
      });

      // Show selected view
      const viewPanel = document.getElementById('view-' + view);
      if (viewPanel) {
        viewPanel.style.display = 'block';
      }

      // Update breadcrumb
      const breadcrumbDetail = document.getElementById('breadcrumb-detail');
      if (breadcrumbDetail) {
        breadcrumbDetail.textContent = view.charAt(0).toUpperCase() + view.slice(1);
      }

      currentView = view;
    }

    // Track global historical run selection
    let globalHistoricalRunId = null;
    let globalHistoricalRunLabel = '';

    function loadHistoricalRun(runId, label) {
      if (!historyDrilldownEnabled) {
        alert('History drilldown is not enabled. Set enableHistoryDrilldown: true in reporter options.');
        return;
      }

      const runData = historyRunSnapshots[runId];
      if (!runData || !runData.tests) {
        alert('No snapshot data available for this run. Historical snapshots may not have been saved for this run.');
        return;
      }

      // Set global historical run
      globalHistoricalRunId = runId;
      globalHistoricalRunLabel = label;

      // Show history banner
      showGlobalHistoryBanner(label);

      // Switch to tests view
      switchView('tests');
      switchTestTab('all');

      // Auto-select the first test to show historical data
      const firstTestItem = document.querySelector('.test-list-item');
      if (firstTestItem) {
        const testId = firstTestItem.id.replace('list-item-', '');
        selectTest(testId);
      }
    }

    function showGlobalHistoryBanner(label) {
      const viewHeader = document.querySelector('#view-tests .view-header');
      if (viewHeader) {
        let historyBanner = viewHeader.querySelector('.history-banner');
        if (!historyBanner) {
          historyBanner = document.createElement('div');
          historyBanner.className = 'history-banner';
          viewHeader.appendChild(historyBanner);
        }
        historyBanner.innerHTML = \`
          <span class="history-banner-icon">📅</span>
          <span class="history-banner-text">Viewing run: <strong>\${label}</strong> — Each test shows this run's data. Use per-test history dots to compare.</span>
          <button class="history-banner-close" onclick="exitGlobalHistoricalView()">Back to Current Run</button>
        \`;
        historyBanner.style.display = 'flex';
      }
    }

    function exitGlobalHistoricalView() {
      globalHistoricalRunId = null;
      globalHistoricalRunLabel = '';

      // Hide history banner
      const historyBanner = document.querySelector('.history-banner');
      if (historyBanner) {
        historyBanner.style.display = 'none';
      }

      // Reset all test cards to current state
      document.querySelectorAll('.test-card').forEach(card => {
        const testIdEl = card.querySelector('.history-dot[data-testid]');
        const testId = testIdEl ? testIdEl.getAttribute('data-testid') : null;
        if (testId) {
          resetCardToCurrentState(card, testId);
        }
      });

      // Re-select current test to refresh detail panel
      if (selectedTestId) {
        selectTest(selectedTestId);
      }
    }

    function resetCardToCurrentState(card, testId) {
      const details = card.querySelector('.test-details');
      const body = details ? details.querySelector('[data-details-body]') : null;
      if (body) {
        const original = detailsBodyCache.get(body);
        if (typeof original === 'string') {
          body.innerHTML = original;
        }
      }
      clearSelectedDots(card);
      clearSelectedDurationBars(card);
      showBackButton(card, false);
      restoreTrendUI(card, testId);
    }

    function applyHistoricalRunToCard(card, testId, runId) {
      const runData = getRunSnapshot(runId);
      const snapshot = runData && runData.tests ? runData.tests[testId] : null;
      
      if (!snapshot) {
        // No data for this test in this run - might be a new test
        return false;
      }

      const details = card.querySelector('.test-details');
      const body = details ? details.querySelector('[data-details-body]') : null;
      if (!body) return false;

      // Cache original content
      if (!detailsBodyCache.has(body)) {
        detailsBodyCache.set(body, body.innerHTML);
      }

      // Find and select the appropriate history dot
      const dots = card.querySelectorAll('.history-dot[data-runid]');
      let matchingDot = null;
      dots.forEach(d => {
        if (d.getAttribute('data-runid') === runId) {
          matchingDot = d;
        }
      });

      clearSelectedDots(card);
      clearSelectedDurationBars(card);
      if (matchingDot) {
        matchingDot.classList.add('selected');
      }

      // Render snapshot body
      const testModel = getTestModel(testId);
      const avg = testModel ? computeAvgDurationFromHistory(testModel) : 0;
      body.innerHTML = renderSnapshotBody(snapshot, avg);

      // Update trend UI
      updateTrendUI(card, testId, runId, snapshot.duration);
      showBackButton(card, true);

      return true;
    }

    function switchTestTab(tab) {
      // Update tab buttons and ARIA states
      document.querySelectorAll('.tab-btn').forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      // Hide all tab content
      document.querySelectorAll('.test-tab-content').forEach(content => {
        content.classList.remove('active');
      });

      // Show selected tab
      const tabContent = document.getElementById('tab-' + tab);
      if (tabContent) {
        tabContent.classList.add('active');
      }

      currentTestTab = tab;
    }

    function selectTest(testId) {
      // Update selection in list
      document.querySelectorAll('.test-list-item').forEach(item => {
        item.classList.toggle('selected', item.id === 'list-item-' + testId);
      });

      // Find test data - use same sanitization as TypeScript sanitizeId()
      const test = tests.find(t => {
        const id = String(t.testId || '').replace(/[^a-zA-Z0-9]/g, '_');
        return id === testId;
      });

      if (!test) {
        return;
      }

      selectedTestId = testId;

      // Get the pre-rendered card from hidden container - use getElementById for reliability
      const cardId = 'card-' + testId;
      const cardHtml = document.getElementById(cardId);
      const detailPanel = document.getElementById('test-detail-panel');

      if (cardHtml && detailPanel) {
        // Clone and display the card
        const clone = cardHtml.cloneNode(true);
        clone.classList.add('expanded');
        clone.style.display = 'block';

        // Make sure test-details is visible
        const details = clone.querySelector('.test-details');
        if (details) {
          details.style.display = 'block';
        }

        // Remove expand icon and onclick since card is always expanded in detail panel
        const expandIcon = clone.querySelector('.expand-icon');
        if (expandIcon) expandIcon.remove();
        const header = clone.querySelector('.test-card-header');
        if (header) header.removeAttribute('onclick');

        detailPanel.innerHTML = '';
        detailPanel.appendChild(clone);

        // If global historical run is set, apply it to this card
        // Use test.testId (original) not testId (sanitized) for snapshot lookup
        if (globalHistoricalRunId) {
          applyHistoricalRunToCard(clone, test.testId, globalHistoricalRunId);
        }

        // Update breadcrumb
        const breadcrumbDetail = document.getElementById('breadcrumb-detail');
        if (breadcrumbDetail) {
          breadcrumbDetail.textContent = test.title;
        }
      } else {
        // Fallback: render basic details if card not found
        const detailPanel = document.getElementById('test-detail-panel');
        if (detailPanel) {
          const statusClass = test.status === 'passed' ? 'passed' : test.status === 'skipped' ? 'skipped' : 'failed';
          detailPanel.innerHTML = \`
            <div class="detail-view-content">
              <div class="detail-view-header">
                <div class="detail-status-indicator \${statusClass}"></div>
                <div class="detail-info">
                  <h2 class="detail-title">\${escapeHtmlUnsafe(test.title)}</h2>
                  <div class="detail-file">\${escapeHtmlUnsafe(test.file)}</div>
                </div>
                <div class="detail-duration">\${formatDurationMs(test.duration)}</div>
              </div>
              \${test.error ? \`
                <div class="detail-section">
                  <div class="detail-label"><span class="icon">⚠</span> Error</div>
                  <div class="error-box">\${escapeHtmlUnsafe(test.error)}</div>
                </div>
              \` : ''}
              \${test.steps && test.steps.length > 0 ? \`
                <div class="detail-section">
                  <div class="detail-label"><span class="icon">⏱</span> Steps (\${test.steps.length})</div>
                  <div class="steps-container">
                    \${test.steps.map(step => \`
                      <div class="step-row \${step.isSlowest ? 'slowest' : ''}">
                        <span class="step-title">\${escapeHtmlUnsafe(step.title)}</span>
                        <span class="step-duration">\${formatDurationMs(step.duration)}</span>
                      </div>
                    \`).join('')}
                  </div>
                </div>
              \` : ''}
              \${test.aiSuggestion ? \`
                <div class="detail-section">
                  <div class="detail-label"><span class="icon">🤖</span> AI Suggestion</div>
                  <div class="ai-box">\${escapeHtmlUnsafe(test.aiSuggestion)}</div>
                </div>
              \` : ''}
            </div>
          \`;
        }
      }
    }

    function filterByFile(file) {
      // Clear all filters first
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
      });
      document.querySelector('.filter-chip[data-filter="all"]')?.classList.add('active');

      // Switch to tests view
      switchView('tests');

      // Filter test list items by file
      document.querySelectorAll('.test-list-item').forEach(item => {
        const itemFile = item.dataset.file;
        item.style.display = (itemFile === file) ? 'flex' : 'none';
      });

      // Update active file in tree
      document.querySelectorAll('.file-tree-item').forEach(item => {
        item.classList.toggle('active', item.dataset.file === file);
      });
    }

    function filterByStatus(status) {
      // Switch to tests view first
      switchView('tests');

      // Clear all filters and activate the matching status filter
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
        chip.setAttribute('aria-pressed', 'false');
      });

      // Find and activate the matching status filter chip
      const statusChip = document.querySelector('.filter-chip[data-filter="' + status + '"]');
      if (statusChip) {
        statusChip.classList.add('active');
        statusChip.setAttribute('aria-pressed', 'true');
      }

      // Apply filter to test cards and list items
      applyFilters();
    }

    /* ============================================
       SEARCH FUNCTIONALITY
    ============================================ */

    function openSearch() {
      const modal = document.getElementById('search-modal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('search-modal-input').focus();
    }

    function closeSearch() {
      const modal = document.getElementById('search-modal');
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.getElementById('search-modal-input').value = '';
      document.getElementById('search-modal-results').innerHTML = '';
    }

    function handleSearchInput(query) {
      const resultsContainer = document.getElementById('search-modal-results');
      if (!query.trim()) {
        resultsContainer.innerHTML = '';
        return;
      }

      const lowerQuery = query.toLowerCase();
      const matches = tests.filter(t => {
        return t.title.toLowerCase().includes(lowerQuery) ||
               t.file.toLowerCase().includes(lowerQuery);
      }).slice(0, 10);

      resultsContainer.innerHTML = matches.map(t => {
        const statusClass = t.status === 'passed' ? 'passed' : t.status === 'skipped' ? 'skipped' : 'failed';
        // Use same sanitizeId logic as TypeScript: replace all non-alphanumeric with underscore
        const testId = String(t.testId || '').replace(/[^a-zA-Z0-9]/g, '_');
        return \`
          <div class="search-result-item" onclick="selectSearchResult('\${testId}')">
            <div class="status-dot \${statusClass}"></div>
            <div class="search-result-info">
              <div class="search-result-title">\${escapeHtmlUnsafe(t.title)}</div>
              <div class="search-result-file">\${escapeHtmlUnsafe(t.file)}</div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function selectSearchResult(testId) {
      closeSearch();
      switchView('tests');
      selectTest(testId);
    }

    /* ============================================
       FILTER FUNCTIONALITY (updated for new layout)
    ============================================ */

    function searchTests(query) {
      const lowerQuery = query.toLowerCase();

      // Filter test list items
      document.querySelectorAll('.test-list-item').forEach(item => {
        const title = item.querySelector('.test-item-title')?.textContent?.toLowerCase() || '';
        const file = item.querySelector('.test-item-file')?.textContent?.toLowerCase() || '';
        const matches = title.includes(lowerQuery) || file.includes(lowerQuery);
        item.style.display = matches ? 'flex' : 'none';
      });

      // Also handle old test-card format for grouped view
      document.querySelectorAll('.test-card').forEach(card => {
        const title = card.querySelector('.test-title')?.textContent?.toLowerCase() || '';
        const file = card.querySelector('.test-file')?.textContent?.toLowerCase() || '';
        const matches = title.includes(lowerQuery) || file.includes(lowerQuery);
        card.style.display = matches ? 'block' : 'none';
      });

      // Also show/hide file groups if all tests are hidden
      document.querySelectorAll('.file-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.test-card')).some(
          card => card.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });

      // Check for empty state
      checkEmptyState();
    }

    // Active filters state - organized by group
    const activeFilters = {
      attention: new Set(),
      status: new Set(),
      health: new Set(),
      grade: new Set(),
      suite: new Set(),
      tag: new Set()
    };

    function toggleFilter(chip) {
      const filter = chip.dataset.filter;
      const group = chip.dataset.group;

      // Toggle the filter in the appropriate group
      if (activeFilters[group].has(filter)) {
        activeFilters[group].delete(filter);
        chip.classList.remove('active');
        chip.setAttribute('aria-pressed', 'false');
      } else {
        activeFilters[group].add(filter);
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
      }

      applyFilters();
    }

    function clearAllFilters() {
      activeFilters.attention.clear();
      activeFilters.status.clear();
      activeFilters.health.clear();
      activeFilters.grade.clear();
      activeFilters.suite.clear();
      activeFilters.tag.clear();
      document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.classList.remove('active');
        chip.setAttribute('aria-pressed', 'false');
      });
      applyFilters();
    }

    function applyFilters() {
      const hasAttentionFilters = activeFilters.attention.size > 0;
      const hasStatusFilters = activeFilters.status.size > 0;
      const hasHealthFilters = activeFilters.health.size > 0;
      const hasGradeFilters = activeFilters.grade.size > 0;
      const hasSuiteFilters = activeFilters.suite.size > 0;
      const hasTagFilters = activeFilters.tag.size > 0;
      const hasAnyFilter = hasAttentionFilters || hasStatusFilters || hasHealthFilters || hasGradeFilters || hasSuiteFilters || hasTagFilters;

      // Helper to check if element matches suite filter
      function matchesSuiteFilter(el) {
        if (!hasSuiteFilters) return true;
        const suiteData = el.dataset.suite || '';
        const suitesData = el.dataset.suites || '';
        for (const filter of activeFilters.suite) {
          const suiteName = filter.replace('suite-', '');
          if (suiteData === suiteName || suitesData.split(',').includes(suiteName)) return true;
        }
        return false;
      }

      // Helper to check if element matches tag filter
      function matchesTagFilter(el) {
        if (!hasTagFilters) return true;
        const tagsData = el.dataset.tags || '';
        const tags = tagsData.split(',').filter(t => t);
        for (const filter of activeFilters.tag) {
          const tagName = filter.replace('tag-', '');
          if (tags.includes(tagName)) return true;
        }
        return false;
      }

      // Filter test list items
      document.querySelectorAll('.test-list-item').forEach(item => {
        const status = item.dataset.status;
        const isFlaky = item.dataset.flaky === 'true';
        const isSlow = item.dataset.slow === 'true';
        const isNew = item.dataset.new === 'true';
        const isNewFailure = item.dataset.newFailure === 'true';
        const isRegression = item.dataset.regression === 'true';
        const isFixed = item.dataset.fixed === 'true';
        const grade = item.dataset.grade;

        // If no filters active, show all
        if (!hasAnyFilter) {
          item.style.display = 'flex';
          return;
        }

        // Check each filter group (OR within group, AND between groups)
        let matchesAttention = !hasAttentionFilters;
        let matchesStatus = !hasStatusFilters;
        let matchesHealth = !hasHealthFilters;
        let matchesGrade = !hasGradeFilters;

        // Attention group - OR logic
        if (hasAttentionFilters) {
          matchesAttention =
            (activeFilters.attention.has('new-failure') && isNewFailure) ||
            (activeFilters.attention.has('regression') && isRegression) ||
            (activeFilters.attention.has('fixed') && isFixed);
        }

        // Status group - OR logic
        if (hasStatusFilters) {
          matchesStatus =
            (activeFilters.status.has('passed') && status === 'passed') ||
            (activeFilters.status.has('failed') && (status === 'failed' || status === 'timedOut')) ||
            (activeFilters.status.has('skipped') && status === 'skipped');
        }

        // Health group - OR logic
        if (hasHealthFilters) {
          matchesHealth =
            (activeFilters.health.has('flaky') && isFlaky) ||
            (activeFilters.health.has('slow') && isSlow) ||
            (activeFilters.health.has('new') && isNew);
        }

        // Grade group - OR logic
        if (hasGradeFilters) {
          matchesGrade =
            (activeFilters.grade.has('grade-a') && grade === 'A') ||
            (activeFilters.grade.has('grade-b') && grade === 'B') ||
            (activeFilters.grade.has('grade-c') && grade === 'C') ||
            (activeFilters.grade.has('grade-d') && grade === 'D') ||
            (activeFilters.grade.has('grade-f') && grade === 'F');
        }

        // Suite and Tag groups
        const matchesSuite = matchesSuiteFilter(item);
        const matchesTag = matchesTagFilter(item);

        // AND between groups
        const show = matchesAttention && matchesStatus && matchesHealth && matchesGrade && matchesSuite && matchesTag;
        item.style.display = show ? 'flex' : 'none';
      });

      // Also filter test-cards in hidden container and file groups
      document.querySelectorAll('.test-card').forEach(card => {
        const status = card.dataset.status;
        const isFlaky = card.dataset.flaky === 'true';
        const isSlow = card.dataset.slow === 'true';
        const isNew = card.dataset.new === 'true';
        const isNewFailure = card.dataset.newFailure === 'true';
        const isRegression = card.dataset.regression === 'true';
        const isFixed = card.dataset.fixed === 'true';
        const grade = card.dataset.grade;

        if (!hasAnyFilter) {
          card.style.display = 'block';
          return;
        }

        let matchesAttention = !hasAttentionFilters;
        let matchesStatus = !hasStatusFilters;
        let matchesHealth = !hasHealthFilters;
        let matchesGrade = !hasGradeFilters;

        if (hasAttentionFilters) {
          matchesAttention =
            (activeFilters.attention.has('new-failure') && isNewFailure) ||
            (activeFilters.attention.has('regression') && isRegression) ||
            (activeFilters.attention.has('fixed') && isFixed);
        }

        if (hasStatusFilters) {
          matchesStatus =
            (activeFilters.status.has('passed') && status === 'passed') ||
            (activeFilters.status.has('failed') && (status === 'failed' || status === 'timedOut')) ||
            (activeFilters.status.has('skipped') && status === 'skipped');
        }

        if (hasHealthFilters) {
          matchesHealth =
            (activeFilters.health.has('flaky') && isFlaky) ||
            (activeFilters.health.has('slow') && isSlow) ||
            (activeFilters.health.has('new') && isNew);
        }

        if (hasGradeFilters) {
          matchesGrade =
            (activeFilters.grade.has('grade-a') && grade === 'A') ||
            (activeFilters.grade.has('grade-b') && grade === 'B') ||
            (activeFilters.grade.has('grade-c') && grade === 'C') ||
            (activeFilters.grade.has('grade-d') && grade === 'D') ||
            (activeFilters.grade.has('grade-f') && grade === 'F');
        }

        // Suite and Tag groups
        const matchesSuite = matchesSuiteFilter(card);
        const matchesTag = matchesTagFilter(card);

        const show = matchesAttention && matchesStatus && matchesHealth && matchesGrade && matchesSuite && matchesTag;
        card.style.display = show ? 'block' : 'none';
      });

      // Update group visibility
      document.querySelectorAll('.file-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.test-list-item, .test-card')).some(
          el => el.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });

      // Clear file tree selection
      document.querySelectorAll('.file-tree-item').forEach(item => {
        item.classList.remove('active');
      });

      // Check for empty state
      checkEmptyState();
    }

    function checkEmptyState() {
      const visibleItems = document.querySelectorAll('.test-list-item:not([style*="display: none"])');
      const emptyState = document.getElementById('emptyState');
      const tabs = document.querySelectorAll('.test-tab-content');

      if (visibleItems.length === 0) {
        emptyState.style.display = 'flex';
        tabs.forEach(tab => tab.style.opacity = '0.3');
      } else {
        emptyState.style.display = 'none';
        tabs.forEach(tab => tab.style.opacity = '1');
      }
    }

    // Legacy single-filter function for backward compatibility
    function filterTests(filter) {
      switchView('tests');
      clearAllFilters();
      if (filter !== 'all') {
        const chip = document.querySelector('.filter-chip[data-filter="' + filter + '"]');
        if (chip) toggleFilter(chip);
      }
    }

    /* ============================================
       KEYBOARD SHORTCUTS
    ============================================ */

    document.addEventListener('keydown', (e) => {
      // Ignore if typing in input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          closeSearch();
        }
        return;
      }

      // Command/Ctrl + K for search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openSearch();
        return;
      }

      // Command/Ctrl + B for sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Escape to close search
      if (e.key === 'Escape') {
        closeSearch();
      }

      // Arrow navigation in test list
      if (currentView === 'tests') {
        const items = Array.from(document.querySelectorAll('.test-list-item:not([style*="display: none"])'));
        const selectedItem = document.querySelector('.test-list-item.selected');
        let currentIndex = selectedItem ? items.indexOf(selectedItem) : -1;

        if (e.key === 'ArrowDown' || e.key === 'j') {
          e.preventDefault();
          currentIndex = Math.min(currentIndex + 1, items.length - 1);
          if (items[currentIndex]) {
            const testId = items[currentIndex].id.replace('list-item-', '');
            selectTest(testId);
            items[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        } else if (e.key === 'ArrowUp' || e.key === 'k') {
          e.preventDefault();
          currentIndex = Math.max(currentIndex - 1, 0);
          if (items[currentIndex]) {
            const testId = items[currentIndex].id.replace('list-item-', '');
            selectTest(testId);
            items[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      }

      // Old keyboard nav for test cards
      const cards = Array.from(document.querySelectorAll('.test-card:not([style*="display: none"])'));
      const focused = document.querySelector('.test-card.keyboard-focus');
      let currentIndex = focused ? cards.indexOf(focused) : -1;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        if (cards.length > 0 && !document.querySelector('.test-list-item.selected')) {
          e.preventDefault();
          if (focused) focused.classList.remove('keyboard-focus');
          currentIndex = Math.min(currentIndex + 1, cards.length - 1);
          if (cards[currentIndex]) {
            cards[currentIndex].classList.add('keyboard-focus');
            cards[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        if (cards.length > 0 && !document.querySelector('.test-list-item.selected')) {
          e.preventDefault();
          if (focused) focused.classList.remove('keyboard-focus');
          currentIndex = Math.max(currentIndex - 1, 0);
          if (cards[currentIndex]) {
            cards[currentIndex].classList.add('keyboard-focus');
            cards[currentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
        }
      } else if (e.key === 'Enter' && focused) {
        e.preventDefault();
        const header = focused.querySelector('.test-card-header');
        if (header) header.click();
      } else if (e.key === 'Escape' && focused) {
        focused.classList.remove('keyboard-focus');
      }
    });

    /* ============================================
       EXISTING FUNCTIONS (preserved)
    ============================================ */

    function toggleDetails(id, event) {
      // If called from click event, find the parent card from the clicked element
      // This handles cloned cards in the detail panel that share the same ID
      let card;
      if (event && event.currentTarget) {
        card = event.currentTarget.closest('.test-card');
      }
      if (!card) {
        card = document.getElementById('card-' + id);
      }
      if (card) {
        card.classList.toggle('expanded');
      }
    }

    function toggleGroup(groupId) {
      const group = document.getElementById('group-' + groupId);
      group.classList.toggle('collapsed');
    }

    function toggleSection(sectionId) {
      const section = document.getElementById(sectionId);
      if (section) {
        section.classList.toggle('collapsed');
      }
    }

    function toggleNetworkEntry(entryId) {
      const entry = document.querySelector('[data-entry-id="' + entryId + '"]');
      const details = document.getElementById(entryId + '-details');
      if (entry && details) {
        entry.classList.toggle('expanded');
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
      }
    }

    function copyCode(codeId, btn) {
      const codeEl = document.getElementById(codeId);
      if (!codeEl) return;

      const text = codeEl.textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        showToast('Copied to clipboard', 'success');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(() => {
        btn.textContent = 'Failed';
        showToast('Failed to copy', 'error');
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    }

    function exportJSON() {
      const data = {
        timestamp: new Date().toISOString(),
        summary: {
          total: tests.length,
          passed: tests.filter(t => t.status === 'passed').length,
          failed: tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length,
          skipped: tests.filter(t => t.status === 'skipped').length,
        },
        tests: tests
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'test-results-' + new Date().toISOString().split('T')[0] + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('JSON exported successfully', 'success');
      closeExportMenu();
    }

    // CSV Export
    function exportCSV() {
      const headers = ['Title', 'File', 'Status', 'Duration (ms)', 'Flakiness Score', 'Stability Grade', 'Retries'];
      const rows = tests.map(t => [
        '"' + (t.title || '').replace(/"/g, '""') + '"',
        '"' + (t.file || '').replace(/"/g, '""') + '"',
        t.status || '',
        t.duration || 0,
        t.flakinessScore || '',
        t.stabilityScore?.grade || '',
        t.retry || 0
      ]);

      const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'test-results-' + new Date().toISOString().split('T')[0] + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('CSV exported successfully', 'success');
      closeExportMenu();
    }

    // Export menu toggle
    function toggleExportMenu() {
      const dropdown = document.getElementById('exportDropdown');
      const btn = dropdown.querySelector('.top-bar-btn');
      dropdown.classList.toggle('open');
      btn.setAttribute('aria-expanded', dropdown.classList.contains('open'));
    }

    function closeExportMenu() {
      const dropdown = document.getElementById('exportDropdown');
      const btn = dropdown.querySelector('.top-bar-btn');
      dropdown.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    // Close export menu when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('exportDropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        closeExportMenu();
      }
    });

    // Toast notifications
    function showToast(message, type = 'info') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;

      const icons = { success: '✓', error: '✗', info: 'ℹ' };
      toast.innerHTML = '<span class="toast-icon">' + (icons[type] || icons.info) + '</span><span class="toast-message">' + message + '</span>';

      container.appendChild(toast);

      // Trigger animation
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });

      // Remove after delay
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    // Theme dropdown menu
    function toggleThemeMenu() {
      const dropdown = document.getElementById('themeDropdown');
      const btn = dropdown.querySelector('.theme-toggle');
      dropdown.classList.toggle('open');
      btn.setAttribute('aria-expanded', dropdown.classList.contains('open'));
    }

    function closeThemeMenu() {
      const dropdown = document.getElementById('themeDropdown');
      const btn = dropdown.querySelector('.theme-toggle');
      dropdown.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }

    // Close theme menu when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('themeDropdown');
      if (dropdown && !dropdown.contains(e.target)) {
        closeThemeMenu();
      }
    });

    function setTheme(theme) {
      const root = document.documentElement;
      const icon = document.getElementById('themeIcon');
      const label = document.getElementById('themeLabel');

      // Update active state in menu
      document.querySelectorAll('.theme-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.theme === theme);
      });

      if (theme === 'light') {
        root.setAttribute('data-theme', 'light');
        icon.textContent = '☀️';
        label.textContent = 'Light';
        localStorage.setItem('theme', 'light');
        showToast('Light theme', 'info');
      } else if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        icon.textContent = '🌙';
        label.textContent = 'Dark';
        localStorage.setItem('theme', 'dark');
        showToast('Dark theme', 'info');
      } else {
        // System/auto
        root.removeAttribute('data-theme');
        icon.textContent = '💻';
        label.textContent = 'System';
        localStorage.setItem('theme', 'system');
        showToast('Using system theme', 'info');
      }

      closeThemeMenu();
    }

    // Initialize theme from localStorage
    (function initTheme() {
      const saved = localStorage.getItem('theme') || 'system';
      const icon = document.getElementById('themeIcon');
      const label = document.getElementById('themeLabel');

      // Update active state in menu
      document.querySelectorAll('.theme-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.theme === saved);
      });

      if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        if (icon) icon.textContent = '☀️';
        if (label) label.textContent = 'Light';
      } else if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (icon) icon.textContent = '🌙';
        if (label) label.textContent = 'Dark';
      } else {
        // System - CSS handles via prefers-color-scheme
        if (icon) icon.textContent = '💻';
        if (label) label.textContent = 'System';
      }
    })();

    // Auto-scroll secondary charts to show most recent run
    function scrollChartsToRight() {
      document.querySelectorAll('.secondary-trend-chart').forEach(chart => {
        chart.scrollLeft = chart.scrollWidth;
      });
    }

    function escapeHtmlUnsafe(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

	    function formatDurationMs(ms) {
	      const n = Number(ms) || 0;
	      if (n < 1000) return Math.round(n) + 'ms';
	      if (n < 60000) return (n / 1000).toFixed(1) + 's';
	      return (n / 60000).toFixed(1) + 'm';
	    }

	    function getRunSnapshot(runId) {
	      if (!historyRunSnapshots || !runId) return null;
	      return historyRunSnapshots[runId] || null;
	    }

	    function renderSnapshotBody(snapshot, avgDuration) {
	      const parts = [];

	      if (snapshot.steps && snapshot.steps.length > 0) {
	        const max = snapshot.steps.reduce((m, s) => Math.max(m, Number(s.duration) || 0), 0) || 1;
	        const rows = snapshot.steps.map(step => {
	          const w = Math.max(0, Math.min(100, ((Number(step.duration) || 0) / max) * 100));
	          const slowest = step && step.isSlowest ? true : false;
	          return (
	            '<div class="step-row' + (slowest ? ' slowest' : '') + '">' +
	              '<span class="step-title" title="' + escapeHtmlUnsafe(step.title) + '">' + escapeHtmlUnsafe(step.title) + '</span>' +
	              '<div class="step-bar-container"><div class="step-bar" style="width: ' + w.toFixed(1) + '%"></div></div>' +
	              '<span class="step-duration">' + escapeHtmlUnsafe(formatDurationMs(step.duration)) + '</span>' +
	              (slowest ? '<span class="slowest-badge">Slowest</span>' : '') +
	            '</div>'
	          );
	        }).join('');
        parts.push(
          '<div class="detail-section">' +
            '<div class="detail-label"><span class="icon">⏱</span> Step Timings</div>' +
            '<div class="steps-container">' + rows + '</div>' +
	          '</div>'
	        );
	      }

	      if (snapshot.error) {
	        parts.push(
	          '<div class="detail-section">' +
	            '<div class="detail-label"><span class="icon">⚠</span> Error</div>' +
	            '<div class="error-box">' + escapeHtmlUnsafe(snapshot.error) + '</div>' +
	          '</div>'
	        );
	      }

	      if (snapshot.attachments && snapshot.attachments.screenshots && snapshot.attachments.screenshots.length > 0) {
	        const first = snapshot.attachments.screenshots[0];
	        parts.push(
	          '<div class="detail-section">' +
            '<div class="detail-label"><span class="icon">📸</span> Screenshot</div>' +
            '<div class="screenshot-box">' +
              '<img src="' + escapeHtmlUnsafe(first) + '" alt="Screenshot" onclick="window.open(this.src, \\'_blank\\')" onerror="this.style.display=\\'none\\'; this.nextElementSibling.style.display=\\'flex\\';"/>' +
              '<div class="screenshot-fallback" style="display:none;">' +
                '<span>Image blocked by security policy</span>' +
                '<a href="' + escapeHtmlUnsafe(first) + '" download class="download-btn">Download Screenshot</a>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }

      if (snapshot.attachments && snapshot.attachments.videos && snapshot.attachments.videos.length > 0) {
        parts.push(
          '<div class="detail-section">' +
            '<div class="detail-label"><span class="icon">📎</span> Attachments</div>' +
            '<div class="attachments">' +
              '<a href="file://' + escapeHtmlUnsafe(snapshot.attachments.videos[0]) + '" class="attachment-link" target="_blank">🎬 Video</a>' +
            '</div>' +
          '</div>'
        );
      }

	      if (snapshot.aiSuggestion) {
	        const aiHtml = snapshot.aiSuggestionHtml
	          ? String(snapshot.aiSuggestionHtml)
	          : escapeHtmlUnsafe(snapshot.aiSuggestion);
	        parts.push(
	          '<div class="detail-section">' +
	            '<div class="detail-label"><span class="icon">🤖</span> AI Suggestion</div>' +
	            '<div class="ai-box ai-markdown">' + aiHtml + '</div>' +
	          '</div>'
	        );
	      }

	      if (Number.isFinite(Number(avgDuration)) && Number(avgDuration) > 0) {
	        parts.push(
	          '<div class="duration-compare">Average: ' +
	            escapeHtmlUnsafe(formatDurationMs(avgDuration)) +
	            ' → Current: ' +
	            escapeHtmlUnsafe(formatDurationMs(snapshot.duration)) +
	          '</div>'
	        );
	      }

	      if (parts.length === 0) {
	        parts.push('<div class="duration-compare">No additional data recorded for this run.</div>');
	      }

	      return parts.join('');
	    }

	    function showBackButton(card, show) {
	      const btn = card.querySelector('.history-back-btn');
	      if (!btn) return;
	      btn.style.display = show ? 'inline-flex' : 'none';
	    }

	    function clearSelectedDots(card) {
	      card.querySelectorAll('.history-dot.selected').forEach(d => d.classList.remove('selected'));
	    }

	    function clearSelectedDurationBars(card) {
	      card.querySelectorAll('.duration-bar.selected').forEach(b => b.classList.remove('selected'));
	    }

	    function getTestModel(testId) {
	      return tests.find(t => t && t.testId === testId) || null;
	    }

	    function computeAvgDurationFromHistory(testModel) {
	      const history = Array.isArray(testModel.history) ? testModel.history : [];
	      const nonSkipped = history.filter(h => !h.skipped);
	      if (nonSkipped.length === 0) return 0;
	      return nonSkipped.reduce((sum, h) => sum + (Number(h.duration) || 0), 0) / nonSkipped.length;
	    }

	    function updateTrendUI(card, testId, runId, selectedDuration) {
	      const testModel = getTestModel(testId);
	      if (!testModel) return;

	      const avg = computeAvgDurationFromHistory(testModel);
	      const avgEl = card.querySelector('[data-role="avg-duration"]');
	      const curEl = card.querySelector('[data-role="current-duration"]');
	      if (avgEl) avgEl.textContent = formatDurationMs(avg);
	      if (curEl) curEl.textContent = formatDurationMs(selectedDuration);

	      // Highlight the selected history duration bar (if present)
	      clearSelectedDurationBars(card);
	      if (runId) {
	        const selectedBar = card.querySelector('.duration-bar.history-duration[data-runid="' + CSS.escape(runId) + '"]');
	        if (selectedBar) selectedBar.classList.add('selected');
	      }
	    }

	    function restoreTrendUI(card, testId) {
	      const testModel = getTestModel(testId);
	      if (!testModel) return;

	      const avg = computeAvgDurationFromHistory(testModel);
	      const avgEl = card.querySelector('[data-role="avg-duration"]');
	      const curEl = card.querySelector('[data-role="current-duration"]');
	      if (avgEl) avgEl.textContent = formatDurationMs(avg);
	      if (curEl) curEl.textContent = formatDurationMs(testModel.duration);

	      clearSelectedDurationBars(card);
	    }

	    async function handleHistoryDotClick(dot) {
	      const runId = dot.getAttribute('data-runid');
	      const testId = dot.getAttribute('data-testid');
	      if (!runId || !testId) return;
	      const card = dot.closest('.test-card');
      if (!card) return;
      const details = card.querySelector('.test-details');
      const body = details ? details.querySelector('[data-details-body]') : null;
      if (!body) return;

      if (!detailsBodyCache.has(body)) {
        detailsBodyCache.set(body, body.innerHTML);
      }

	      const runData = getRunSnapshot(runId);
	      const snapshot = runData && runData.tests ? runData.tests[testId] : null;
	      if (!snapshot) {
	        alert('No stored snapshot for this test/run. (Older runs may have stored snapshots for failures only.)');
	        return;
	      }

	      clearSelectedDots(card);
	      clearSelectedDurationBars(card);
	      dot.classList.add('selected');
	      showBackButton(card, true);
	      const testModel = getTestModel(testId);
	      const avg = testModel ? computeAvgDurationFromHistory(testModel) : 0;
	      body.innerHTML = renderSnapshotBody(snapshot, avg);

	      // Sync Duration Trend UI to the selected run.
	      updateTrendUI(card, testId, runId, snapshot.duration);
	    }

	    function handleHistoryBackClick(btn) {
	      const card = btn.closest('.test-card');
	      if (!card) return;
	      const details = card.querySelector('.test-details');
	      const body = details ? details.querySelector('[data-details-body]') : null;
	      if (!body) return;
	      const testId = card.querySelector('.history-dot[data-testid]')?.getAttribute('data-testid') || null;
	      const original = detailsBodyCache.get(body);
	      if (typeof original === 'string') {
	        body.innerHTML = original;
	      }
	      clearSelectedDots(card);
	      clearSelectedDurationBars(card);
	      showBackButton(card, false);

	      if (testId) {
	        restoreTrendUI(card, testId);
	      }
	    }

	    function initHistoryDrilldown() {
	      if (!historyDrilldownEnabled) return;

	      document.addEventListener('click', async (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;

        const backBtn = t.closest('[data-action="history-back"]');
        if (backBtn) {
          e.preventDefault();
          handleHistoryBackClick(backBtn);
          return;
        }

	        const dot = t.closest('.history-dot[data-runid]');
	        if (dot) {
	          e.preventDefault();
	          handleHistoryDotClick(dot).catch(err => {
	            console.error(err);
	            alert('Unable to load historical run data.');
	          });
	        }
	      });
	    }

    // Run on page load
    window.addEventListener('DOMContentLoaded', () => {
      scrollChartsToRight();
      initHistoryDrilldown();
      if (!traceViewerEnabled) {
        document.querySelectorAll('[data-trace]').forEach(el => {
          el.style.display = 'none';
        });
      }
    });

${includeGallery ? `    // Gallery functions\n${generateGalleryScript()}` : ''}

${includeComparison ? `    // Comparison functions\n${generateComparisonScript()}` : ''}

    // Chart bar tooltips
    (function initChartTooltips() {
      const tooltip = document.createElement('div');
      tooltip.className = 'chart-tooltip';
      document.body.appendChild(tooltip);

      document.querySelectorAll('.bar-group').forEach(bar => {
        bar.addEventListener('mouseenter', (e) => {
          const text = bar.getAttribute('data-tooltip');
          if (text) {
            tooltip.textContent = text;
            tooltip.style.display = 'block';
          }
        });

        bar.addEventListener('mousemove', (e) => {
          tooltip.style.left = e.pageX + 10 + 'px';
          tooltip.style.top = e.pageY - 30 + 'px';
        });

        bar.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });
      });
    })();

    /* ============================================
       VIRTUAL SCROLLING / PAGINATION
    ============================================ */
    (function initVirtualScroll() {
      const PAGE_SIZE = 50;
      const listContainer = document.querySelector('#tab-all [role="list"]');
      if (!listContainer) return;

      const allItems = Array.from(listContainer.children);
      if (allItems.length <= PAGE_SIZE) return;

      let visibleCount = PAGE_SIZE;

      // Initially hide items beyond page size
      allItems.forEach((item, i) => {
        if (i >= PAGE_SIZE) item.style.display = 'none';
      });

      // Add count indicator
      const countDiv = document.createElement('div');
      countDiv.className = 'test-list-item-count';
      countDiv.textContent = 'Showing ' + PAGE_SIZE + ' of ' + allItems.length + ' tests';
      listContainer.parentNode.insertBefore(countDiv, listContainer);

      // Add load more button
      const loadMoreBtn = document.createElement('button');
      loadMoreBtn.textContent = 'Load more tests...';
      loadMoreBtn.className = 'summary-card-btn';
      loadMoreBtn.style.cssText = 'margin: 12px auto; display: block;';
      loadMoreBtn.onclick = function() {
        const newCount = Math.min(visibleCount + PAGE_SIZE, allItems.length);
        for (let i = visibleCount; i < newCount; i++) {
          allItems[i].style.display = '';
        }
        visibleCount = newCount;
        countDiv.textContent = 'Showing ' + visibleCount + ' of ' + allItems.length + ' tests';
        if (visibleCount >= allItems.length) {
          loadMoreBtn.style.display = 'none';
          countDiv.textContent = 'Showing all ' + allItems.length + ' tests';
        }
      };
      listContainer.parentNode.appendChild(loadMoreBtn);

      // Listen for filter changes to reset pagination
      const observer = new MutationObserver(() => {
        const visibleItems = allItems.filter(item => !item.classList.contains('filter-hidden'));
        countDiv.textContent = 'Showing ' + visibleItems.length + ' of ' + allItems.length + ' tests';
      });
      observer.observe(listContainer, { childList: false, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    })();

    /* ============================================
       KEYBOARD-DRIVEN NAVIGATION
    ============================================ */
    (function initKeyboardNav() {
      // Create keyboard hints panel
      const hints = document.createElement('div');
      hints.className = 'keyboard-hints';
      hints.innerHTML = '<h4>Keyboard Shortcuts</h4>' +
        '<div class="keyboard-hint-row"><span>Navigate tests</span><kbd>j</kbd> <kbd>k</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Next failure</span><kbd>f</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Next flaky</span><kbd>n</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Search</span><kbd>⌘K</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Toggle sidebar</span><kbd>⌘B</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Views (1-5)</span><kbd>1</kbd>-<kbd>5</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Show/hide hints</span><kbd>?</kbd></div>' +
        '<div class="keyboard-hint-row"><span>Export summary</span><kbd>e</kbd></div>';
      document.body.appendChild(hints);

      function getVisibleTestItems() {
        return Array.from(document.querySelectorAll('.test-list-item')).filter(
          el => el.offsetParent !== null && el.style.display !== 'none'
        );
      }

      function getCurrentIndex(items) {
        return items.findIndex(el => el.classList.contains('selected'));
      }

      function selectByIndex(items, idx) {
        if (idx >= 0 && idx < items.length) {
          const testId = items[idx].id.replace('list-item-', '');
          selectTest(testId);
          items[idx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }

      document.addEventListener('keydown', function(e) {
        // Don't handle keys when typing in input fields
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const items = getVisibleTestItems();
        const currentIdx = getCurrentIndex(items);

        switch(e.key) {
          case 'j': // Next test
            e.preventDefault();
            if (currentView !== 'tests') switchView('tests');
            selectByIndex(items, currentIdx < 0 ? 0 : currentIdx + 1);
            break;
          case 'k': // Previous test
            e.preventDefault();
            if (currentView !== 'tests') switchView('tests');
            selectByIndex(items, currentIdx < 0 ? 0 : currentIdx - 1);
            break;
          case 'f': // Next failure
            e.preventDefault();
            if (currentView !== 'tests') switchView('tests');
            for (let i = (currentIdx + 1); i < items.length; i++) {
              if (items[i].classList.contains('failed')) {
                selectByIndex(items, i);
                break;
              }
            }
            break;
          case 'n': // Next flaky
            e.preventDefault();
            if (currentView !== 'tests') switchView('tests');
            for (let i = (currentIdx + 1); i < items.length; i++) {
              if (items[i].dataset.flaky === 'true') {
                selectByIndex(items, i);
                break;
              }
            }
            break;
          case '?': // Toggle hints
            e.preventDefault();
            hints.classList.toggle('visible');
            break;
          case 'e': // Export summary
            e.preventDefault();
            if (typeof showSummaryExport === 'function') showSummaryExport();
            break;
          case '1': switchView('overview'); break;
          case '2': switchView('tests'); break;
          case '3': switchView('trends'); break;
          case '4':
            if (document.getElementById('view-comparison')) switchView('comparison');
            break;
          case '5':
            if (document.getElementById('view-gallery')) switchView('gallery');
            break;
          case 'Escape':
            hints.classList.remove('visible');
            break;
        }
      });
    })();

    /* ============================================
       EXPORTABLE SUMMARY CARD
    ============================================ */
    function showSummaryExport() {
      let modal = document.getElementById('summary-export-modal');
      if (modal) {
        modal.classList.add('visible');
        return;
      }

      const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
      const barColor = passRate >= 90 ? 'var(--accent-green)' : passRate >= 70 ? 'var(--accent-yellow)' : 'var(--accent-red)';
      const timestamp = new Date().toLocaleString();

      modal = document.createElement('div');
      modal.id = 'summary-export-modal';
      modal.className = 'summary-export-modal visible';
      modal.innerHTML =
        '<div class="summary-card">' +
          '<div class="summary-card-title">Test Run Summary</div>' +
          '<div class="summary-card-subtitle">' + timestamp + '</div>' +
          '<div class="summary-card-stats">' +
            '<div class="summary-stat"><div class="summary-stat-value passed">' + stats.passed + '</div><div class="summary-stat-label">Passed</div></div>' +
            '<div class="summary-stat"><div class="summary-stat-value failed">' + stats.failed + '</div><div class="summary-stat-label">Failed</div></div>' +
            '<div class="summary-stat"><div class="summary-stat-value rate">' + passRate + '%</div><div class="summary-stat-label">Pass Rate</div></div>' +
          '</div>' +
          '<div class="summary-card-bar"><div class="summary-card-bar-fill" style="width: ' + passRate + '%; background: ' + barColor + ';"></div></div>' +
          '<div style="font-size: 0.75rem; color: var(--text-muted);">' +
            stats.total + ' total &bull; ' + stats.flaky + ' flaky &bull; ' + stats.slow + ' slow &bull; ' + stats.skipped + ' skipped' +
          '</div>' +
          '<div class="summary-card-footer">' +
            '<button class="summary-card-btn" onclick="closeSummaryExport()">Close</button>' +
            '<button class="summary-card-btn primary" onclick="copySummaryToClipboard()">Copy to Clipboard</button>' +
          '</div>' +
        '</div>';
      modal.addEventListener('click', function(e) { if (e.target === modal) closeSummaryExport(); });
      document.body.appendChild(modal);
    }

    function closeSummaryExport() {
      const modal = document.getElementById('summary-export-modal');
      if (modal) modal.classList.remove('visible');
    }

    function copySummaryToClipboard() {
      const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;
      const text = 'Test Run Summary\\n' +
        '═══════════════════\\n' +
        'Passed: ' + stats.passed + '/' + stats.total + ' (' + passRate + '%)\\n' +
        'Failed: ' + stats.failed + '\\n' +
        'Flaky: ' + stats.flaky + '\\n' +
        'Slow: ' + stats.slow + '\\n' +
        'Duration: ' + document.querySelector('.duration-value')?.textContent + '\\n' +
        'Date: ' + new Date().toLocaleString();
      navigator.clipboard.writeText(text).then(() => {
        showToast('Summary copied to clipboard!', 'success');
      }).catch(() => {
        showToast('Failed to copy', 'error');
      });
    }
`;
}
