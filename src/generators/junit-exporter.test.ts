import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { exportJunitXml } from './junit-exporter';
import type {
  TestResultData,
  SmartReporterOptions,
  StabilityScore,
} from '../types';

vi.mock('fs');

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test One',
    file: 'tests/example.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

function createStabilityScore(overrides: Partial<StabilityScore> = {}): StabilityScore {
  return {
    overall: 90,
    flakiness: 95,
    performance: 85,
    reliability: 90,
    grade: 'A',
    needsAttention: false,
    ...overrides,
  };
}

describe('junit-exporter', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportJunitXml', () => {
    it('produces valid XML file at expected path', () => {
      const results = [createTestResult()];
      const options: SmartReporterOptions = { outputFile: '/reports/smart-report.html' };

      const outputPath = exportJunitXml(results, options);

      expect(outputPath).toBe(path.resolve('/reports', 'smart-report-junit.xml'));
      expect(mockFs.writeFileSync).toHaveBeenCalledOnce();

      const [writtenPath, writtenContent] = mockFs.writeFileSync.mock.calls[0];
      expect(writtenPath).toBe(outputPath);
      expect(writtenContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    });

    it('root <testsuites> has correct aggregate counts', () => {
      const results = [
        createTestResult({ testId: '1', status: 'passed', duration: 1000 }),
        createTestResult({ testId: '2', status: 'failed', duration: 2000 }),
        createTestResult({ testId: '3', status: 'skipped', duration: 0 }),
        createTestResult({ testId: '4', status: 'timedOut', duration: 3000 }),
        createTestResult({ testId: '5', status: 'interrupted', duration: 500 }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // tests="5"
      expect(xml).toMatch(/testsuites[^>]*tests="5"/);
      // failures = failed + timedOut = 2
      expect(xml).toMatch(/testsuites[^>]*failures="2"/);
      // skipped = 1
      expect(xml).toMatch(/testsuites[^>]*skipped="1"/);
      // errors = interrupted = 1
      expect(xml).toMatch(/testsuites[^>]*errors="1"/);
      // total time = (1000+2000+0+3000+500)/1000 = 6.500
      expect(xml).toMatch(/testsuites[^>]*time="6\.500"/);
    });

    it('tests grouped by spec file into <testsuite> elements', () => {
      const results = [
        createTestResult({ testId: '1', file: 'tests/auth.spec.ts', title: 'Login' }),
        createTestResult({ testId: '2', file: 'tests/auth.spec.ts', title: 'Logout' }),
        createTestResult({ testId: '3', file: 'tests/home.spec.ts', title: 'Home page' }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Two testsuite elements
      const suiteMatches = xml.match(/<testsuite /g);
      expect(suiteMatches).toHaveLength(2);

      // auth suite has 2 tests
      expect(xml).toMatch(/<testsuite name="tests\/auth\.spec\.ts"[^>]*tests="2"/);
      // home suite has 1 test
      expect(xml).toMatch(/<testsuite name="tests\/home\.spec\.ts"[^>]*tests="1"/);
    });

    it('each <testsuite> has timestamp attribute', () => {
      const results = [
        createTestResult({ file: 'tests/a.spec.ts' }),
        createTestResult({ testId: '2', file: 'tests/b.spec.ts' }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Each testsuite should have a timestamp
      const suiteRegex = /<testsuite[^>]*timestamp="([^"]+)"/g;
      const timestamps: string[] = [];
      let match;
      while ((match = suiteRegex.exec(xml)) !== null) {
        timestamps.push(match[1]);
      }
      expect(timestamps).toHaveLength(2);
      // Timestamps should be valid ISO strings
      for (const ts of timestamps) {
        expect(new Date(ts).toISOString()).toBe(ts);
      }
      // All suites share the same timestamp
      expect(timestamps[0]).toBe(timestamps[1]);
    });

    it('failed tests have <failure> with type, message, and body', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Expected true to be false\n  at test.spec.ts:10:5',
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<failure');
      expect(xml).toMatch(/type="AssertionError"/);
      expect(xml).toMatch(/message="Expected true to be false"/);
      // Body contains full error (escaped)
      expect(xml).toContain('at test.spec.ts:10:5');
    });

    it('timed-out tests have <failure> with type Timeout', () => {
      const results = [
        createTestResult({
          status: 'timedOut',
          error: 'Test exceeded 30000ms timeout',
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<failure');
      expect(xml).toMatch(/type="Timeout"/);
    });

    it('skipped tests have <skipped />', () => {
      const results = [createTestResult({ status: 'skipped' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<skipped />');
    });

    it('interrupted tests have <error>', () => {
      const results = [createTestResult({ status: 'interrupted' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<error');
      expect(xml).toMatch(/type="Interrupted"/);
      expect(xml).toMatch(/message="Test was interrupted"/);
    });

    it('custom properties: stability-grade and stability-score', () => {
      const results = [
        createTestResult({
          stabilityScore: createStabilityScore({ overall: 85, grade: 'B' }),
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<property name="stability-grade" value="B" />');
      expect(xml).toContain('<property name="stability-score" value="85" />');
    });

    it('custom properties: flakiness-score exercises toFixed(2) rounding', () => {
      const results = [createTestResult({ flakinessScore: 0.1 })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<property name="flakiness-score" value="0.10" />');
    });

    it('custom properties: performance-trend', () => {
      const results = [createTestResult({ performanceTrend: '20% slower' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<property name="performance-trend" value="20% slower" />');
    });

    it('custom properties: tags', () => {
      const results = [createTestResult({ tags: ['@smoke', '@critical'] })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<property name="tags" value="@smoke,@critical" />');
    });

    it('custom properties: retries (only when retry > 0)', () => {
      const results = [
        createTestResult({ testId: '1', retry: 0 }),
        createTestResult({ testId: '2', retry: 3 }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Only one retries property (for test with retry=3)
      const retryMatches = xml.match(/name="retries"/g);
      expect(retryMatches).toHaveLength(1);
      expect(xml).toContain('<property name="retries" value="3" />');
    });

    it('custom properties: outcome', () => {
      const results = [createTestResult({ outcome: 'flaky' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<property name="outcome" value="flaky" />');
    });

    it('XML is well-formed with special characters in test names (& < > quotes)', () => {
      const results = [
        createTestResult({
          title: 'Test with & and <angle> "brackets" & \'quotes\'',
          file: 'tests/special&chars.spec.ts',
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Ampersands should be escaped
      expect(xml).toContain('&amp;');
      // Angle brackets should be escaped
      expect(xml).toContain('&lt;');
      expect(xml).toContain('&gt;');
      // Quotes should be escaped
      expect(xml).toContain('&quot;');
      expect(xml).toContain('&apos;');

      // Raw unescaped characters should NOT appear in attribute values
      expect(xml).not.toMatch(/name="[^"]*[<>][^"]*"/);
    });

    it('error messages with special XML characters are escaped in <failure>', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Expected <div class="foo"> to have text & not be empty',
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('&lt;div class=&quot;foo&quot;&gt;');
      expect(xml).toContain('text &amp; not be empty');
    });

    it('outputDir parameter is respected', () => {
      const results = [createTestResult()];
      const options: SmartReporterOptions = { outputFile: '/default/smart-report.html' };

      const outputPath = exportJunitXml(results, options, '/custom/output');

      expect(outputPath).toBe(path.resolve('/custom/output', 'smart-report-junit.xml'));
    });

    it('uses cwd when no outputFile or outputDir specified', () => {
      const results = [createTestResult()];

      const outputPath = exportJunitXml(results, {});

      expect(outputPath).toBe(path.resolve(process.cwd(), 'smart-report-junit.xml'));
    });

    it('testcase classname replaces slashes with dots and strips spec extension', () => {
      const results = [createTestResult({ file: 'tests/auth/login.spec.ts' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('classname="tests.auth.login"');
    });

    it('handles empty results array without crashing', () => {
      const outputPath = exportJunitXml([], {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toMatch(/testsuites[^>]*tests="0"/);
      expect(xml).toMatch(/testsuites[^>]*failures="0"/);
      expect(outputPath).toBeDefined();
    });

    it('failure message uses first line of error when multi-line', () => {
      const results = [
        createTestResult({
          status: 'failed',
          error: 'First line error\nSecond line detail\nThird line stack',
        }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // Message attribute should only have first line
      expect(xml).toMatch(/message="First line error"/);
      // Body should have full error
      expect(xml).toContain('Second line detail');
      expect(xml).toContain('Third line stack');
    });

    it('failure defaults to "Test failed" message when no error provided', () => {
      const results = [createTestResult({ status: 'failed' })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toMatch(/message="Test failed"/);
    });

    it('writes XML with utf-8 encoding', () => {
      exportJunitXml([createTestResult()], {});

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'utf-8',
      );
    });

    it('testsuite-level counts are correct per spec file', () => {
      const results = [
        createTestResult({ testId: '1', file: 'tests/auth.spec.ts', status: 'passed', duration: 1000 }),
        createTestResult({ testId: '2', file: 'tests/auth.spec.ts', status: 'failed', duration: 2000 }),
        createTestResult({ testId: '3', file: 'tests/auth.spec.ts', status: 'skipped', duration: 0 }),
      ];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      // The auth suite should have: tests=3, failures=1, skipped=1, time=3.000
      expect(xml).toMatch(/<testsuite name="tests\/auth\.spec\.ts"[^>]*tests="3"/);
      expect(xml).toMatch(/<testsuite name="tests\/auth\.spec\.ts"[^>]*failures="1"/);
      expect(xml).toMatch(/<testsuite name="tests\/auth\.spec\.ts"[^>]*skipped="1"/);
    });

    it('properties block is always present even with no custom properties', () => {
      const results = [createTestResult()];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toContain('<properties>');
      expect(xml).toContain('</properties>');
    });

    it('testcase time is in seconds', () => {
      const results = [createTestResult({ duration: 2500 })];

      exportJunitXml(results, {});

      const xml = mockFs.writeFileSync.mock.calls[0][1] as string;
      expect(xml).toMatch(/testcase[^>]*time="2\.500"/);
    });
  });
});
