/**
 * HTML Generator - Main orchestrator for HTML report generation
 * Coordinates all other generators and generates the complete HTML document
 */

import type { TestResultData, TestHistory, RunComparison, SmartReporterOptions } from '../types';
import { formatDuration } from '../utils';
import { generateTrendChart } from './chart-generator';
import { generateGroupedTests } from './card-generator';
import { generateGallery, generateGalleryScript } from './gallery-generator';
import { generateComparison, generateComparisonScript } from './comparison-generator';

export interface HtmlGeneratorData {
  results: TestResultData[];
  history: TestHistory;
  startTime: number;
  options: SmartReporterOptions;
  comparison?: RunComparison;
}

/**
 * Generate complete HTML report
 */
export function generateHtml(data: HtmlGeneratorData): string {
  const { results, history, startTime, options, comparison } = data;

  const totalDuration = Date.now() - startTime;
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const flaky = results.filter(
    (r) => r.flakinessScore && r.flakinessScore >= 0.3
  ).length;
  const slow = results.filter((r) =>
    r.performanceTrend?.startsWith('↑')
  ).length;
  const total = results.length;
  const passRate = (passed + failed) > 0 ? Math.round((passed / (passed + failed)) * 100) : 0;

  // Calculate stability grade counts
  const gradeA = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'A').length;
  const gradeB = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'B').length;
  const gradeC = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'C').length;
  const gradeD = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'D').length;
  const gradeF = results.filter((r) => r.stabilityScore && r.stabilityScore.grade === 'F').length;

  const testsJson = JSON.stringify(results);

  // Feature flags
  const showGallery = options.enableGalleryView !== false;
  const showComparison = (options.enableComparison !== false && !!comparison);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Smart Test Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
${generateStyles(passRate)}
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header class="header">
      <div class="logo">
        <div class="logo-icon">S</div>
        <div class="logo-text">
          <h1>Smart Report</h1>
          <span>playwright test insights</span>
        </div>
      </div>
      <div style="display: flex; gap: 1rem; align-items: center;">
        <button class="export-btn" onclick="exportJSON()">📥 Export JSON</button>
        <div class="timestamp">${new Date().toLocaleString()}</div>
      </div>
    </header>

    <!-- Progress Ring + Stats -->
    <div style="display: flex; gap: 2rem; align-items: flex-start; margin-bottom: 2rem;">
      <div style="text-align: center;">
        <div class="progress-ring">
          <svg width="120" height="120">
            <circle class="bg" cx="60" cy="60" r="50"/>
            <circle class="progress" cx="60" cy="60" r="50"/>
          </svg>
          <div class="value">${passRate}%</div>
        </div>
        <div style="color: var(--text-secondary); font-size: 0.875rem;">Pass Rate</div>
      </div>

      <div class="stats-grid" style="flex: 1;">
        <div class="stat-card passed">
          <div class="stat-value">${passed}</div>
          <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card failed">
          <div class="stat-value">${failed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card skipped">
          <div class="stat-value">${skipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat-card flaky">
          <div class="stat-value">${flaky}</div>
          <div class="stat-label">Flaky</div>
        </div>
        <div class="stat-card slow">
          <div class="stat-value">${slow}</div>
          <div class="stat-label">Slow</div>
        </div>
        <div class="stat-card duration">
          <div class="stat-value">${formatDuration(totalDuration)}</div>
          <div class="stat-label">Duration</div>
        </div>
      </div>
    </div>

    <!-- Trend Chart -->
    ${generateTrendChart({ results, history, startTime })}

    <!-- Comparison (if enabled and available) -->
    ${showComparison ? generateComparison(comparison!) : ''}

    <!-- Gallery (if enabled) -->
    ${showGallery ? generateGallery(results) : ''}

    <!-- Search -->
    <div class="search-container">
      <div class="search-wrapper">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" placeholder="Search tests by name..." oninput="searchTests(this.value)">
      </div>
    </div>

    <!-- Filters -->
    <div class="filters">
      <button class="filter-btn active" data-filter="all" onclick="filterTests('all')">All (${total})</button>
      <button class="filter-btn" data-filter="passed" onclick="filterTests('passed')">Passed (${passed})</button>
      <button class="filter-btn" data-filter="failed" onclick="filterTests('failed')">Failed (${failed})</button>
      <button class="filter-btn" data-filter="skipped" onclick="filterTests('skipped')">Skipped (${skipped})</button>
      <button class="filter-btn" data-filter="flaky" onclick="filterTests('flaky')">Flaky (${flaky})</button>
      <button class="filter-btn" data-filter="slow" onclick="filterTests('slow')">Slow (${slow})</button>
    </div>

    <!-- Stability Score Filters -->
    <div class="filters stability-filters">
      <span class="filter-label">📊 Stability Score:</span>
      <button class="filter-btn stability-grade" data-filter="grade-a" onclick="filterTests('grade-a')">A (${gradeA})</button>
      <button class="filter-btn stability-grade" data-filter="grade-b" onclick="filterTests('grade-b')">B (${gradeB})</button>
      <button class="filter-btn stability-grade" data-filter="grade-c" onclick="filterTests('grade-c')">C (${gradeC})</button>
      <button class="filter-btn stability-grade" data-filter="grade-d" onclick="filterTests('grade-d')">D (${gradeD})</button>
      <button class="filter-btn stability-grade" data-filter="grade-f" onclick="filterTests('grade-f')">F (${gradeF})</button>
    </div>

    <!-- Test List -->
    <div class="test-list">
      ${generateGroupedTests(results)}
    </div>
  </div>

  <script>
${generateScripts(testsJson, showGallery, showComparison)}
  </script>
</body>
</html>`;
}

/**
 * Generate all CSS styles
 */
function generateStyles(passRate: number): string {
  return `    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-card: #1a1a24;
      --bg-card-hover: #22222e;
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

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Space Grotesk', system-ui, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      line-height: 1.5;
    }

    /* Subtle grid background */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background-image:
        linear-gradient(var(--border-subtle) 1px, transparent 1px),
        linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px);
      background-size: 60px 60px;
      opacity: 0.3;
      pointer-events: none;
      z-index: -1;
    }

    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--border-subtle);
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      box-shadow: 0 0 30px rgba(0, 255, 136, 0.2);
    }

    .logo-text h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .logo-text span {
      font-size: 0.875rem;
      color: var(--text-secondary);
      font-family: 'JetBrains Mono', monospace;
    }

    .timestamp {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: var(--text-muted);
      background: var(--bg-secondary);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--border-subtle);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 1rem;
      margin-bottom: 2rem;
    }

    @media (max-width: 900px) {
      .stats-grid { grid-template-columns: repeat(3, 1fr); }
    }

    @media (max-width: 500px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: 16px;
      padding: 1.25rem;
      text-align: center;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--stat-color);
      opacity: 0.8;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: var(--stat-color);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px color-mix(in srgb, var(--stat-color) 20%, transparent);
    }

    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 2rem;
      font-weight: 700;
      color: var(--stat-color);
      text-shadow: 0 0 20px color-mix(in srgb, var(--stat-color) 40%, transparent);
    }

    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-top: 0.25rem;
    }

    .stat-card.passed { --stat-color: var(--accent-green); }
    .stat-card.failed { --stat-color: var(--accent-red); }
    .stat-card.skipped { --stat-color: var(--text-muted); }
    .stat-card.flaky { --stat-color: var(--accent-yellow); }
    .stat-card.slow { --stat-color: var(--accent-orange); }
    .stat-card.duration { --stat-color: var(--accent-blue); }

    /* Progress Ring */
    .progress-ring {
      width: 120px;
      height: 120px;
      margin: 0 auto 1.5rem;
      position: relative;
    }

    .progress-ring svg {
      transform: rotate(-90deg);
    }

    .progress-ring circle {
      fill: none;
      stroke-width: 8;
      stroke-linecap: round;
    }

    .progress-ring .bg { stroke: var(--border-subtle); }
    .progress-ring .progress {
      stroke: var(--accent-green);
      stroke-dasharray: 314;
      stroke-dashoffset: calc(314 - (314 * ${passRate}) / 100);
      transition: stroke-dashoffset 1s ease;
      filter: drop-shadow(0 0 8px var(--accent-green));
    }

    .progress-ring .value {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      cursor: pointer;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }

    .chart-bar:hover {
      opacity: 1 !important;
      filter: brightness(1.1);
    }

    .bar-group {
      cursor: pointer;
    }

    .bar-group:hover .chart-bar {
      transform: translateY(-2px);
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
      font-family: 'JetBrains Mono', monospace;
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
    }

    .spark-dot:hover {
      transform: scale(1.4);
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
    }

    .test-card:hover {
      border-color: var(--border-glow);
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
      animation: pulse 2s infinite;
    }

    .status-indicator.passed {
      background: var(--accent-green);
      box-shadow: 0 0 12px var(--accent-green);
    }

    .status-indicator.failed {
      background: var(--accent-red);
      box-shadow: 0 0 12px var(--accent-red);
      animation: pulse-red 1.5s infinite;
    }

    .status-indicator.skipped {
      background: var(--text-muted);
      box-shadow: none;
      animation: none;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    @keyframes pulse-red {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.8; transform: scale(1.1); }
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
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .test-card-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }

    .test-duration {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.875rem;
      color: var(--text-secondary);
    }

    .badge {
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
    }

    .ai-markdown .ai-code-lang {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
      padding: 0.45rem 0.75rem;
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(0, 0, 0, 0.15);
    }

    .ai-markdown pre {
      margin: 0;
      padding: 0.85rem 0.95rem;
      overflow-x: auto;
    }

    .ai-markdown pre code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      color: var(--text-secondary);
      white-space: pre;
      display: block;
    }

    .duration-compare {
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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

    .attachments {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .comparison-item-duration-badge {
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
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
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--accent-red);
      background: rgba(255, 68, 102, 0.1);
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid var(--accent-red-dim);
    }
`;
}

/**
 * Generate all JavaScript
 */
function generateScripts(testsJson: string, includeGallery: boolean, includeComparison: boolean): string {
  return `    const tests = ${testsJson};

    function searchTests(query) {
      const lowerQuery = query.toLowerCase();
      document.querySelectorAll('.test-card').forEach(card => {
        const title = card.querySelector('.test-title')?.textContent?.toLowerCase() || '';
        const file = card.querySelector('.test-file')?.textContent?.toLowerCase() || '';
        const matches = title.includes(lowerQuery) || file.includes(lowerQuery);
        card.style.display = matches ? 'block' : 'none';
      });

      // Also show/hide file groups if all tests are hidden
      document.querySelectorAll('.file-group').forEach(group => {
        const visibleTests = group.querySelectorAll('.test-card[style="display: block"], .test-card:not([style*="display"])');
        const hasVisible = Array.from(group.querySelectorAll('.test-card')).some(
          card => card.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });
    }

    function filterTests(filter) {
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
      });

      document.querySelectorAll('.test-card').forEach(card => {
        const status = card.dataset.status;
        const isFlaky = card.dataset.flaky === 'true';
        const isSlow = card.dataset.slow === 'true';
        const grade = card.dataset.grade;

        let show = filter === 'all' ||
          (filter === 'passed' && status === 'passed') ||
          (filter === 'failed' && (status === 'failed' || status === 'timedOut')) ||
          (filter === 'skipped' && status === 'skipped') ||
          (filter === 'flaky' && isFlaky) ||
          (filter === 'slow' && isSlow) ||
          (filter === 'grade-a' && grade === 'A') ||
          (filter === 'grade-b' && grade === 'B') ||
          (filter === 'grade-c' && grade === 'C') ||
          (filter === 'grade-d' && grade === 'D') ||
          (filter === 'grade-f' && grade === 'F');

        card.style.display = show ? 'block' : 'none';
      });

      // Update group visibility
      document.querySelectorAll('.file-group').forEach(group => {
        const hasVisible = Array.from(group.querySelectorAll('.test-card')).some(
          card => card.style.display !== 'none'
        );
        group.style.display = hasVisible ? 'block' : 'none';
      });
    }

    function toggleDetails(id) {
      const card = document.getElementById('card-' + id);
      card.classList.toggle('expanded');
    }

    function toggleGroup(groupId) {
      const group = document.getElementById('group-' + groupId);
      group.classList.toggle('collapsed');
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
    }

    // Auto-scroll secondary charts to show most recent run
    function scrollChartsToRight() {
      document.querySelectorAll('.secondary-trend-chart').forEach(chart => {
        chart.scrollLeft = chart.scrollWidth;
      });
    }

    // Run on page load
    window.addEventListener('DOMContentLoaded', scrollChartsToRight);

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
`;
}
