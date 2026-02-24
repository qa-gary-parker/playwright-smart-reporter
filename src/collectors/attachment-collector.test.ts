import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { AttachmentCollector } from './attachment-collector';
import type { TestResult } from '@playwright/test/reporter';

vi.mock('fs');

function makeTestResult(attachments: TestResult['attachments']): TestResult {
  return {
    attachments,
    annotations: [],
    status: 'passed',
    duration: 1000,
    startTime: new Date(),
    retry: 0,
    parallelIndex: 0,
    workerIndex: 0,
    steps: [],
    errors: [],
    stderr: [],
    stdout: [],
  };
}

describe('AttachmentCollector', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('screenshot handling', () => {
    it('collects screenshot from body as base64 data URI', () => {
      const imgBuffer = Buffer.from('fake-png-data');
      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', body: imgBuffer },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.screenshots.length).toBe(1);
      expect(attachments.screenshots[0]).toBe(
        `data:image/png;base64,${imgBuffer.toString('base64')}`
      );
    });

    it('collects screenshot from path by reading file', () => {
      const imgBuffer = Buffer.from('fake-png-from-disk');
      mockFs.readFileSync.mockReturnValue(imgBuffer);

      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', path: '/tmp/screenshot.png' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(mockFs.readFileSync).toHaveBeenCalledWith('/tmp/screenshot.png');
      expect(attachments.screenshots.length).toBe(1);
      expect(attachments.screenshots[0]).toContain('data:image/png;base64,');
    });

    it('warns and skips when screenshot path cannot be read', () => {
      mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', path: '/missing/screenshot.png' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.screenshots.length).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read screenshot'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('collects custom image attachments (not named "screenshot")', () => {
      const imgBuffer = Buffer.from('custom-image');
      const result = makeTestResult([
        { name: 'comparison-diff', contentType: 'image/jpeg', body: imgBuffer },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.screenshots.length).toBe(1);
      expect(attachments.screenshots[0]).toContain('data:image/jpeg;base64,');
    });
  });

  describe('video handling', () => {
    it('collects video path', () => {
      const result = makeTestResult([
        { name: 'video', contentType: 'video/webm', path: '/tmp/video.webm' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.videos).toEqual(['/tmp/video.webm']);
    });

    it('ignores video without path', () => {
      const result = makeTestResult([
        { name: 'video', contentType: 'video/webm' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.videos).toEqual([]);
    });
  });

  describe('trace handling', () => {
    it('collects trace file path', () => {
      const result = makeTestResult([
        { name: 'trace', contentType: 'application/zip', path: '/tmp/trace.zip' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.traces).toEqual(['/tmp/trace.zip']);
    });

    it('ignores trace without path', () => {
      const result = makeTestResult([
        { name: 'trace', contentType: 'application/zip' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.traces).toEqual([]);
    });
  });

  describe('custom attachment handling', () => {
    it('collects custom attachment with path', () => {
      const result = makeTestResult([
        { name: 'har-log', contentType: 'application/json', path: '/tmp/network.har' },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.custom.length).toBe(1);
      expect(attachments.custom[0]).toEqual({
        name: 'har-log',
        contentType: 'application/json',
        path: '/tmp/network.har',
      });
    });

    it('collects custom attachment with body as base64', () => {
      const body = Buffer.from('{"key":"value"}');
      const result = makeTestResult([
        { name: 'api-response', contentType: 'application/json', body },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.custom.length).toBe(1);
      expect(attachments.custom[0].name).toBe('api-response');
      expect(attachments.custom[0].body).toBe(body.toString('base64'));
    });

    it('excludes standard attachment names from custom', () => {
      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', body: Buffer.from('img') },
        { name: 'video', contentType: 'video/webm', path: '/tmp/video.webm' },
        { name: 'trace', contentType: 'application/zip', path: '/tmp/trace.zip' },
        { name: 'custom-data', contentType: 'text/plain', body: Buffer.from('data') },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.custom.length).toBe(1);
      expect(attachments.custom[0].name).toBe('custom-data');
    });

    it('excludes image content types from custom (they go to screenshots)', () => {
      const result = makeTestResult([
        { name: 'visual-diff', contentType: 'image/png', body: Buffer.from('img') },
      ]);
      const collector = new AttachmentCollector();

      const attachments = collector.collectAttachments(result);

      expect(attachments.screenshots.length).toBe(1);
      expect(attachments.custom.length).toBe(0);
    });
  });

  describe('CSP-safe mode', () => {
    it('saves screenshot to file instead of base64 when cspSafe is true', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => {});

      const imgBuffer = Buffer.from('png-data');
      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', body: imgBuffer },
      ]);
      const collector = new AttachmentCollector({
        cspSafe: true,
        outputDir: '/output',
      });

      const attachments = collector.collectAttachments(result);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('/output/screenshot-'),
        imgBuffer,
      );
      expect(attachments.screenshots[0]).toMatch(/^screenshot-\d+\.png$/);
    });

    it('creates output directory if it does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      mockFs.mkdirSync.mockImplementation(() => undefined as any);
      mockFs.writeFileSync.mockImplementation(() => {});

      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', body: Buffer.from('png') },
      ]);
      const collector = new AttachmentCollector({
        cspSafe: true,
        outputDir: '/new-output',
      });

      collector.collectAttachments(result);

      expect(mockFs.mkdirSync).toHaveBeenCalledWith('/new-output', { recursive: true });
    });

    it('throws when cspSafe is true but outputDir is not set', () => {
      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/png', body: Buffer.from('png') },
      ]);
      const collector = new AttachmentCollector({ cspSafe: true });

      expect(() => collector.collectAttachments(result)).toThrow(
        'outputDir is required when cspSafe is enabled'
      );
    });

    it('uses jpg extension for jpeg content type', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockImplementation(() => {});

      const result = makeTestResult([
        { name: 'screenshot', contentType: 'image/jpeg', body: Buffer.from('jpg') },
      ]);
      const collector = new AttachmentCollector({
        cspSafe: true,
        outputDir: '/output',
      });

      const attachments = collector.collectAttachments(result);

      expect(attachments.screenshots[0]).toMatch(/\.jpg$/);
    });
  });

  describe('utility methods', () => {
    it('getFirstScreenshot returns first screenshot', () => {
      const collector = new AttachmentCollector();
      const attachments = {
        screenshots: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
        videos: [],
        traces: [],
        custom: [],
      };

      expect(collector.getFirstScreenshot(attachments)).toBe('data:image/png;base64,AAA');
    });

    it('getFirstScreenshot returns undefined when empty', () => {
      const collector = new AttachmentCollector();
      const attachments = { screenshots: [], videos: [], traces: [], custom: [] };

      expect(collector.getFirstScreenshot(attachments)).toBeUndefined();
    });

    it('getFirstVideo returns first video path', () => {
      const collector = new AttachmentCollector();
      const attachments = {
        screenshots: [],
        videos: ['/tmp/video1.webm', '/tmp/video2.webm'],
        traces: [],
        custom: [],
      };

      expect(collector.getFirstVideo(attachments)).toBe('/tmp/video1.webm');
    });

    it('hasAttachments returns true when screenshots exist', () => {
      const collector = new AttachmentCollector();
      expect(collector.hasAttachments({
        screenshots: ['data:img'],
        videos: [],
        traces: [],
        custom: [],
      })).toBe(true);
    });

    it('hasAttachments returns true when custom attachments exist', () => {
      const collector = new AttachmentCollector();
      expect(collector.hasAttachments({
        screenshots: [],
        videos: [],
        traces: [],
        custom: [{ name: 'log', contentType: 'text/plain' }],
      })).toBe(true);
    });

    it('hasAttachments returns false when all arrays are empty', () => {
      const collector = new AttachmentCollector();
      expect(collector.hasAttachments({
        screenshots: [],
        videos: [],
        traces: [],
        custom: [],
      })).toBe(false);
    });
  });
});
