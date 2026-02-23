import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('pdf-exporter', () => {
  let mockPage: {
    goto: ReturnType<typeof vi.fn>;
    pdf: ReturnType<typeof vi.fn>;
  };
  let mockBrowser: {
    newPage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let mockChromium: {
    launch: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      pdf: vi.fn().mockResolvedValue(Buffer.from('fake-pdf')),
    };
    mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockChromium = {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exportPdfReport', () => {
    it('generates PDF file at expected path when Playwright is available', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // Dynamic import mock — return our mock chromium
      vi.doMock('playwright-core', () => ({
        chromium: mockChromium,
      }));

      // Clear module cache so our mock takes effect
      const { exportPdfReport } = await import('./pdf-exporter');

      const htmlPath = '/tmp/test-reports/smart-report.html';
      const result = await exportPdfReport(htmlPath, {});

      expect(result).toBe('/tmp/test-reports/smart-report.pdf');
      expect(mockChromium.launch).toHaveBeenCalledWith({ headless: true });
      expect(mockPage.goto).toHaveBeenCalledWith(
        pathToFileURL(htmlPath).href,
        expect.objectContaining({ waitUntil: 'networkidle' }),
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/tmp/test-reports/smart-report.pdf',
          format: 'A4',
          landscape: true,
          printBackground: true,
        }),
      );
      expect(mockBrowser.close).toHaveBeenCalled();

      vi.doUnmock('playwright-core');
    });

    it('returns null and warns when page.goto() fails', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      mockPage.goto.mockRejectedValue(new Error('net::ERR_FILE_NOT_FOUND'));

      vi.doMock('playwright-core', () => ({
        chromium: mockChromium,
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { exportPdfReport } = await import('./pdf-exporter');

      const result = await exportPdfReport('/tmp/report.html', {});

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        'Smart Reporter: PDF generation failed:',
        'net::ERR_FILE_NOT_FOUND',
      );
      expect(mockBrowser.close).toHaveBeenCalled();

      warnSpy.mockRestore();
      vi.doUnmock('playwright-core');
    });

    it('handles missing Playwright gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.doMock('playwright-core', () => {
        throw new Error('Cannot find module \'playwright-core\'');
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { exportPdfReport } = await import('./pdf-exporter');

      const result = await exportPdfReport('/tmp/report.html', {});

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('PDF export requires playwright-core'),
      );

      warnSpy.mockRestore();
      vi.doUnmock('playwright-core');
    });

    it('handles invalid HTML path (file not found)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      vi.doMock('playwright-core', () => ({
        chromium: mockChromium,
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { exportPdfReport } = await import('./pdf-exporter');

      const result = await exportPdfReport('/nonexistent/report.html', {});

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('HTML report not found'),
      );
      expect(mockChromium.launch).not.toHaveBeenCalled();

      warnSpy.mockRestore();
      vi.doUnmock('playwright-core');
    });

    it('respects outputDir parameter', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      vi.doMock('playwright-core', () => ({
        chromium: mockChromium,
      }));

      const { exportPdfReport } = await import('./pdf-exporter');

      const result = await exportPdfReport(
        '/tmp/reports/smart-report.html',
        {},
        '/custom/output',
      );

      expect(result).toBe('/custom/output/smart-report.pdf');
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/custom/output/smart-report.pdf',
        }),
      );

      vi.doUnmock('playwright-core');
    });

    it('browser is always closed in finally block (even on error)', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      mockPage.pdf.mockRejectedValue(new Error('PDF generation failed'));

      vi.doMock('playwright-core', () => ({
        chromium: mockChromium,
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { exportPdfReport } = await import('./pdf-exporter');

      const result = await exportPdfReport('/tmp/report.html', {});

      expect(result).toBeNull();
      expect(mockBrowser.close).toHaveBeenCalled();

      warnSpy.mockRestore();
      vi.doUnmock('playwright-core');
    });
  });
});
