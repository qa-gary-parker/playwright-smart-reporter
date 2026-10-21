import * as fs from 'fs';
import * as path from 'path';
import type { TestResultData, SmartReporterOptions } from '../types';
import { isFailedTest } from '../utils/flakiness';

// Anything outside the XML 1.0 Char range makes the whole file unparseable, even as a character reference.
const INVALID_XML_CHARS = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

function escapeXml(str: string): string {
  return str
    .replace(INVALID_XML_CHARS, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Playwright's verdict, so the file agrees with its exit code: a test.fail() test that passed is a failure,
// and one that failed as expected passed. Each test counts in one bucket only.
function verdict(test: TestResultData): 'failure' | 'skipped' | 'error' | 'passed' {
  if (isFailedTest(test)) return 'failure';
  if (test.status === 'skipped') return 'skipped';
  if (test.status === 'interrupted') return 'error';
  return 'passed';
}

// An attempt with status 'passed' failed only because test.fail() expected it to fail.
function failureOf(status: TestResultData['status'], error: string | undefined) {
  const type = status === 'timedOut' ? 'Timeout' : 'AssertionError';
  const message = status === 'passed' ? 'Expected to fail, but passed' : error ? escapeXml(error.split('\n')[0]) : 'Test failed';
  return { type, message, body: error ? escapeXml(error) : '' };
}

// As Playwright's JUnit reporter with includeProjectInTestName: the describe path and title, after the
// project when it has a name. suites starts with the file, which is the classname.
function testcaseName(test: TestResultData): string {
  const prefix = test.project ? `[${test.project}] ` : '';
  return prefix + [...(test.suites?.slice(1) ?? []), test.title].join(' › ');
}

export function exportJunitXml(
  results: TestResultData[],
  options: SmartReporterOptions,
  outputDir?: string,
  basename?: string,
): string {
  const baseDir = outputDir ?? (
    options.outputFile
      ? path.dirname(path.resolve(options.outputFile))
      : process.cwd()
  );
  const filename = `${basename ?? 'smart-report'}-junit.xml`;
  const outputPath = path.resolve(baseDir, filename);

  // One testsuite per project and file, as Playwright's JUnit reporter writes them
  const suites = new Map<string, { project: string; file: string; tests: TestResultData[] }>();
  for (const test of results) {
    const project = test.project ?? '';
    const key = `${project}\n${test.file}`;
    if (!suites.has(key)) {
      suites.set(key, { project, file: test.file, tests: [] });
    }
    suites.get(key)!.tests.push(test);
  }

  const count = (tests: TestResultData[], kind: ReturnType<typeof verdict>) => tests.filter(t => verdict(t) === kind).length;
  const totalTests = results.length;
  const totalFailures = count(results, 'failure');
  const totalSkipped = count(results, 'skipped');
  const totalErrors = count(results, 'error');
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0) / 1000;

  const runTimestamp = new Date().toISOString();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<testsuites name="Smart Reporter" tests="${totalTests}" failures="${totalFailures}" errors="${totalErrors}" skipped="${totalSkipped}" time="${totalTime.toFixed(3)}">\n`;

  for (const { project, file, tests } of suites.values()) {
    const suiteFailures = count(tests, 'failure');
    const suiteSkipped = count(tests, 'skipped');
    const suiteErrors = count(tests, 'error');
    const suiteTime = tests.reduce((sum, t) => sum + t.duration, 0) / 1000;

    xml += `  <testsuite name="${escapeXml(file)}" hostname="${escapeXml(project)}" tests="${tests.length}" failures="${suiteFailures}" errors="${suiteErrors}" skipped="${suiteSkipped}" time="${suiteTime.toFixed(3)}" timestamp="${runTimestamp}">\n`;

    for (const test of tests) {
      const timeSeconds = (test.duration / 1000).toFixed(3);

      xml += `    <testcase name="${escapeXml(testcaseName(test))}" classname="${escapeXml(test.file)}" time="${timeSeconds}">\n`;

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

      const kind = verdict(test);
      if (kind === 'failure') {
        const { type, message, body } = failureOf(test.status, test.error);
        xml += `      <failure type="${type}" message="${message}">${body}</failure>\n`;
      } else if (kind === 'skipped') {
        xml += `      <skipped />\n`;
      } else if (kind === 'error') {
        xml += `      <error type="Interrupted" message="Test was interrupted" />\n`;
      }

      // Playwright retries only a failed attempt, so every attempt before the last of a flaky test failed.
      // The test passed, so these are information only and never count as failures.
      if (test.outcome === 'flaky') {
        for (const attempt of test.attempts ?? []) {
          if (attempt.retry >= test.retry) continue;
          const { type, message, body } = failureOf(attempt.status, attempt.error);
          xml += `      <flakyFailure type="${type}" message="${message}">${body ? `<stackTrace>${body}</stackTrace>` : ''}</flakyFailure>\n`;
        }
      }

      xml += `    </testcase>\n`;
    }

    xml += `  </testsuite>\n`;
  }

  xml += `</testsuites>\n`;

  fs.writeFileSync(outputPath, xml, 'utf-8');
  return outputPath;
}
