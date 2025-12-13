/**
 * Chart Generator - Handles all chart generation (trend charts, duration, flaky, slow)
 */

import type { TestResultData, TestHistory, RunSummary } from '../types';
import { formatDuration, formatShortDate } from '../utils';

export interface ChartData {
  results: TestResultData[];
  history: TestHistory;
  startTime: number;
}

/**
 * Generate the main trend chart showing pass/fail trends over time
 */
export function generateTrendChart(data: ChartData): string {
  const summaries = data.history.summaries || [];
  if (summaries.length < 2) {
    return ''; // Don't show trend with less than 2 data points
  }

  const passed = data.results.filter(r => r.status === 'passed').length;
  const failed = data.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
  const skipped = data.results.filter(r => r.status === 'skipped').length;
  const currentFlaky = data.results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
  const currentSlow = data.results.filter(r => r.performanceTrend?.startsWith('↑')).length;
  const total = data.results.length;
  const currentDuration = Date.now() - data.startTime;

  // Chart dimensions
  const chartWidth = 800;
  const chartHeight = 120;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // Prepare data points including current run
  const allSummaries = [...summaries, {
    runId: 'current',
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed,
    skipped,
    flaky: currentFlaky,
    slow: currentSlow,
    duration: currentDuration,
    passRate: total > 0 ? Math.round((passed / total) * 100) : 0
  }];

  // Find max values for scaling
  const maxTotal = Math.max(...allSummaries.map((s: any) => s.passed + s.failed), 1);
  const maxDuration = Math.max(...allSummaries.map((s: any) => s.duration || 0), 1);
  const maxFlaky = Math.max(...allSummaries.map((s: any) => s.flaky || 0), 1);
  const maxSlow = Math.max(...allSummaries.map((s: any) => s.slow || 0), 1);

  // Helper function to generate SVG bar chart with trend line
  const generateBarChart = (
    chartData: any[],
    getValue: (d: any) => number,
    maxValue: number,
    color: string,
    yAxisLabel: string,
    formatValue?: (val: number) => string
  ): string => {
    const barWidth = Math.min(40, plotWidth / chartData.length - 4);
    const spacing = plotWidth / chartData.length;

    // Generate y-axis grid lines and labels
    const yTicks = 5;
    const yGridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
      const value = Math.round((maxValue / yTicks) * i);
      const y = padding.top + plotHeight - (i / yTicks) * plotHeight;
      return `
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + plotWidth}" y2="${y}" stroke="var(--border-subtle)" stroke-width="1" opacity="0.2"/>
        <text x="${padding.left - 8}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">${value}</text>
      `;
    }).join('');

    // Generate bars
    const bars = chartData.map((d, i) => {
      const value = getValue(d);
      const x = padding.left + i * spacing + (spacing - barWidth) / 2;
      const barHeight = (value / maxValue) * plotHeight;
      const y = padding.top + plotHeight - barHeight;
      const label = i === chartData.length - 1 ? 'Current' : formatShortDate(d.timestamp);
      const isCurrent = i === chartData.length - 1;
      const displayValue = formatValue ? formatValue(value) : value.toString();

      return `
        <g class="bar-group">
          <rect
            x="${x}"
            y="${y}"
            width="${barWidth}"
            height="${barHeight}"
            fill="${color}"
            opacity="${isCurrent ? '1' : '0.85'}"
            stroke="${isCurrent ? 'var(--text-primary)' : 'none'}"
            stroke-width="${isCurrent ? '2' : '0'}"
            rx="3"
            class="chart-bar"
          >
            <title>${label}: ${displayValue}</title>
          </rect>
        </g>
      `;
    }).join('');

    // Generate trend line
    const trendPoints = chartData.map((d, i) => {
      const value = getValue(d);
      const x = padding.left + i * spacing + spacing / 2;
      const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
      return `${x},${y}`;
    }).join(' ');

    // Generate x-axis labels
    const xLabels = chartData.map((d, i) => {
      if (chartData.length > 10 && i % 2 !== 0 && i !== chartData.length - 1) return '';
      const x = padding.left + i * spacing + spacing / 2;
      const label = i === chartData.length - 1 ? 'Now' : formatShortDate(d.timestamp);
      return `<text x="${x}" y="${chartHeight - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle">${label}</text>`;
    }).join('');

    return `
      <svg width="${chartWidth}" height="${chartHeight}" style="overflow: visible;">
        <!-- Y-axis label -->
        <text x="12" y="${chartHeight / 2}" fill="var(--text-secondary)" font-size="11" font-weight="600" text-anchor="middle" transform="rotate(-90, 12, ${chartHeight / 2})">${yAxisLabel}</text>

        <!-- Grid lines and y-axis labels -->
        ${yGridLines}

        <!-- Bars -->
        ${bars}

        <!-- Trend line -->
        <polyline
          points="${trendPoints}"
          fill="none"
          stroke="${color}"
          stroke-width="2"
          stroke-dasharray="4,4"
          opacity="0.6"
          stroke-linecap="round"
        />

        <!-- Trend line data points -->
        ${chartData.map((d, i) => {
          const value = getValue(d);
          const x = padding.left + i * spacing + spacing / 2;
          const y = padding.top + plotHeight - (value / maxValue) * plotHeight;
          const isCurrent = i === chartData.length - 1;
          return `<circle cx="${x}" cy="${y}" r="${isCurrent ? 4 : 2.5}" fill="${color}" stroke="white" stroke-width="1.5"/>`;
        }).join('')}

        <!-- X-axis labels -->
        ${xLabels}

        <!-- X-axis line -->
        <line x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}" stroke="var(--border-subtle)" stroke-width="1"/>
      </svg>
    `;
  };

  // Generate pass rate bar chart
  const passRateChart = generateBarChart(
    allSummaries,
    (s: any) => s.passRate || 0,
    100,
    '#22c55e',
    'Pass Rate (%)',
    (val) => `${val}%`
  );

  // Generate duration bar chart
  const durationChart = generateBarChart(
    allSummaries,
    (s: any) => Math.round((s.duration || 0) / 1000),
    Math.ceil(maxDuration / 1000),
    '#a855f7',
    'Duration (s)',
    (val) => `${val}s`
  );

  // Generate flaky tests bar chart
  const flakyChart = generateBarChart(
    allSummaries,
    (s: any) => s.flaky || 0,
    maxFlaky,
    '#eab308',
    'Flaky Tests'
  );

  // Generate slow tests bar chart
  const slowChart = generateBarChart(
    allSummaries,
    (s: any) => s.slow || 0,
    maxSlow,
    '#f97316',
    'Slow Tests'
  );

  return `
    <div class="trend-section">
      <div class="trend-header">
        <div class="trend-title">📊 Test Run Trends</div>
        <div class="trend-subtitle">Last ${allSummaries.length} runs</div>
      </div>

      <!-- Pass Rate Chart -->
      <div class="line-chart-container">
        <h4 class="chart-title">✅ Pass Rate Over Time</h4>
        ${passRateChart}
      </div>

      <!-- Secondary Charts Grid -->
      <div class="secondary-trends-grid">
        <div class="line-chart-container">
          <h4 class="chart-title">⏱️ Duration Trend</h4>
          ${durationChart}
        </div>
        <div class="line-chart-container">
          <h4 class="chart-title">🟡 Flaky Tests</h4>
          ${flakyChart}
        </div>
        <div class="line-chart-container">
          <h4 class="chart-title">🐢 Slow Tests</h4>
          ${slowChart}
        </div>
      </div>
    </div>
  `;
}
