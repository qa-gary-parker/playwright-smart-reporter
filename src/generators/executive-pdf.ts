import PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';
import type {
  TestResultData,
  TestHistory,
  CIInfo,
  FailureCluster,
  RunSummary,
  QualityGateResult,
  QualityGateRuleResult,
  QuarantineEntry,
} from '../types';

export interface ExecutivePdfData {
  results: TestResultData[];
  history: TestHistory;
  startTime: number;
  ciInfo?: CIInfo;
  failureClusters?: FailureCluster[];
  projectName?: string;
  qualityGateResult?: QualityGateResult;
  quarantineEntries?: QuarantineEntry[];
  quarantineThreshold?: number;
  branding?: { title?: string; footer?: string };
}

// ---------------------------------------------------------------------------
// PDF Theme System
// ---------------------------------------------------------------------------
export type PdfThemeName = 'corporate' | 'dark' | 'minimal';

interface PdfColorScheme {
  pageBg: string;
  stripeBg: string;
  headingText: string;
  bodyText: string;
  mutedText: string;
  lightText: string;
  cardBg: string;
  tableHeaderBg: string;
  tableRowAltBg: string;
  dividerColor: string;
  accentBlue: string;
  accentGreen: string;
  accentGreenDark: string;
  accentGreenBg: string;
  accentRed: string;
  accentRedDark: string;
  accentRedBg: string;
  accentAmber: string;
  accentAmberBg: string;
  accentGray: string;
  accentOrange: string;
}

const CORPORATE: PdfColorScheme = {
  pageBg: '#ffffff',
  stripeBg: '#2563eb',
  headingText: '#0f172a',
  bodyText: '#334155',
  mutedText: '#64748b',
  lightText: '#94a3b8',
  cardBg: '#f8fafc',
  tableHeaderBg: '#f1f5f9',
  tableRowAltBg: '#f8fafc',
  dividerColor: '#e2e8f0',
  accentBlue: '#2563eb',
  accentGreen: '#22c55e',
  accentGreenDark: '#16a34a',
  accentGreenBg: '#f0fdf4',
  accentRed: '#ef4444',
  accentRedDark: '#dc2626',
  accentRedBg: '#fef2f2',
  accentAmber: '#f59e0b',
  accentAmberBg: '#fffbeb',
  accentGray: '#9ca3af',
  accentOrange: '#f97316',
};

const DARK: PdfColorScheme = {
  pageBg: '#0f172a',
  stripeBg: '#6366f1',
  headingText: '#f1f5f9',
  bodyText: '#cbd5e1',
  mutedText: '#94a3b8',
  lightText: '#64748b',
  cardBg: '#1e293b',
  tableHeaderBg: '#1e293b',
  tableRowAltBg: '#162032',
  dividerColor: '#334155',
  accentBlue: '#818cf8',
  accentGreen: '#34d399',
  accentGreenDark: '#10b981',
  accentGreenBg: '#064e3b',
  accentRed: '#f87171',
  accentRedDark: '#ef4444',
  accentRedBg: '#450a0a',
  accentAmber: '#fbbf24',
  accentAmberBg: '#451a03',
  accentGray: '#6b7280',
  accentOrange: '#fb923c',
};

const MINIMAL: PdfColorScheme = {
  pageBg: '#ffffff',
  stripeBg: '#374151',
  headingText: '#111827',
  bodyText: '#374151',
  mutedText: '#6b7280',
  lightText: '#9ca3af',
  cardBg: '#f9fafb',
  tableHeaderBg: '#f3f4f6',
  tableRowAltBg: '#f9fafb',
  dividerColor: '#e5e7eb',
  accentBlue: '#374151',
  accentGreen: '#374151',
  accentGreenDark: '#1f2937',
  accentGreenBg: '#f3f4f6',
  accentRed: '#6b7280',
  accentRedDark: '#374151',
  accentRedBg: '#f3f4f6',
  accentAmber: '#6b7280',
  accentAmberBg: '#f3f4f6',
  accentGray: '#9ca3af',
  accentOrange: '#6b7280',
};

const PDF_THEMES: Record<PdfThemeName, PdfColorScheme> = {
  corporate: CORPORATE,
  dark: DARK,
  minimal: MINIMAL,
};

function gradeColors(s: PdfColorScheme): Record<string, string> {
  return {
    A: s.accentGreen, B: s.accentBlue, C: s.accentAmber, D: s.accentOrange, F: s.accentRed,
  };
}

// A4 Portrait
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 30;
const BODY_TOP = MARGIN + 10; // start of content on page 1
const CONTENT_BOTTOM = PAGE_H - MARGIN - FOOTER_H - 10;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function getReporterVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '\u2026';
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function computeStats(results: TestResultData[]) {
  const total = results.length;
  const passed = results.filter(
    r => r.status === 'passed' || r.outcome === 'expected' || r.outcome === 'flaky',
  ).length;
  const failed = results.filter(
    r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut'),
  ).length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const flaky = results.filter(r => r.outcome === 'flaky').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  return { total, passed, failed, skipped, flaky, passRate };
}

function computeAverageGrade(results: TestResultData[]): string | undefined {
  const gradeMap: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };
  const reverseMap: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'F' };
  const graded = results.filter(r => r.stabilityScore?.grade);
  if (graded.length === 0) return undefined;
  const sum = graded.reduce((acc, r) => acc + (gradeMap[r.stabilityScore!.grade] || 0), 0);
  return reverseMap[Math.round(sum / graded.length)] || 'C';
}

// ---------------------------------------------------------------------------
// Page management
// ---------------------------------------------------------------------------
let pageCount = 0;

function ensureSpace(doc: PDFKit.PDFDocument, y: number, needed: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  if (y + needed > CONTENT_BOTTOM) {
    drawFooter(doc, version, pageCount, scheme, footerText);
    doc.addPage();
    pageCount++;
    if (scheme.pageBg !== '#ffffff') drawPageBg(doc, scheme);
    drawPageHeader(doc, scheme);
    return MARGIN + 34;
  }
  return y;
}

function drawPageBg(doc: PDFKit.PDFDocument, scheme: PdfColorScheme): void {
  doc.save();
  doc.rect(0, 0, PAGE_W, PAGE_H).fill(scheme.pageBg);
  doc.restore();
}

function drawPageHeader(doc: PDFKit.PDFDocument, scheme: PdfColorScheme): void {
  doc.save();
  doc.moveTo(MARGIN, MARGIN + 24)
    .lineTo(MARGIN + CONTENT_W, MARGIN + 24)
    .strokeColor(scheme.dividerColor)
    .lineWidth(0.5)
    .stroke();
  doc.restore();
}

function drawFooter(doc: PDFKit.PDFDocument, version: string, page: number, scheme: PdfColorScheme, brandingFooter?: string): void {
  const y = PAGE_H - MARGIN - FOOTER_H;
  doc.save();
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).strokeColor(scheme.dividerColor).lineWidth(0.5).stroke();
  doc.fontSize(7).fillColor(scheme.lightText);
  const left = brandingFooter || `Generated by playwright-smart-reporter v${version}`;
  doc.text(left, MARGIN, y + 10, { width: CONTENT_W * 0.6 });
  doc.text(
    `Page ${page}  \u00B7  ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    MARGIN + CONTENT_W * 0.6,
    y + 10,
    { width: CONTENT_W * 0.4, align: 'right' },
  );
  doc.restore();
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------
function drawDonut(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  segments: { value: number; color: string }[],
): void {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return;
  let startAngle = -Math.PI / 2;
  const segCount = 40;

  for (const seg of segments) {
    if (seg.value === 0) continue;
    const sweepAngle = (seg.value / total) * 2 * Math.PI;
    const outerPoints: [number, number][] = [];
    const innerPoints: [number, number][] = [];
    for (let i = 0; i <= segCount; i++) {
      const angle = startAngle + (sweepAngle * i) / segCount;
      outerPoints.push([cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR]);
      innerPoints.push([cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR]);
    }
    doc.save();
    doc.fillColor(hexToRgb(seg.color));
    doc.moveTo(outerPoints[0][0], outerPoints[0][1]);
    for (let i = 1; i < outerPoints.length; i++) doc.lineTo(outerPoints[i][0], outerPoints[i][1]);
    doc.lineTo(innerPoints[innerPoints.length - 1][0], innerPoints[innerPoints.length - 1][1]);
    for (let i = innerPoints.length - 2; i >= 0; i--) doc.lineTo(innerPoints[i][0], innerPoints[i][1]);
    doc.closePath().fill();
    doc.restore();
    startAngle += sweepAngle;
  }
}

function drawHorizontalBar(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  segments: { value: number; color: string }[],
  scheme: PdfColorScheme,
): void {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    doc.save();
    doc.roundedRect(x, y, w, h, h / 2).fill(scheme.dividerColor);
    doc.restore();
    return;
  }
  // Draw background
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).fill(scheme.dividerColor);
  doc.restore();
  // Draw segments left-to-right, clip to rounded rect
  doc.save();
  doc.roundedRect(x, y, w, h, h / 2).clip();
  let cx = x;
  for (const seg of segments) {
    if (seg.value === 0) continue;
    const segW = (seg.value / total) * w;
    doc.rect(cx, y, segW, h).fill(seg.color);
    cx += segW;
  }
  doc.restore();
}

function drawSparkline(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  values: number[],
  color: string,
): void {
  if (values.length < 2) return;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;
  const rgb = hexToRgb(color);
  doc.save();
  doc.strokeColor(rgb).lineWidth(1.5);
  const stepX = w / (values.length - 1);
  const firstPtY = y + h - ((values[0] - minVal) / range) * h;
  doc.moveTo(x, firstPtY);
  for (let i = 1; i < values.length; i++) {
    const ptX = x + stepX * i;
    const ptY = y + h - ((values[i] - minVal) / range) * h;
    doc.lineTo(ptX, ptY);
  }
  doc.stroke();
  // Draw end dot
  const lastY = y + h - ((values[values.length - 1] - minVal) / range) * h;
  doc.circle(x + w, lastY, 2.5).fill(rgb);
  doc.restore();
}

// ---------------------------------------------------------------------------
// Section: Title block (page 1)
// ---------------------------------------------------------------------------
function drawTitleBlock(doc: PDFKit.PDFDocument, data: ExecutivePdfData, version: string, scheme: PdfColorScheme): number {
  let y = MARGIN;

  // Accent stripe at very top of page
  doc.save();
  doc.rect(0, 0, PAGE_W, 4).fill(scheme.stripeBg);
  doc.restore();

  // Project name
  const title = data.branding?.title || data.projectName || 'Test Report';
  doc.save();
  doc.font('Helvetica-Bold').fontSize(22).fillColor(scheme.headingText);
  doc.text(title, MARGIN, y + 10, { width: CONTENT_W });
  doc.restore();

  y += 38;

  // Subtitle: Executive Summary
  doc.save();
  doc.font('Helvetica').fontSize(11).fillColor(scheme.mutedText);
  doc.text('Executive Test Summary', MARGIN, y);
  doc.restore();

  y += 20;

  // Metadata line: date | CI info | version
  const datePart = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const ciParts: string[] = [datePart];
  if (data.ciInfo) {
    if (data.ciInfo.branch) ciParts.push(`Branch: ${data.ciInfo.branch}`);
    if (data.ciInfo.commit) ciParts.push(`Commit: ${data.ciInfo.commit.substring(0, 7)}`);
    if (data.ciInfo.buildId) ciParts.push(`Build: ${data.ciInfo.buildId}`);
  }
  doc.save();
  doc.font('Helvetica').fontSize(8).fillColor(scheme.lightText);
  doc.text(ciParts.join('  |  '), MARGIN, y, { width: CONTENT_W });
  doc.restore();

  y += 14;

  // Accent divider
  doc.save();
  doc.rect(MARGIN, y, 60, 3).fill(scheme.stripeBg);
  doc.restore();

  return y + 14;
}

// ---------------------------------------------------------------------------
// Section: Verdict banner
// ---------------------------------------------------------------------------
function drawVerdictBanner(doc: PDFKit.PDFDocument, data: ExecutivePdfData, scheme: PdfColorScheme): number {
  let y = 108;
  const stats = computeStats(data.results);
  const duration = Date.now() - data.startTime;
  const bannerH = 52;

  // Determine verdict
  let verdictText: string;
  let subtitleText: string;
  let bgColor: string;
  let textColor: string;
  let accentColor: string;

  if (data.qualityGateResult) {
    const gatesPassed = data.qualityGateResult.passed;
    verdictText = gatesPassed ? 'QUALITY GATES PASSED' : 'QUALITY GATES FAILED';
    bgColor = gatesPassed ? scheme.accentGreenBg : scheme.accentRedBg;
    textColor = gatesPassed ? scheme.accentGreenDark : scheme.accentRedDark;
    accentColor = gatesPassed ? scheme.accentGreen : scheme.accentRed;
    const passedRules = data.qualityGateResult.rules.filter(r => r.passed).length;
    const totalRules = data.qualityGateResult.rules.length;
    subtitleText = `${passedRules}/${totalRules} rules passed  \u00B7  ${stats.total} tests  \u00B7  ${stats.passRate}% pass rate  \u00B7  ${formatDuration(duration)}`;
  } else if (stats.failed === 0) {
    verdictText = 'ALL TESTS PASSED';
    bgColor = scheme.accentGreenBg;
    textColor = scheme.accentGreenDark;
    accentColor = scheme.accentGreen;
    subtitleText = `${stats.total} tests  \u00B7  ${stats.passRate}% pass rate  \u00B7  ${formatDuration(duration)}`;
  } else {
    verdictText = `${stats.failed} FAILURE${stats.failed === 1 ? '' : 'S'} DETECTED`;
    bgColor = scheme.accentRedBg;
    textColor = scheme.accentRedDark;
    accentColor = scheme.accentRed;
    subtitleText = `${stats.total} tests  \u00B7  ${stats.passRate}% pass rate  \u00B7  ${formatDuration(duration)}`;
  }

  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, bannerH, 6).fill(bgColor);
  doc.rect(MARGIN, y, 4, bannerH).fill(accentColor);

  doc.font('Helvetica-Bold').fontSize(15).fillColor(textColor);
  doc.text(verdictText, MARGIN + 16, y + 10, { width: CONTENT_W - 32 });

  doc.font('Helvetica').fontSize(8).fillColor(scheme.mutedText);
  doc.text(subtitleText, MARGIN + 16, y + 30, { width: CONTENT_W - 32 });
  doc.restore();

  return y + bannerH + 16;
}

// ---------------------------------------------------------------------------
// Section: KPI cards
// ---------------------------------------------------------------------------
function drawKpiCards(doc: PDFKit.PDFDocument, data: ExecutivePdfData, scheme: PdfColorScheme): number {
  const y = 178;
  const stats = computeStats(data.results);
  const duration = Date.now() - data.startTime;
  const grade = computeAverageGrade(data.results);
  const gc = gradeColors(scheme);

  const cardGap = 12;
  const cardW = (CONTENT_W - cardGap * 4) / 5;
  const cardH = 68;

  const metrics = [
    { label: 'Total Tests', value: String(stats.total), accent: scheme.accentBlue },
    { label: 'Pass Rate', value: `${stats.passRate}%`, accent: stats.passRate >= 80 ? scheme.accentGreenDark : scheme.accentRedDark },
    { label: 'Failed', value: String(stats.failed), accent: stats.failed === 0 ? scheme.accentGreenDark : scheme.accentRedDark },
    { label: 'Flaky', value: String(stats.flaky), accent: stats.flaky === 0 ? scheme.accentGreenDark : scheme.accentAmber },
    { label: 'Duration', value: formatDuration(duration), accent: scheme.bodyText },
  ];

  for (let i = 0; i < metrics.length; i++) {
    const mx = MARGIN + i * (cardW + cardGap);
    const m = metrics[i];

    doc.save();
    // Card background
    doc.roundedRect(mx, y, cardW, cardH, 4).fill(scheme.cardBg);
    // Top accent bar
    doc.save();
    doc.roundedRect(mx, y, cardW, 4, 4).clip();
    doc.rect(mx, y, cardW, 4).fill(m.accent);
    doc.restore();

    // Value
    doc.font('Helvetica-Bold').fontSize(20).fillColor(m.accent);
    doc.text(m.value, mx + 4, y + 14, { width: cardW - 8, align: 'center' });

    // Label
    doc.font('Helvetica').fontSize(7.5).fillColor(scheme.mutedText);
    doc.text(m.label, mx + 4, y + 42, { width: cardW - 8, align: 'center' });

    doc.restore();
  }

  // Stability grade - render as badge if available
  if (grade) {
    const badgeX = MARGIN + CONTENT_W - 65;
    const badgeY = y + cardH + 6;
    doc.save();
    doc.roundedRect(badgeX, badgeY, 65, 18, 9).fill(gc[grade] || scheme.mutedText);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text(`Stability: ${grade}`, badgeX + 2, badgeY + 4, { width: 61, align: 'center' });
    doc.restore();
  }

  return y + cardH + 30;
}

// ---------------------------------------------------------------------------
// Section: Distribution donut + stacked bar
// ---------------------------------------------------------------------------
function drawDistributionSection(doc: PDFKit.PDFDocument, data: ExecutivePdfData, startY: number, scheme: PdfColorScheme): number {
  let y = startY;
  const stats = computeStats(data.results);
  const sectionH = 160;

  // Section title
  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Test Distribution', MARGIN, y);
  doc.restore();
  y += 18;

  // Donut chart - left side
  const donutCx = MARGIN + 80;
  const donutCy = y + (sectionH - 18) / 2;
  const outerR = 55;
  const innerR = 38;

  const segments = [
    { value: Math.max(0, stats.passed - stats.flaky), color: scheme.accentGreen },
    { value: stats.flaky, color: scheme.accentAmber },
    { value: stats.failed, color: scheme.accentRed },
    { value: stats.skipped, color: scheme.accentGray },
  ].filter(s => s.value > 0);

  if (segments.length > 0) {
    drawDonut(doc, donutCx, donutCy, outerR, innerR, segments);
  } else {
    doc.save();
    doc.circle(donutCx, donutCy, outerR).lineWidth(outerR - innerR).strokeColor(scheme.dividerColor).stroke();
    doc.restore();
  }

  // Center text in donut
  doc.save();
  doc.font('Helvetica-Bold').fontSize(18).fillColor(stats.passRate >= 80 ? scheme.accentGreenDark : scheme.accentRedDark);
  doc.text(`${stats.passRate}%`, donutCx - 28, donutCy - 12, { width: 56, align: 'center' });
  doc.font('Helvetica').fontSize(7).fillColor(scheme.mutedText);
  doc.text('pass rate', donutCx - 28, donutCy + 8, { width: 56, align: 'center' });
  doc.restore();

  // Legend + breakdown - right side
  const legendX = MARGIN + 190;
  const legendW = CONTENT_W - 190;

  // Stacked horizontal bar
  const barY = y + 8;
  const barH = 14;
  drawHorizontalBar(doc, legendX, barY, legendW, barH, segments, scheme);

  // Legend items below bar
  const legendItems = [
    { label: 'Passed', count: Math.max(0, stats.passed - stats.flaky), color: scheme.accentGreen },
    { label: 'Flaky', count: stats.flaky, color: scheme.accentAmber },
    { label: 'Failed', count: stats.failed, color: scheme.accentRed },
    { label: 'Skipped', count: stats.skipped, color: scheme.accentGray },
  ];

  let ly = barY + barH + 12;
  const colW = legendW / 2;
  for (let i = 0; i < legendItems.length; i++) {
    const item = legendItems[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const lx = legendX + col * colW;
    const itemY = ly + row * 26;

    doc.save();
    doc.circle(lx + 5, itemY + 5, 4).fill(item.color);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(scheme.bodyText);
    doc.text(`${item.count}`, lx + 14, itemY, { width: 40 });
    doc.font('Helvetica').fontSize(8).fillColor(scheme.mutedText);
    doc.text(item.label, lx + 14, itemY + 12, { width: 80 });
    doc.restore();
  }

  // File breakdown mini-table
  const suiteMap = new Map<string, { total: number; passed: number; failed: number; flaky: number }>();
  for (const r of data.results) {
    const key = r.file;
    if (!suiteMap.has(key)) suiteMap.set(key, { total: 0, passed: 0, failed: 0, flaky: 0 });
    const s = suiteMap.get(key)!;
    s.total++;
    if (r.outcome === 'flaky') s.flaky++;
    else if (r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut')) s.failed++;
    else if (r.status === 'passed' || r.outcome === 'expected') s.passed++;
  }

  if (suiteMap.size > 1) {
    const tableY = ly + 56;
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(scheme.bodyText);
    doc.text('Breakdown by file', legendX, tableY);
    doc.restore();

    let ty = tableY + 14;
    const entries = [...suiteMap.entries()].sort((a, b) => {
      const rateA = a[1].total > 0 ? a[1].passed / a[1].total : 1;
      const rateB = b[1].total > 0 ? b[1].passed / b[1].total : 1;
      return rateA - rateB; // worst first
    }).slice(0, 5);

    for (const [file, s] of entries) {
      const pct = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
      doc.save();
      // Mini bar
      const miniBarW = 60;
      const filledW = (pct / 100) * miniBarW;
      doc.roundedRect(legendX, ty + 1, miniBarW, 8, 4).fill(scheme.dividerColor);
      if (filledW > 0) {
        doc.save();
        doc.roundedRect(legendX, ty + 1, miniBarW, 8, 4).clip();
        doc.rect(legendX, ty + 1, filledW, 8).fill(pct >= 80 ? scheme.accentGreen : pct >= 50 ? scheme.accentAmber : scheme.accentRed);
        doc.restore();
      }
      doc.font('Helvetica').fontSize(7).fillColor(scheme.bodyText);
      doc.text(`${pct}%`, legendX + miniBarW + 6, ty, { width: 28 });
      doc.text(truncate(file, 50), legendX + miniBarW + 34, ty, { width: legendW - miniBarW - 34 });
      doc.restore();
      ty += 14;
    }
  }

  return y + sectionH;
}

// ---------------------------------------------------------------------------
// Section: Quality gates
// ---------------------------------------------------------------------------
function drawQualityGates(doc: PDFKit.PDFDocument, result: QualityGateResult, startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  let y = ensureSpace(doc, startY, 100, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Quality Gates', MARGIN, y);
  doc.restore();
  y += 18;

  // Gate table
  const colWidths = [CONTENT_W * 0.35, CONTENT_W * 0.2, CONTENT_W * 0.2, CONTENT_W * 0.25];
  const rowH = 22;

  // Header row
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 3).fill(scheme.tableHeaderBg);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(scheme.bodyText);
  doc.text('Rule', MARGIN + 8, y + 6, { width: colWidths[0] });
  doc.text('Actual', MARGIN + colWidths[0] + 4, y + 6, { width: colWidths[1] });
  doc.text('Threshold', MARGIN + colWidths[0] + colWidths[1] + 4, y + 6, { width: colWidths[2] });
  doc.text('Status', MARGIN + colWidths[0] + colWidths[1] + colWidths[2] + 4, y + 6, { width: colWidths[3] });
  doc.restore();
  y += rowH;

  for (let i = 0; i < result.rules.length; i++) {
    const rule = result.rules[i];
    if (i % 2 === 1) {
      doc.save();
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(scheme.tableRowAltBg);
      doc.restore();
    }

    const statusColor = rule.skipped ? scheme.lightText : rule.passed ? scheme.accentGreenDark : scheme.accentRedDark;
    const statusText = rule.skipped ? 'Skipped' : rule.passed ? 'Passed' : 'Failed';
    const statusIcon = rule.skipped ? '-' : rule.passed ? '\u2713' : '\u2717';

    doc.save();
    doc.font('Helvetica').fontSize(8).fillColor(scheme.bodyText);
    doc.text(formatRuleName(rule.rule), MARGIN + 8, y + 6, { width: colWidths[0] });
    doc.text(rule.actual, MARGIN + colWidths[0] + 4, y + 6, { width: colWidths[1] });
    doc.text(rule.threshold, MARGIN + colWidths[0] + colWidths[1] + 4, y + 6, { width: colWidths[2] });

    // Status badge
    const badgeX = MARGIN + colWidths[0] + colWidths[1] + colWidths[2] + 4;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(statusColor);
    doc.text(`${statusIcon} ${statusText}`, badgeX, y + 6, { width: colWidths[3] });
    doc.restore();

    y += rowH;
  }

  // Overall result
  y += 4;
  const passed = result.passed;
  doc.save();
  const overallW = 140;
  const overallX = MARGIN + CONTENT_W - overallW;
  doc.roundedRect(overallX, y, overallW, 22, 4).fill(passed ? scheme.accentGreenBg : scheme.accentRedBg);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(passed ? scheme.accentGreenDark : scheme.accentRedDark);
  doc.text(
    passed ? '\u2713  All gates passed' : '\u2717  Gates failed',
    overallX + 8,
    y + 5,
    { width: overallW - 16 },
  );
  doc.restore();

  return y + 32;
}

function formatRuleName(rule: string): string {
  const names: Record<string, string> = {
    maxFailures: 'Maximum Failures',
    minPassRate: 'Minimum Pass Rate',
    maxFlakyRate: 'Maximum Flaky Rate',
    minStabilityGrade: 'Minimum Stability Grade',
    noNewFailures: 'No New Failures',
  };
  return names[rule] || rule;
}

// ---------------------------------------------------------------------------
// Section: Trend charts
// ---------------------------------------------------------------------------
function drawTrendCharts(doc: PDFKit.PDFDocument, summaries: RunSummary[], startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  if (!summaries || summaries.length < 2) return startY;

  let y = ensureSpace(doc, startY, 180, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Trends', MARGIN, y);
  doc.restore();
  y += 20;

  const chartW = (CONTENT_W - 20) / 2;
  const chartH = 60;

  const charts = [
    { label: 'Pass Rate', values: summaries.map(s => s.passRate), color: scheme.accentGreen, suffix: '%' },
    { label: 'Duration', values: summaries.map(s => s.duration), color: scheme.accentBlue, suffix: '' },
    { label: 'Total Tests', values: summaries.map(s => s.total), color: scheme.bodyText, suffix: '' },
    { label: 'Flaky Tests', values: summaries.map(s => s.flaky), color: scheme.accentAmber, suffix: '' },
  ];

  for (let i = 0; i < charts.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = MARGIN + col * (chartW + 20);
    const cy = y + row * (chartH + 40);

    const chart = charts[i];
    const latest = chart.values[chart.values.length - 1];
    const prev = chart.values.length >= 2 ? chart.values[chart.values.length - 2] : latest;
    const diff = latest - prev;
    const diffStr = diff === 0 ? '' : diff > 0 ? ` (+${chart.label === 'Duration' ? formatDuration(diff) : diff + chart.suffix})` : ` (${chart.label === 'Duration' ? '-' + formatDuration(Math.abs(diff)) : diff + chart.suffix})`;

    // Label
    doc.save();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(scheme.bodyText);
    doc.text(chart.label, cx, cy);

    // Latest value
    const latestStr = chart.label === 'Duration' ? formatDuration(latest) : `${latest}${chart.suffix}`;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(chart.color);
    doc.text(latestStr, cx, cy + 12, { width: chartW * 0.5, continued: false });

    // Diff
    if (diffStr) {
      doc.font('Helvetica').fontSize(7).fillColor(scheme.lightText);
      doc.text(diffStr, cx + chartW * 0.5, cy + 16, { width: chartW * 0.5, align: 'right' });
    }
    doc.restore();

    // Sparkline
    drawSparkline(doc, cx, cy + 32, chartW, chartH - 32, chart.values, chart.color);

    // Subtle axis line
    doc.save();
    doc.moveTo(cx, cy + chartH).lineTo(cx + chartW, cy + chartH).strokeColor(scheme.dividerColor).lineWidth(0.5).stroke();
    doc.restore();
  }

  const totalRows = Math.ceil(charts.length / 2);
  return y + totalRows * (chartH + 40) + 10;
}

// ---------------------------------------------------------------------------
// Section: Failures table
// ---------------------------------------------------------------------------
function drawFailuresSection(doc: PDFKit.PDFDocument, data: ExecutivePdfData, startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  const failures = data.results
    .filter(r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut'))
    .slice(0, 15);

  if (failures.length === 0) return startY;

  let y = ensureSpace(doc, startY, 80, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Failure Details', MARGIN, y);
  doc.restore();
  y += 18;

  const colWidths = [CONTENT_W * 0.30, CONTENT_W * 0.25, CONTENT_W * 0.35, CONTENT_W * 0.10];
  const rowH = 28;

  // Header
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, 20, 3).fill(scheme.tableHeaderBg);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(scheme.bodyText);
  doc.text('Test', MARGIN + 8, y + 5, { width: colWidths[0] });
  doc.text('File', MARGIN + colWidths[0] + 4, y + 5, { width: colWidths[1] });
  doc.text('Error', MARGIN + colWidths[0] + colWidths[1] + 4, y + 5, { width: colWidths[2] });
  doc.text('Time', MARGIN + colWidths[0] + colWidths[1] + colWidths[2] + 4, y + 5, { width: colWidths[3] });
  doc.restore();
  y += 22;

  for (let i = 0; i < failures.length; i++) {
    y = ensureSpace(doc, y, rowH, version, scheme, footerText);
    const f = failures[i];
    const errorFirstLine = (f.error || 'Unknown error').split('\n')[0];

    if (i % 2 === 0) {
      doc.save();
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(scheme.tableRowAltBg);
      doc.restore();
    }

    doc.save();
    doc.font('Helvetica-Bold').fontSize(7).fillColor(scheme.bodyText);
    doc.text(truncate(f.title, 45), MARGIN + 8, y + 4, { width: colWidths[0] - 12, lineBreak: false });
    doc.font('Helvetica').fontSize(7).fillColor(scheme.mutedText);
    doc.text(truncate(f.file, 35), MARGIN + colWidths[0] + 4, y + 4, { width: colWidths[1] - 8, lineBreak: false });
    doc.font('Helvetica').fontSize(6.5).fillColor(scheme.accentRedDark);
    doc.text(truncate(errorFirstLine, 55), MARGIN + colWidths[0] + colWidths[1] + 4, y + 4, { width: colWidths[2] - 8, height: rowH - 6 });
    doc.font('Helvetica').fontSize(7).fillColor(scheme.mutedText);
    doc.text(formatDuration(f.duration), MARGIN + colWidths[0] + colWidths[1] + colWidths[2] + 4, y + 4, { width: colWidths[3] - 4, lineBreak: false });
    doc.restore();

    y += rowH;
  }

  return y + 8;
}

// ---------------------------------------------------------------------------
// Section: Failure clusters with AI suggestions
// ---------------------------------------------------------------------------
function drawFailureClusters(doc: PDFKit.PDFDocument, clusters: FailureCluster[], startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  if (!clusters || clusters.length === 0) return startY;

  let y = ensureSpace(doc, startY, 80, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Failure Clusters & AI Recommendations', MARGIN, y);
  doc.restore();
  y += 18;

  for (const cluster of clusters.slice(0, 6)) {
    const blockH = cluster.aiSuggestion ? 70 : 40;
    y = ensureSpace(doc, y, blockH, version, scheme, footerText);

    // Cluster header
    doc.save();
    doc.roundedRect(MARGIN, y, CONTENT_W, blockH, 4).fill(scheme.tableRowAltBg);
    doc.rect(MARGIN, y, 3, blockH).fill(scheme.accentRed);

    // Error type + count
    doc.font('Helvetica-Bold').fontSize(8).fillColor(scheme.bodyText);
    doc.text(truncate(cluster.errorType, 60), MARGIN + 12, y + 6, { width: CONTENT_W * 0.6 });
    doc.font('Helvetica').fontSize(7).fillColor(scheme.mutedText);
    doc.text(`${cluster.count} test${cluster.count === 1 ? '' : 's'} affected`, MARGIN + CONTENT_W * 0.6 + 12, y + 7, { width: CONTENT_W * 0.35, align: 'right' });

    // Affected test names
    const testNames = cluster.tests.slice(0, 3).map(t => t.title).join(', ');
    doc.font('Helvetica').fontSize(7).fillColor(scheme.mutedText);
    doc.text(truncate(testNames, 100), MARGIN + 12, y + 20, { width: CONTENT_W - 24 });

    // AI suggestion
    if (cluster.aiSuggestion) {
      const aiY = y + 36;
      doc.roundedRect(MARGIN + 12, aiY, CONTENT_W - 24, blockH - 42, 3).fill(scheme.cardBg);
      doc.rect(MARGIN + 12, aiY, 3, blockH - 42).fill(scheme.accentBlue);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(scheme.accentBlue);
      doc.text('AI', MARGIN + 20, aiY + 3, { width: 14 });
      doc.font('Helvetica').fontSize(7).fillColor(scheme.bodyText);
      doc.text(truncate(cluster.aiSuggestion, 160), MARGIN + 34, aiY + 3, { width: CONTENT_W - 58, height: blockH - 48 });
    }

    doc.restore();
    y += blockH + 8;
  }

  return y;
}

// ---------------------------------------------------------------------------
// Section: Quarantine summary
// ---------------------------------------------------------------------------
function drawQuarantineSection(doc: PDFKit.PDFDocument, entries: QuarantineEntry[], threshold: number | undefined, startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  if (!entries || entries.length === 0) return startY;

  let y = ensureSpace(doc, startY, 60, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Quarantined Tests', MARGIN, y);
  if (threshold !== undefined) {
    doc.font('Helvetica').fontSize(8).fillColor(scheme.lightText);
    doc.text(`Flakiness threshold: ${(threshold * 100).toFixed(0)}%`, MARGIN + 160, y + 2, { width: CONTENT_W - 160 });
  }
  doc.restore();
  y += 18;

  // Warning banner
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, 24, 4).fill(scheme.accentAmberBg);
  doc.rect(MARGIN, y, 3, 24).fill(scheme.accentAmber);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(scheme.accentAmber);
  doc.text(`${entries.length} test${entries.length === 1 ? '' : 's'} quarantined due to high flakiness`, MARGIN + 12, y + 6, { width: CONTENT_W - 24 });
  doc.restore();
  y += 32;

  // Entries table
  const colWidths = [CONTENT_W * 0.40, CONTENT_W * 0.35, CONTENT_W * 0.25];
  const rowH = 20;

  // Header
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 3).fill(scheme.tableHeaderBg);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(scheme.bodyText);
  doc.text('Test', MARGIN + 8, y + 5, { width: colWidths[0] });
  doc.text('File', MARGIN + colWidths[0] + 4, y + 5, { width: colWidths[1] });
  doc.text('Flakiness Score', MARGIN + colWidths[0] + colWidths[1] + 4, y + 5, { width: colWidths[2] });
  doc.restore();
  y += rowH;

  for (let i = 0; i < Math.min(entries.length, 10); i++) {
    y = ensureSpace(doc, y, rowH, version, scheme, footerText);
    const e = entries[i];
    if (i % 2 === 0) {
      doc.save();
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(scheme.tableRowAltBg);
      doc.restore();
    }

    const scorePct = Math.round(e.flakinessScore * 100);

    doc.save();
    doc.font('Helvetica').fontSize(7).fillColor(scheme.bodyText);
    doc.text(truncate(e.title, 55), MARGIN + 8, y + 5, { width: colWidths[0] - 12, lineBreak: false });
    doc.fillColor(scheme.mutedText);
    doc.text(truncate(e.file, 45), MARGIN + colWidths[0] + 4, y + 5, { width: colWidths[1] - 8, lineBreak: false });

    // Score with mini bar
    const barX = MARGIN + colWidths[0] + colWidths[1] + 4;
    const barW = colWidths[2] * 0.5;
    const filledW = (scorePct / 100) * barW;
    doc.roundedRect(barX, y + 6, barW, 8, 4).fill(scheme.dividerColor);
    if (filledW > 0) {
      doc.save();
      doc.roundedRect(barX, y + 6, barW, 8, 4).clip();
      doc.rect(barX, y + 6, filledW, 8).fill(scorePct >= 80 ? scheme.accentRed : scheme.accentAmber);
      doc.restore();
    }
    doc.font('Helvetica-Bold').fontSize(7).fillColor(scorePct >= 80 ? scheme.accentRedDark : scheme.accentAmber);
    doc.text(`${scorePct}%`, barX + barW + 6, y + 5, { width: 30 });

    doc.restore();
    y += rowH;
  }

  return y + 8;
}

// ---------------------------------------------------------------------------
// Section: Suite breakdown table (full page)
// ---------------------------------------------------------------------------
function drawSuiteBreakdown(doc: PDFKit.PDFDocument, data: ExecutivePdfData, startY: number, version: string, scheme: PdfColorScheme, footerText?: string): number {
  const suiteMap = new Map<string, { total: number; passed: number; failed: number; flaky: number; skipped: number; duration: number }>();
  for (const r of data.results) {
    if (!suiteMap.has(r.file)) suiteMap.set(r.file, { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, duration: 0 });
    const s = suiteMap.get(r.file)!;
    s.total++;
    s.duration += r.duration;
    if (r.outcome === 'flaky') s.flaky++;
    else if (r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut')) s.failed++;
    else if (r.status === 'skipped') s.skipped++;
    else s.passed++;
  }

  if (suiteMap.size <= 1) return startY;

  let y = ensureSpace(doc, startY, 80, version, scheme, footerText);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(scheme.headingText);
  doc.text('Suite Breakdown', MARGIN, y);
  doc.restore();
  y += 18;

  const colWidths = [CONTENT_W * 0.32, CONTENT_W * 0.10, CONTENT_W * 0.10, CONTENT_W * 0.10, CONTENT_W * 0.10, CONTENT_W * 0.13, CONTENT_W * 0.15];
  const rowH = 20;

  // Header
  doc.save();
  doc.roundedRect(MARGIN, y, CONTENT_W, rowH, 3).fill(scheme.tableHeaderBg);
  doc.font('Helvetica-Bold').fontSize(7).fillColor(scheme.bodyText);
  let hx = MARGIN + 8;
  for (const [label, w] of [['File', colWidths[0]], ['Total', colWidths[1]], ['Passed', colWidths[2]], ['Failed', colWidths[3]], ['Flaky', colWidths[4]], ['Duration', colWidths[5]], ['Pass Rate', colWidths[6]]] as [string, number][]) {
    doc.text(label, hx, y + 5, { width: w - 8 });
    hx += w;
  }
  doc.restore();
  y += rowH;

  const entries = [...suiteMap.entries()].sort((a, b) => {
    const rateA = a[1].total > 0 ? a[1].passed / a[1].total : 1;
    const rateB = b[1].total > 0 ? b[1].passed / b[1].total : 1;
    return rateA - rateB;
  });

  for (let i = 0; i < entries.length; i++) {
    y = ensureSpace(doc, y, rowH, version, scheme, footerText);
    const [file, s] = entries[i];
    const pct = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;

    if (i % 2 === 0) {
      doc.save();
      doc.rect(MARGIN, y, CONTENT_W, rowH).fill(scheme.tableRowAltBg);
      doc.restore();
    }

    doc.save();
    doc.font('Helvetica').fontSize(7).fillColor(scheme.bodyText);
    let rx = MARGIN + 8;
    doc.text(truncate(file, 42), rx, y + 5, { width: colWidths[0] - 8, lineBreak: false });
    rx += colWidths[0];
    doc.text(String(s.total), rx, y + 5, { width: colWidths[1] - 8 });
    rx += colWidths[1];
    doc.fillColor(scheme.accentGreenDark).text(String(s.passed), rx, y + 5, { width: colWidths[2] - 8 });
    rx += colWidths[2];
    doc.fillColor(s.failed > 0 ? scheme.accentRedDark : scheme.mutedText).text(String(s.failed), rx, y + 5, { width: colWidths[3] - 8 });
    rx += colWidths[3];
    doc.fillColor(s.flaky > 0 ? scheme.accentAmber : scheme.mutedText).text(String(s.flaky), rx, y + 5, { width: colWidths[4] - 8 });
    rx += colWidths[4];
    doc.fillColor(scheme.mutedText).text(formatDuration(s.duration), rx, y + 5, { width: colWidths[5] - 8 });
    rx += colWidths[5];

    // Pass rate with color
    doc.font('Helvetica-Bold').fontSize(7);
    doc.fillColor(pct >= 80 ? scheme.accentGreenDark : pct >= 50 ? scheme.accentAmber : scheme.accentRedDark);
    doc.text(`${pct}%`, rx, y + 5, { width: colWidths[6] - 8 });

    doc.restore();
    y += rowH;
  }

  return y + 8;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export function generateExecutivePdf(data: ExecutivePdfData, outputDir: string, basename?: string, theme?: PdfThemeName): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const themeName = theme || 'corporate';
  const scheme = PDF_THEMES[themeName];
  const suffix = themeName === 'corporate' ? '' : `-${themeName}`;
  const filename = `${basename ?? 'smart-report'}${suffix}.pdf`;
  const outputPath = path.resolve(outputDir, filename);
  const version = getReporterVersion();
  const footerText = data.branding?.footer;
  pageCount = 1;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: `${data.projectName || 'Test Report'} - Executive Summary`,
      Author: 'playwright-smart-reporter',
    },
    autoFirstPage: true,
    bufferPages: true,
  });

  // Dark theme: fill page background
  if (scheme.pageBg !== '#ffffff') {
    drawPageBg(doc, scheme);
  }

  // ── Page 1: Executive Summary ──────────────────────────────────
  drawTitleBlock(doc, data, version, scheme);
  drawVerdictBanner(doc, data, scheme);
  drawKpiCards(doc, data, scheme);
  let y = drawDistributionSection(doc, data, 280, scheme);

  // Quality gates (if available)
  if (data.qualityGateResult) {
    y = drawQualityGates(doc, data.qualityGateResult, y, version, scheme, footerText);
  }

  drawFooter(doc, version, pageCount, scheme, footerText);

  // ── Page 2+: Trends & Breakdown ────────────────────────────────
  const summaries = data.history.summaries || [];
  const hasHistory = summaries.length >= 2;
  const hasSuites = new Set(data.results.map(r => r.file)).size > 1;
  const hasFailures = data.results.some(r => r.outcome === 'unexpected' && (r.status === 'failed' || r.status === 'timedOut'));
  const hasClusters = (data.failureClusters?.length ?? 0) > 0;
  const hasQuarantine = (data.quarantineEntries?.length ?? 0) > 0;

  if (hasHistory || hasSuites || hasFailures || hasClusters || hasQuarantine) {
    doc.addPage();
    pageCount++;
    if (scheme.pageBg !== '#ffffff') drawPageBg(doc, scheme);
    drawPageHeader(doc, scheme);
    y = MARGIN + 34;

    if (hasHistory) {
      y = drawTrendCharts(doc, summaries, y, version, scheme, footerText);
    }

    if (hasSuites) {
      y = drawSuiteBreakdown(doc, data, y, version, scheme, footerText);
    }

    // Failures section
    if (hasFailures) {
      y = drawFailuresSection(doc, data, y, version, scheme, footerText);
    }

    // Failure clusters with AI
    if (hasClusters) {
      y = drawFailureClusters(doc, data.failureClusters!, y, version, scheme, footerText);
    }

    // Quarantine
    if (hasQuarantine) {
      y = drawQuarantineSection(doc, data.quarantineEntries!, data.quarantineThreshold, y, version, scheme, footerText);
    }

    drawFooter(doc, version, pageCount, scheme, footerText);
  }

  // Finalize
  doc.end();
  const chunks: Buffer[] = [];
  let chunk: Buffer | null;
  while ((chunk = doc.read() as Buffer | null) !== null) {
    chunks.push(chunk);
  }
  fs.writeFileSync(outputPath, Buffer.concat(chunks));

  return outputPath;
}
