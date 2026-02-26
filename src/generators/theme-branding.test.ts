import { describe, it, expect } from 'vitest';
import { generateHtml, type HtmlGeneratorData } from './html-generator';
import type { TestResultData, TestHistory, ThemeConfig } from '../types';

const createTestResult = (overrides: Partial<TestResultData> = {}): TestResultData => ({
  testId: 'test-1',
  title: 'Test One',
  file: 'tests/example.spec.ts',
  status: 'passed',
  duration: 1000,
  retry: 0,
  steps: [],
  history: [],
  ...overrides,
});

const createTestHistory = (): TestHistory => ({
  runs: [],
  tests: {},
  summaries: [],
});

function buildHtmlData(overrides: Partial<HtmlGeneratorData> = {}): HtmlGeneratorData {
  return {
    results: [createTestResult()],
    history: createTestHistory(),
    startTime: Date.now(),
    options: {},
    ...overrides,
  };
}

describe('theme-branding', () => {
  describe('theme presets', () => {
    it('dark preset sets data-theme="dark" on html tag', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'dark' } },
      }));

      expect(html).toContain('<html lang="en" data-theme="dark">');
    });

    it('light preset sets data-theme="light" on html tag', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'light' } },
      }));

      expect(html).toContain('<html lang="en" data-theme="light">');
    });

    it('high-contrast preset sets data-theme="high-contrast" on html tag', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'high-contrast' } },
      }));

      expect(html).toContain('<html lang="en" data-theme="high-contrast">');
    });

    it('default preset does not set data-theme attribute', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'default' } },
      }));

      expect(html).toContain('<html lang="en">');
    });

    it('high-contrast preset applies high-contrast CSS variables', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'high-contrast' } },
      }));

      expect(html).toContain('--bg-primary: #000000');
      expect(html).toContain('--accent-green: #00ff00');
      expect(html).toContain('--accent-red: #ff0000');
      expect(html).toContain('text-decoration: underline !important');
    });
  });

  describe('custom theme colors', () => {
    it('primary maps to --accent-blue CSS variable', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { primary: '#ff0000' } },
      }));

      expect(html).toContain('--accent-blue: #ff0000');
    });

    it('success maps to --accent-green CSS variable', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { success: '#00ff00' } },
      }));

      expect(html).toContain('--accent-green: #00ff00');
    });

    it('primary and success map to different CSS variables', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { primary: '#ff0000', success: '#00ff00' } },
      }));

      expect(html).toContain('--accent-blue: #ff0000');
      expect(html).toContain('--accent-green: #00ff00');
    });

    it('background maps to --bg-primary', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { background: '#111111' } },
      }));

      expect(html).toContain('--bg-primary: #111111');
    });

    it('error maps to --accent-red', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { error: '#ee0000' } },
      }));

      expect(html).toContain('--accent-red: #ee0000');
    });
  });

  describe('forcedLightPreset dead code', () => {
    it('light preset does not produce invalid CSS like ":root { data-theme: light; }"', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { theme: { preset: 'light' } },
      }));

      expect(html).not.toContain(':root { data-theme: light; }');
    });
  });

  describe('branding config', () => {
    it('renders logo image when branding.logo is set', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { branding: { logo: 'https://example.com/logo.png' } },
      }));

      expect(html).toContain('logo-image');
      expect(html).toContain('https://example.com/logo.png');
    });

    it('renders custom title when branding.title is set', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { branding: { title: 'My Company Tests' } },
      }));

      expect(html).toContain('My Company Tests');
    });

    it('renders custom footer when branding.footer is set', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { branding: { footer: 'Copyright 2024 My Company' } },
      }));

      expect(html).toContain('Copyright 2024 My Company');
    });

    it('suppresses powered-by attribution when hidePoweredBy is true', () => {
      const { html } = generateHtml(buildHtmlData({
        options: { branding: { hidePoweredBy: true } },
      }));

      expect(html).not.toContain('Powered by');
    });

    it('shows powered-by attribution by default', () => {
      const { html } = generateHtml(buildHtmlData({
        options: {},
      }));

      expect(html).toContain('Powered by');
    });
  });
});
