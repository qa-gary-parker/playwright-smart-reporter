/**
 * Chart Generator - Handles all chart generation (trend charts, duration, flaky, slow)
 */

import type { TestResultData, TestHistory, RunSummary } from '../types';
import { formatDuration, formatShortDate } from '../utils';
import { escapeHtml } from '../utils/sanitizers';
import { icon } from './icon-provider';

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
  if (summaries.length < 1) {
    // Show helpful message explaining why trends aren't visible
    return `
      <div class="trend-section">
        <div class="trend-header">
          <div class="trend-title">${icon('bar-chart-2')} Test Run Trends</div>
          <div class="trend-subtitle">Collecting data...</div>
        </div>
        <div class="trend-message">
          <p>${icon('trending-up')} <strong>Trends will appear after 2+ test runs.</strong></p>
          <p>Run your tests again to start seeing historical trends, pass rates, and performance patterns.</p>
          <p style="font-size: 0.85em; opacity: 0.7;">Make sure your <code>historyFile</code> option points to a persistent location.</p>
        </div>
      </div>
    `;
  }

  const passed = data.results.filter(r => r.status === 'passed').length;
  const failed = data.results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
  const skipped = data.results.filter(r => r.status === 'skipped').length;
  const currentFlaky = data.results.filter(r => r.flakinessScore && r.flakinessScore >= 0.3).length;
  const currentSlow = data.results.filter(r => r.performanceTrend?.startsWith('↑')).length;
  const total = data.results.length;
  const currentDuration = Date.now() - data.startTime;

  // Chart dimensions - using viewBox for responsive SVG
  const chartWidth = 400;  // Reduced width for 3-column grid
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
  const maxTotal = Math.max(...allSummaries.map((s) => s.passed + s.failed), 1);
  const maxDuration = Math.max(...allSummaries.map((s) => s.duration || 0), 1);
  const maxFlaky = Math.max(...allSummaries.map((s) => s.flaky || 0), 1);
  const maxSlow = Math.max(...allSummaries.map((s) => s.slow || 0), 1);

  // Calculate 3-point moving average
  const movingAverage = (values: number[], window: number = 3): (number | null)[] => {
    return values.map((_, i) => {
      if (i < window - 1) return null;
      const slice = values.slice(i - window + 1, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  };

  // Detect anomalies (values > 2 standard deviations from mean)
  const detectAnomalies = (values: number[]): boolean[] => {
    if (values.length < 3) return values.map(() => false);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = Math.sqrt(values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length);
    return values.map(v => stdDev > 0 && Math.abs(v - mean) > 2 * stdDev);
  };

  // Helper function to generate SVG bar chart with moving average and anomaly detection
  const generateBarChart = (
    chartData: RunSummary[],
    getValue: (d: RunSummary) => number,
    maxValue: number,
    color: string,
    yAxisLabel: string,
    formatValue?: (val: number) => string,
    avgColor: string = '#38bdf8',
    gradientId: string = 'trendGrad'
  ): string => {
    const barWidth = Math.min(40, plotWidth / chartData.length - 4);
    const spacing = plotWidth / chartData.length;

    const values = chartData.map(d => getValue(d));
    const avgValues = movingAverage(values);
    const anomalies = detectAnomalies(values);

    // Generate y-axis grid lines and labels
    const yTicks = 5;
    const yGridLines = Array.from({ length: yTicks + 1 }, (_, i) => {
      const value = Math.round((maxValue / yTicks) * i);
      const y = (padding.top + plotHeight - (i / yTicks) * plotHeight).toFixed(1);
      return `
        <line x1="${padding.left}" y1="${y}" x2="${padding.left + plotWidth}" y2="${y}" stroke="var(--border-subtle)" stroke-width="1" opacity="0.2"/>
        <text x="${padding.left - 8}" y="${(parseFloat(y) + 4).toFixed(1)}" fill="var(--text-muted)" font-size="10" text-anchor="end">${value}</text>
      `;
    }).join('');

    // Compute area curve points (center of each bar)
    const curvePoints: [number, number][] = chartData.map((d, i) => {
      const value = getValue(d);
      const cx = padding.left + i * spacing + spacing / 2;
      const cy = padding.top + plotHeight - (value / maxValue) * plotHeight;
      return [cx, cy];
    });

    // Build smooth area curve (monotone cubic interpolation) — needs 2+ points
    let areaSvg = '';
    const n = curvePoints.length;
    if (n >= 2) {
      const tangents: [number, number][] = curvePoints.map((_, i) => {
        if (i === 0) return [curvePoints[1][0] - curvePoints[0][0], curvePoints[1][1] - curvePoints[0][1]];
        if (i === n - 1) return [curvePoints[n - 1][0] - curvePoints[n - 2][0], curvePoints[n - 1][1] - curvePoints[n - 2][1]];
        return [(curvePoints[i + 1][0] - curvePoints[i - 1][0]) / 2, (curvePoints[i + 1][1] - curvePoints[i - 1][1]) / 2];
      });

      let linePath = `M${curvePoints[0][0].toFixed(1)},${curvePoints[0][1].toFixed(1)}`;
      for (let i = 0; i < n - 1; i++) {
        const p0 = curvePoints[i], p1 = curvePoints[i + 1];
        const t0 = tangents[i], t1 = tangents[i + 1];
        const cp1x = p0[0] + t0[0] / 3;
        const cp1y = p0[1] + t0[1] / 3;
        const cp2x = p1[0] - t1[0] / 3;
        const cp2y = p1[1] - t1[1] / 3;
        linePath += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
      }

      const baseline = padding.top + plotHeight;
      const areaPath = `${linePath} L${curvePoints[n - 1][0].toFixed(1)},${baseline} L${curvePoints[0][0].toFixed(1)},${baseline} Z`;

      areaSvg = `
        <path d="${areaPath}" fill="url(#${gradientId})" />
        <path d="${linePath}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" />`;
    }

    // Generate visible bars (shown when bar mode active)
    const visibleBars = chartData.map((d, i) => {
      const value = getValue(d);
      const x = (padding.left + i * spacing + (spacing - barWidth) / 2).toFixed(1);
      const barHeight = ((value / maxValue) * plotHeight).toFixed(1);
      const y = (padding.top + plotHeight - parseFloat(barHeight)).toFixed(1);
      const isCurrent = i === chartData.length - 1;

      return `
          <rect
            x="${x}" y="${y}"
            width="${barWidth.toFixed(1)}" height="${barHeight}"
            fill="${color}"
            opacity="${isCurrent ? '0.5' : '0.4'}"
            stroke="${isCurrent ? 'var(--text-primary)' : 'none'}"
            stroke-width="${isCurrent ? '1' : '0'}"
            rx="3"
          />`;
    }).join('');

    // Generate invisible hit-target bars (always present for tooltips + click)
    const hitBars = chartData.map((d, i) => {
      const value = getValue(d);
      const x = (padding.left + i * spacing + (spacing - barWidth) / 2).toFixed(1);
      const barHeight = ((value / maxValue) * plotHeight).toFixed(1);
      const y = (padding.top + plotHeight - parseFloat(barHeight)).toFixed(1);
      const label = i === chartData.length - 1 ? 'Current' : formatShortDate(d.timestamp);
      const isCurrent = i === chartData.length - 1;
      const displayValue = formatValue ? formatValue(value) : value.toString();
      const runId = d.runId || '';
      const safeRunId = escapeHtml(runId).replace(/'/g, "\\'");
      const clickable = !isCurrent && runId;
      const isAnomaly = anomalies[i];

      return `
        <g class="bar-group${clickable ? ' clickable' : ''}" data-tooltip="${label}: ${displayValue}${isAnomaly ? ' Anomaly' : ''}" ${clickable ? `data-runid="${escapeHtml(runId)}" onclick="loadHistoricalRun('${safeRunId}', '${label}')"` : ''}>
          <rect
            x="${x}" y="${y}"
            width="${barWidth.toFixed(1)}" height="${barHeight}"
            fill="transparent"
            class="chart-bar${clickable ? ' chart-bar-clickable' : ''}"
            style="${clickable ? 'cursor: pointer;' : ''}"
          />
          ${isAnomaly ? `<circle cx="${(parseFloat(x) + barWidth / 2).toFixed(1)}" cy="${(parseFloat(y) - 6).toFixed(1)}" r="4" class="chart-anomaly-marker" fill="var(--accent-red)"/>` : ''}
        </g>
      `;
    }).join('');

    // Generate smooth moving average line (monotone cubic interpolation)
    const avgPointPairs: [number, number][] = [];
    avgValues.forEach((val, i) => {
      if (val === null) return;
      const ax = padding.left + i * spacing + spacing / 2;
      const ay = padding.top + plotHeight - (val / maxValue) * plotHeight;
      avgPointPairs.push([ax, ay]);
    });

    let avgLine = '';
    const an = avgPointPairs.length;
    if (an >= 2) {
      const at: [number, number][] = avgPointPairs.map((_, i) => {
        if (i === 0) return [avgPointPairs[1][0] - avgPointPairs[0][0], avgPointPairs[1][1] - avgPointPairs[0][1]];
        if (i === an - 1) return [avgPointPairs[an - 1][0] - avgPointPairs[an - 2][0], avgPointPairs[an - 1][1] - avgPointPairs[an - 2][1]];
        return [(avgPointPairs[i + 1][0] - avgPointPairs[i - 1][0]) / 2, (avgPointPairs[i + 1][1] - avgPointPairs[i - 1][1]) / 2];
      });

      let avgPath = `M${avgPointPairs[0][0].toFixed(1)},${avgPointPairs[0][1].toFixed(1)}`;
      for (let i = 0; i < an - 1; i++) {
        const p0 = avgPointPairs[i], p1 = avgPointPairs[i + 1];
        const t0 = at[i], t1 = at[i + 1];
        avgPath += ` C${(p0[0] + t0[0] / 3).toFixed(1)},${(p0[1] + t0[1] / 3).toFixed(1)} ${(p1[0] - t1[0] / 3).toFixed(1)},${(p1[1] - t1[1] / 3).toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)}`;
      }

      avgLine = `<path d="${avgPath}" class="trend-moving-avg" stroke="${avgColor}" fill="none" /><text class="trend-avg-label" x="${padding.left + plotWidth - 5}" y="${padding.top + 10}" text-anchor="end">3-run avg</text>`;
    }

    // Generate x-axis labels
    const xLabels = chartData.map((d, i) => {
      if (chartData.length > 10 && i % 2 !== 0 && i !== chartData.length - 1) return '';
      const x = (padding.left + i * spacing + spacing / 2).toFixed(1);
      const label = i === chartData.length - 1 ? 'Now' : formatShortDate(d.timestamp);
      return `<text x="${x}" y="${chartHeight - 8}" fill="var(--text-muted)" font-size="9" text-anchor="middle">${label}</text>`;
    }).join('');

    return `
      <svg viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: auto; overflow: visible;" class="chart-svg">
        <defs>
          <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0.03"/>
          </linearGradient>
        </defs>

        <!-- Y-axis label -->
        <text x="12" y="${chartHeight / 2}" fill="var(--text-secondary)" font-size="11" font-weight="600" text-anchor="middle" transform="rotate(-90, 12, ${chartHeight / 2})">${yAxisLabel}</text>

        <!-- Grid lines and y-axis labels -->
        ${yGridLines}

        <!-- Area curve (visible in area mode) -->
        <g class="chart-layer-area">
          ${areaSvg}
        </g>

        <!-- Visible bars (hidden in area mode, shown in bar mode) -->
        <g class="chart-layer-bars" style="display: none;">
          ${visibleBars}
        </g>

        <!-- Invisible hit-target bars (always present) -->
        ${hitBars}

        <!-- Moving average line (hidden by default) -->
        <g class="chart-layer-avg" style="display: none;">
          ${avgLine}
        </g>

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
    (s) => s.passRate || 0,
    100,
    '#22c55e',
    'Pass Rate (%)',
    (val) => `${val}%`,
    '#38bdf8',
    'trendGrad-passrate'
  );

  // Generate duration bar chart
  const durationChart = generateBarChart(
    allSummaries,
    (s) => Math.round((s.duration || 0) / 1000),
    Math.ceil(maxDuration / 1000),
    '#a855f7',
    'Duration (s)',
    (val) => `${val}s`,
    '#38bdf8',
    'trendGrad-duration'
  );

  // Generate flaky tests bar chart
  const flakyChart = generateBarChart(
    allSummaries,
    (s) => s.flaky || 0,
    maxFlaky,
    '#eab308',
    'Flaky Tests',
    undefined,
    '#38bdf8',
    'trendGrad-flaky'
  );

  // Generate slow tests bar chart
  const slowChart = generateBarChart(
    allSummaries,
    (s) => s.slow || 0,
    maxSlow,
    '#f97316',
    'Slow Tests',
    undefined,
    '#38bdf8',
    'trendGrad-slow'
  );

  return `
    <div id="trends-section" class="trend-section collapsible-section">
      <div class="trend-header" onclick="toggleSection('trends-section')">
        <div style="display: flex; align-items: center;">
          <div class="trend-title">${icon('bar-chart-2')} Test Run Trends</div>
          <span class="section-toggle">${icon('chevron-down', 14)}</span>
        </div>
        <div class="trend-subtitle">Last ${allSummaries.length} runs</div>
      </div>
      <div class="trend-controls" onclick="event.stopPropagation()">
        <button class="chart-toggle-btn" onclick="toggleAllAvg(this)" title="Toggle 3-run average on all charts">${icon('trending-up', 12)} <span>3-run avg</span></button>
        <button class="chart-toggle-btn" onclick="toggleAllMode(this)" title="Switch all charts to bar view">${icon('bar-chart-2', 12)} <span>Bars</span></button>
      </div>

      <!-- All Charts in Grid -->
      <div class="section-content all-charts-grid">
        <div class="line-chart-container">
          <h4 class="chart-title">${icon('check-circle')} Pass Rate</h4>
          ${passRateChart}
        </div>
        <div class="line-chart-container">
          <h4 class="chart-title">${icon('clock')} Duration</h4>
          ${durationChart}
        </div>
        <div class="line-chart-container">
          <h4 class="chart-title">${icon('shuffle')} Flaky Tests</h4>
          ${flakyChart}
        </div>
        <div class="line-chart-container">
          <h4 class="chart-title">${icon('hourglass')} Slow Tests</h4>
          ${slowChart}
        </div>
      </div>
    </div>
  `;
}
