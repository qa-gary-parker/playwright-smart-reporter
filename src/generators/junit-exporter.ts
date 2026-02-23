import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, SmartReporterOptions } from '../types';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function exportJunitXml(
  results: TestResultData[],
  options: SmartReporterOptions,
  outputDir?: string,
): string {
  const baseDir = outputDir ?? (
    options.outputFile
      ? path.dirname(path.resolve(options.outputFile))
      : process.cwd()
  );
  const outputPath = path.resolve(baseDir, 'smart-report-junit.xml');

  // Group tests by spec file
  const suites = new Map<string, TestResultData[]>();
  for (const test of results) {
    const file = test.file;
    if (!suites.has(file)) {
      suites.set(file, []);
    }
    suites.get(file)!.push(test);
  }

  const totalTests = results.length;
  const totalFailures = results.filter(r => r.status === 'failed' || r.status === 'timedOut').length;
  const totalSkipped = results.filter(r => r.status === 'skipped').length;
  const totalErrors = results.filter(r => r.status === 'interrupted').length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0) / 1000;

  const runTimestamp = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="Smart Reporter" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}" time="${totalTime.toFixed(3)}">\n`;

  for (const [file, tests] of suites) {
    const suiteFailures = tests.filter(t => t.status === 'failed' || t.status === 'timedOut').length;
    const suiteSkipped = tests.filter(t => t.status === 'skipped').length;
    const suiteErrors = tests.filter(t => t.status === 'interrupted').length;
    const suiteTime = tests.reduce((sum, t) => sum + t.duration, 0) / 1000;

    xml += `  <testsuite name="${escapeXml(file)}" tests="${tests.length}" failures="${suiteFailures}" errors="${suiteErrors}" skipped="${suiteSkipped}" time="${suiteTime.toFixed(3)}" timestamp="${runTimestamp}">\n`;

    for (const test of tests) {
      const timeSeconds = (test.duration / 1000).toFixed(3);
      const classname = escapeXml(test.file.replace(/\//g, '.').replace(/\.spec\.(ts|js|mts|mjs)$/, ''));

      xml += `    <testcase name="${escapeXml(test.title)}" classname="${classname}" time="${timeSeconds}">\n`;

      // Smart Reporter custom properties
      xml += `      <properties>\n`;
      if (test.stabilityScore) {
        xml += `        <property name="stability-grade" value="${test.stabilityScore.grade}" />\n`;
        xml += `        <property name="stability-score" value="${test.stabilityScore.overall}" />\n`;
      }
      if (test.flakinessScore !== undefined) {
        xml += `        <property name="flakiness-score" value="${test.flakinessScore.toFixed(2)}" />\n`;
      }
      if (test.performanceTrend) {
        xml += `        <property name="performance-trend" value="${escapeXml(test.performanceTrend)}" />\n`;
      }
      if (test.tags && test.tags.length > 0) {
        xml += `        <property name="tags" value="${escapeXml(test.tags.join(','))}" />\n`;
      }
      if (test.retry > 0) {
        xml += `        <property name="retries" value="${test.retry}" />\n`;
      }
      if (test.outcome) {
        xml += `        <property name="outcome" value="${test.outcome}" />\n`;
      }
      xml += `      </properties>\n`;

      if (test.status === 'failed' || test.status === 'timedOut') {
        const failureType = test.status === 'timedOut' ? 'Timeout' : 'AssertionError';
        const message = test.error ? escapeXml(test.error.split('\n')[0]) : 'Test failed';
        const body = test.error ? escapeXml(test.error) : '';
        xml += `      <failure type="${failureType}" message="${message}">${body}</failure>\n`;
      } else if (test.status === 'skipped') {
        xml += `      <skipped />\n`;
      } else if (test.status === 'interrupted') {
        xml += `      <error type="Interrupted" message="Test was interrupted" />\n`;
      }

      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;

  fs.writeFileSync(outputPath, xml, 'utf-8');
  return outputPath;
}
