/**
 * Premium Pipeline Integration Tests
 *
 * Tests the SmartReporter constructor's license-gating logic:
 * - Community tier: theme/branding stripped, warnings emitted, no Pro features activated
 * - Pro tier: theme/branding preserved, notifications wired, custom AI model accepted
 * - Team tier: all Pro features work (Team is a superset of Pro)
 *
 * Strategy: test the constructor and onEnd() in isolation by mocking fs, html-generator,
 * the license module, and the export functions. This lets us verify wiring contracts
 * without running the full Playwright reporter lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SmartReporterOptions } from './types';

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock('fs', () => {
  const m = {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockReturnValue(JSON.stringify({ runs: [], tests: {}, summaries: [] })),
    copyFileSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ size: 100 }),
  };
  return { ...m, default: m };
});

vi.mock('./generators/html-generator', () => ({
  generateHtml: vi.fn().mockReturnValue('<html></html>'),
}));

vi.mock('./generators/json-exporter', () => ({
  exportJsonData: vi.fn().mockReturnValue('/tmp/smart-report-data.json'),
}));

vi.mock('./generators/junit-exporter', () => ({
  exportJunitXml: vi.fn().mockReturnValue('/tmp/junit.xml'),
}));

vi.mock('./generators/pdf-exporter', () => ({
  exportPdfReport: vi.fn().mockResolvedValue('/tmp/report.pdf'),
}));

vi.mock('./generators/executive-pdf', () => ({
  generateExecutivePdf: vi.fn().mockReturnValue('/tmp/executive.pdf'),
}));

vi.mock('./gates', () => ({
  QualityGateEvaluator: vi.fn().mockImplementation(() => ({
    evaluate: vi.fn().mockReturnValue({ passed: true, rules: [] }),
  })),
  formatGateReport: vi.fn().mockReturnValue(''),
}));

vi.mock('./quarantine', () => ({
  QuarantineGenerator: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockReturnValue(null),
    getOutputPath: vi.fn().mockReturnValue('/tmp/.smart-quarantine.json'),
  })),
}));

vi.mock('./cloud/uploader', () => ({
  CloudUploader: vi.fn().mockImplementation(() => ({
    isEnabled: vi.fn().mockReturnValue(false),
    upload: vi.fn().mockResolvedValue({ success: false }),
  })),
}));

vi.mock('./notifiers', () => ({
  SlackNotifier: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  })),
  TeamsNotifier: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  })),
  NotificationManager: vi.fn().mockImplementation(() => ({
    notify: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./collectors', () => ({
  HistoryCollector: vi.fn().mockImplementation(() => ({
    loadHistory: vi.fn(),
    getTestHistory: vi.fn().mockReturnValue([]),
    getOptions: vi.fn().mockReturnValue({}),
    getBaselineRun: vi.fn().mockReturnValue(undefined),
    getHistory: vi.fn().mockReturnValue({ runs: [], tests: {}, summaries: [], runFiles: {} }),
    getCurrentRun: vi.fn().mockReturnValue({ runId: 'run-1', timestamp: new Date().toISOString() }),
    updateHistory: vi.fn(),
  })),
  StepCollector: vi.fn().mockImplementation(() => ({
    extractSteps: vi.fn().mockReturnValue([]),
  })),
  AttachmentCollector: vi.fn().mockImplementation(() => ({
    collectAttachments: vi.fn().mockReturnValue({ screenshots: [], videos: [], traces: [], custom: [] }),
  })),
  NetworkCollector: vi.fn().mockImplementation(() => ({
    collectFromTrace: vi.fn().mockResolvedValue({ entries: [] }),
  })),
}));

vi.mock('./analyzers', () => ({
  FlakinessAnalyzer: vi.fn().mockImplementation(() => ({ analyze: vi.fn() })),
  PerformanceAnalyzer: vi.fn().mockImplementation(() => ({ analyze: vi.fn() })),
  RetryAnalyzer: vi.fn().mockImplementation(() => ({ analyze: vi.fn() })),
  FailureClusterer: vi.fn().mockImplementation(() => ({ clusterFailures: vi.fn().mockReturnValue([]) })),
  StabilityScorer: vi.fn().mockImplementation(() => ({ scoreTest: vi.fn() })),
  AIAnalyzer: vi.fn().mockImplementation(() => ({
    analyzeFailed: vi.fn().mockResolvedValue(undefined),
    analyzeClusters: vi.fn().mockResolvedValue(undefined),
  })),
}));

// ---------------------------------------------------------------------------
// Mock the license module so premium-integration tests control tier directly
// without needing real JWT signatures (license validation is tested elsewhere)
// ---------------------------------------------------------------------------

const mockValidate = vi.fn();
const mockHasFeature = vi.fn();

vi.mock('./license', () => ({
  LicenseValidator: vi.fn().mockImplementation(() => ({
    validate: mockValidate,
  })),
}));

// Attach hasFeature as a static method on the mocked constructor
import { LicenseValidator as MockedLicenseValidatorType } from './license';
(MockedLicenseValidatorType as any).hasFeature = mockHasFeature;

// ---------------------------------------------------------------------------
// Minimal fake Playwright lifecycle objects
// ---------------------------------------------------------------------------

const fakeConfig = {
  rootDir: '/tmp',
  configFile: '/tmp/playwright.config.ts',
  projects: [],
  forbidOnly: false,
  fullyParallel: false,
  globalSetup: null,
  globalTeardown: null,
  globalTimeout: 0,
  grep: /.*/,
  grepInvert: null,
  maxFailures: 0,
  metadata: {},
  preserveOutput: 'always',
  reporter: [],
  reportSlowTests: null,
  quiet: false,
  shard: null,
  updateSnapshots: 'missing',
  version: '1.40.0',
  workers: 1,
  webServer: null,
} as any;

const fakeSuite = {} as any;
const fakeFullResult = { status: 'passed', startTime: new Date(), duration: 1000 } as any;

// ---------------------------------------------------------------------------
// Import modules after mocks are registered
// ---------------------------------------------------------------------------

import SmartReporter from './smart-reporter';
import { exportJsonData } from './generators/json-exporter';
import { exportJunitXml } from './generators/junit-exporter';
import { exportPdfReport } from './generators/pdf-exporter';
import { generateExecutivePdf } from './generators/executive-pdf';
import { generateHtml } from './generators/html-generator';
import { NotificationManager } from './notifiers';
import { AIAnalyzer } from './analyzers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Premium Pipeline Integration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.SMART_REPORTER_LICENSE_KEY;
    // Default to community tier — overridden in pro/team describe blocks
    mockValidate.mockReturnValue({ tier: 'community', valid: true });
    mockHasFeature.mockImplementation((_license: any, requiredTier: string) => {
      if (requiredTier === 'community') return true;
      return false;
    });
    // Clear call counts only — do NOT reset implementations set by vi.mock() factories
    vi.mocked(exportJsonData).mockClear();
    vi.mocked(exportJunitXml).mockClear();
    vi.mocked(exportPdfReport).mockClear();
    vi.mocked(generateExecutivePdf).mockClear();
    vi.mocked(generateHtml).mockClear();
    vi.mocked(NotificationManager).mockClear();
    vi.mocked(AIAnalyzer).mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
    // Do NOT use vi.restoreAllMocks() — in Vitest 2.x it resets vi.fn() implementations
    // inside vi.mock() factory objects, breaking subsequent tests.
    // Instead, spies on console are set up per-test with mockImplementation and
    // will be cleaned up individually.
  });

  // =========================================================================
  // Community tier
  // =========================================================================

  describe('community tier (no license key)', () => {
    it('strips theme from options and emits a console warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const opts: SmartReporterOptions = {
        theme: { preset: 'dark', primary: '#ff0000' },
      };

      new SmartReporter(opts);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Custom themes require a Pro license')
      );
    });

    it('strips branding from options and emits a console warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const opts: SmartReporterOptions = {
        branding: { title: 'Acme Corp', logo: 'https://acme.com/logo.png' },
      };

      new SmartReporter(opts);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Custom branding requires a Pro license')
      );
    });

    it('does NOT call exportJsonData even when exportJson: true', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportJson: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJsonData).not.toHaveBeenCalled();
    });

    it('does NOT call exportJunitXml even when exportJunit: true', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportJunit: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJunitXml).not.toHaveBeenCalled();
    });

    it('does NOT call exportPdfReport even when exportPdf: true', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportPdf: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportPdfReport).not.toHaveBeenCalled();
    });

    it('does NOT instantiate NotificationManager even when notifications configured', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      new SmartReporter({
        notifications: [{ channel: 'slack', config: { webhookUrl: 'https://example.com' } }],
      });

      expect(NotificationManager).not.toHaveBeenCalled();
    });

    it('passes community tier to AIAnalyzer', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      new SmartReporter({});

      expect(AIAnalyzer).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'community' })
      );
    });

    it('emits upsell message at the end for community tier', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({});
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('Pro features available'))).toBe(true);
    });

    it('theme config is absent from generateHtml call (stripped at construction time)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ theme: { preset: 'dark' } });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(vi.mocked(generateHtml)).toHaveBeenCalled();
      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.theme).toBeUndefined();
    });

    it('branding config is absent from generateHtml call (stripped at construction time)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ branding: { title: 'Acme' } });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.branding).toBeUndefined();
    });
  });

  // =========================================================================
  // Pro tier (mocked license)
  // =========================================================================

  describe('pro tier (mocked license)', () => {
    beforeEach(() => {
      mockValidate.mockReturnValue({ tier: 'pro', valid: true, org: 'Test Org' });
      mockHasFeature.mockImplementation((_license: any, requiredTier: string) => {
        if (requiredTier === 'community') return true;
        if (requiredTier === 'pro') return true;
        return false;
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('calls exportJsonData when exportJson: true', async () => {
      const reporter = new SmartReporter({ exportJson: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJsonData).toHaveBeenCalled();
    });

    it('calls exportJunitXml when exportJunit: true', async () => {
      const reporter = new SmartReporter({ exportJunit: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJunitXml).toHaveBeenCalled();
    });

    it('calls generateExecutivePdf when exportPdf: true (default)', async () => {
      const reporter = new SmartReporter({ exportPdf: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(generateExecutivePdf).toHaveBeenCalled();
      expect(exportPdfReport).not.toHaveBeenCalled();
    });

    it('calls exportPdfReport when exportPdf: true and exportPdfFull: true', async () => {
      const reporter = new SmartReporter({ exportPdf: true, exportPdfFull: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportPdfReport).toHaveBeenCalled();
      expect(generateExecutivePdf).not.toHaveBeenCalled();
    });

    it('preserves theme config — passed through to generateHtml', async () => {
      const theme = { preset: 'dark' as const, primary: '#336699' };
      const reporter = new SmartReporter({ theme });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.theme).toEqual(theme);
    });

    it('preserves branding config — passed through to generateHtml', async () => {
      const branding = { title: 'My Co', footer: 'footer text' };
      const reporter = new SmartReporter({ branding });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.branding).toEqual(branding);
    });

    it('instantiates NotificationManager when notifications configured', () => {
      new SmartReporter({
        notifications: [{ channel: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } }],
      });

      expect(NotificationManager).toHaveBeenCalled();
    });

    it('passes pro tier and licenseKey to AIAnalyzer', () => {
      new SmartReporter({ licenseKey: 'test-key' });

      expect(AIAnalyzer).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'pro', licenseKey: 'test-key' })
      );
    });

    it('does NOT emit upsell message for pro tier', async () => {
      const logSpy = vi.mocked(console.log);

      const reporter = new SmartReporter({});
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('Pro features available'))).toBe(false);
    });
  });

  // =========================================================================
  // Team tier (superset of Pro)
  // =========================================================================

  describe('team tier (mocked license)', () => {
    beforeEach(() => {
      mockValidate.mockReturnValue({ tier: 'team', valid: true, org: 'Team Org' });
      mockHasFeature.mockImplementation((_license: any, requiredTier: string) => {
        if (requiredTier === 'community') return true;
        if (requiredTier === 'pro') return true;
        if (requiredTier === 'team') return true;
        return false;
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('calls exportJsonData (Team includes Pro features)', async () => {
      const reporter = new SmartReporter({ exportJson: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJsonData).toHaveBeenCalled();
    });

    it('calls exportJunitXml (Team includes Pro features)', async () => {
      const reporter = new SmartReporter({ exportJunit: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      expect(exportJunitXml).toHaveBeenCalled();
    });

    it('preserves theme config for team tier', async () => {
      const theme = { preset: 'high-contrast' as const };
      const reporter = new SmartReporter({ theme });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.theme).toEqual(theme);
    });

    it('preserves branding config for team tier', async () => {
      const branding = { title: 'Enterprise Suite', hidePoweredBy: true };
      const reporter = new SmartReporter({ branding });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const callArg = vi.mocked(generateHtml).mock.calls[0]?.[0];
      expect(callArg?.options?.branding).toEqual(branding);
    });

    it('passes team tier to AIAnalyzer', () => {
      new SmartReporter({});

      expect(AIAnalyzer).toHaveBeenCalledWith(
        expect.objectContaining({ tier: 'team' })
      );
    });
  });

  // =========================================================================
  // Export gating console messages (community tier)
  // =========================================================================

  describe('export gating messages (community tier)', () => {
    it('logs JSON export upsell message when exportJson requested without Pro', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportJson: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('JSON export requires a Pro license'))).toBe(true);
    });

    it('logs JUnit export upsell message when exportJunit requested without Pro', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportJunit: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('JUnit export requires a Pro license'))).toBe(true);
    });

    it('logs PDF export upsell message when exportPdf requested without Pro', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const reporter = new SmartReporter({ exportPdf: true });
      reporter.onBegin(fakeConfig, fakeSuite);
      await reporter.onEnd(fakeFullResult);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('PDF export requires a Pro license'))).toBe(true);
    });
  });
});
