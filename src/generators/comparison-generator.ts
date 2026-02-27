/**
 * Comparison Generator - NEW feature for run comparison
 * Compare current run vs baseline to show new failures, fixed tests, regressions, improvements
 */

import type { RunComparison, RunSummary, TestResultData, ComparisonChanges } from '../types';
import { formatDuration, escapeHtml, sanitizeId } from '../utils';
import { icon } from './icon-provider';

/**
 * Generate comparison view between current and baseline runs
 */
export function generateComparison(comparison: RunComparison): string {
  const { baselineRun, currentRun, changes } = comparison;

  // Calculate deltas
  const passRateDelta = currentRun.passRate - baselineRun.passRate;
  const durationDelta = currentRun.duration - baselineRun.duration;
  const durationPctChange = baselineRun.duration > 0
    ? ((durationDelta / baselineRun.duration) * 100).toFixed(1)
    : '0';

  return `
    <div class="comparison-section">
      <div class="comparison-header">
        <div class="comparison-title">${icon('refresh-cw')} Run Comparison</div>
        <div class="comparison-subtitle">
          Baseline: ${new Date(baselineRun.timestamp).toLocaleDateString()} vs Current
        </div>
      </div>

      <!-- Summary Cards -->
      <div class="comparison-summary">
        <div class="comparison-card">
          <div class="comparison-card-label">Pass Rate</div>
          <div class="comparison-card-value ${passRateDelta >= 0 ? 'positive' : 'negative'}">
            ${currentRun.passRate}%
            <span class="comparison-delta">
              ${passRateDelta >= 0 ? '↑' : '↓'} ${Math.abs(passRateDelta).toFixed(1)}%
            </span>
          </div>
        </div>

        <div class="comparison-card">
          <div class="comparison-card-label">Duration</div>
          <div class="comparison-card-value ${durationDelta <= 0 ? 'positive' : 'negative'}">
            ${formatDuration(currentRun.duration)}
            <span class="comparison-delta">
              ${durationDelta <= 0 ? '↓' : '↑'} ${durationPctChange}%
            </span>
          </div>
        </div>

        <div class="comparison-card">
          <div class="comparison-card-label">Tests</div>
          <div class="comparison-card-value">
            ${currentRun.total}
            <span class="comparison-delta neutral">
              ${currentRun.total - baselineRun.total >= 0 ? '+' : ''}${currentRun.total - baselineRun.total}
            </span>
          </div>
        </div>

        <div class="comparison-card">
          <div class="comparison-card-label">Flaky</div>
          <div class="comparison-card-value ${currentRun.flaky - baselineRun.flaky <= 0 ? 'positive' : 'negative'}">
            ${currentRun.flaky}
            <span class="comparison-delta">
              ${currentRun.flaky - baselineRun.flaky >= 0 ? '+' : ''}${currentRun.flaky - baselineRun.flaky}
            </span>
          </div>
        </div>
      </div>

      <!-- Change Details -->
      <div class="comparison-details">
        ${generateComparisonSection(`${icon('x-circle')} New Failures`, changes.newFailures, 'failure')}
        ${generateComparisonSection(`${icon('check-circle')} Fixed Tests`, changes.fixedTests, 'fixed')}
        ${generateComparisonSection(`${icon('hourglass')} Performance Regressions`, changes.regressions, 'regression')}
        ${generateComparisonSection(`${icon('zap')} Performance Improvements`, changes.improvements, 'improvement')}
        ${generateComparisonSection(`${icon('pencil')} New Tests`, changes.newTests, 'new')}
      </div>
    </div>
  `;
}

/**
 * Generate a single comparison section
 */
function generateComparisonSection(
  title: string,
  tests: TestResultData[],
  type: 'failure' | 'fixed' | 'regression' | 'improvement' | 'new'
): string {
  if (tests.length === 0) {
    return '';
  }

  const sectionId = sanitizeId(title);
  const colorClass = getColorClass(type);

  return `
    <div class="comparison-section-wrapper">
      <div class="comparison-section-header ${colorClass}" onclick="toggleComparisonSection('${sectionId}')">
        <span class="expand-icon">▼</span>
        <span class="comparison-section-title">${title}</span>
        <span class="comparison-section-count">${tests.length}</span>
      </div>
      <div id="section-${sectionId}" class="comparison-section-content">
        ${tests.map(test => generateComparisonItem(test, type)).join('')}
      </div>
    </div>
  `;
}

/**
 * Generate a single comparison item
 */
function generateComparisonItem(test: TestResultData, type: string): string {
  const itemId = sanitizeId(test.testId);

  let details = '';
  if (type === 'regression' || type === 'improvement') {
    const avgDuration = test.averageDuration || 0;
    const pctChange = avgDuration > 0
      ? (((test.duration - avgDuration) / avgDuration) * 100).toFixed(1)
      : '0';
    details = `
      <div class="comparison-item-details">
        <span class="comparison-item-duration">
          ${formatDuration(avgDuration)} → ${formatDuration(test.duration)}
        </span>
        <span class="comparison-item-change ${type === 'regression' ? 'negative' : 'positive'}">
          ${type === 'regression' ? '↑' : '↓'} ${Math.abs(parseFloat(pctChange))}%
        </span>
      </div>
    `;
  }

  if (type === 'failure' && test.error) {
    details = `
      <div class="comparison-item-error">
        ${escapeHtml(test.error.substring(0, 150))}${test.error.length > 150 ? '...' : ''}
      </div>
    `;
  }

  return `
    <div class="comparison-item" id="comparison-${itemId}">
      <div class="comparison-item-header">
        <div class="comparison-item-status ${test.status}"></div>
        <div class="comparison-item-info">
          <div class="comparison-item-title">${escapeHtml(test.title)}</div>
          <div class="comparison-item-file">${escapeHtml(test.file)}</div>
        </div>
        <div class="comparison-item-duration-badge">${formatDuration(test.duration)}</div>
      </div>
      ${details}
    </div>
  `;
}

/**
 * Get color class for section type
 */
function getColorClass(type: string): string {
  switch (type) {
    case 'failure': return 'failure-section';
    case 'fixed': return 'fixed-section';
    case 'regression': return 'regression-section';
    case 'improvement': return 'improvement-section';
    case 'new': return 'new-section';
    default: return '';
  }
}

/**
 * Generate JavaScript for comparison functionality
 */
export function generateComparisonScript(): string {
  return `
    function toggleComparisonSection(sectionId) {
      const section = document.getElementById('section-' + sectionId);
      const header = section.previousElementSibling;
      const icon = header.querySelector('.expand-icon');

      if (section.style.display === 'none') {
        section.style.display = 'block';
        icon.innerHTML = '${icon('chevron-down', 14)}';
      } else {
        section.style.display = 'none';
        icon.innerHTML = '${icon('chevron-right', 14)}';
      }
    }
  `;
}

/**
 * Generate comparison from test results and baseline
 * This is a helper function that would be used by the SmartReporter to build the comparison
 */
export function buildComparison(
  currentTests: TestResultData[],
  currentSummary: RunSummary,
  baselineSummary: RunSummary,
  baselineTests: Map<string, TestResultData>
): RunComparison {
  const changes: ComparisonChanges = {
    newFailures: [],
    fixedTests: [],
    newTests: [],
    regressions: [],
    improvements: []
  };

  for (const test of currentTests) {
    const baselineTest = baselineTests.get(test.testId);

    if (!baselineTest) {
      // New test
      changes.newTests.push(test);
      continue;
    }

    // Check for new failures (including timedOut)
    if ((test.status === 'failed' || test.status === 'timedOut') && baselineTest.status === 'passed') {
      changes.newFailures.push(test);
    }

    // Check for fixed tests (including previously timedOut)
    if (test.status === 'passed' && (baselineTest.status === 'failed' || baselineTest.status === 'timedOut')) {
      changes.fixedTests.push(test);
    }

    // Check for performance regressions/improvements
    if (test.status === 'passed' && baselineTest.status === 'passed') {
      const baselineDuration = baselineTest.duration;
      const currentDuration = test.duration;
      const pctChange = (currentDuration - baselineDuration) / baselineDuration;

      if (pctChange > 0.2) { // 20% slower
        changes.regressions.push({
          ...test,
          averageDuration: baselineDuration
        });
      } else if (pctChange < -0.2) { // 20% faster
        changes.improvements.push({
          ...test,
          averageDuration: baselineDuration
        });
      }
    }
  }

  return {
    baselineRun: baselineSummary,
    currentRun: currentSummary,
    changes
  };
}
