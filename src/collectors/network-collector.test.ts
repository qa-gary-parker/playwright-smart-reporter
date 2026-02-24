import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { NetworkCollector } from './network-collector';

vi.mock('fs');

const { mockGetEntry, MockAdmZip } = vi.hoisted(() => {
  const mockGetEntry = vi.fn();
  const MockAdmZip = vi.fn().mockImplementation(() => ({
    getEntry: mockGetEntry,
  }));
  return { mockGetEntry, MockAdmZip };
});

vi.mock('adm-zip', () => ({
  default: MockAdmZip,
}));

function makeNetworkLine(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      request: {
        method: 'GET',
        url: 'https://api.example.com/users',
        bodySize: 0,
        headers: [],
      },
      response: {
        status: 200,
        statusText: 'OK',
        bodySize: 512,
        headers: [{ name: 'content-type', value: 'application/json' }],
        content: { mimeType: 'application/json', size: 512 },
      },
      time: 150,
      startedDateTime: '2024-01-01T10:00:00Z',
      ...overrides,
    },
  });
}

function makeStaticAssetLine(url: string, contentType: string): string {
  return JSON.stringify({
    type: 'resource-snapshot',
    snapshot: {
      request: {
        method: 'GET',
        url,
        bodySize: 0,
        headers: [],
      },
      response: {
        status: 200,
        statusText: 'OK',
        bodySize: 1024,
        headers: [{ name: 'content-type', value: contentType }],
        content: { mimeType: contentType, size: 1024 },
      },
      time: 50,
      startedDateTime: '2024-01-01T10:00:01Z',
    },
  });
}

describe('NetworkCollector', () => {
  const mockFs = vi.mocked(fs);

  beforeEach(() => {
    vi.clearAllMocks();
    MockAdmZip.mockImplementation(() => ({
      getEntry: mockGetEntry,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('collectFromTrace', () => {
    it('returns empty result when trace path does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/nonexistent/trace.zip');

      expect(result.entries).toEqual([]);
      expect(result.totalRequests).toBe(0);
    });

    it('returns empty result when trace path is empty string', async () => {
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('');

      expect(result.entries).toEqual([]);
      expect(result.totalRequests).toBe(0);
    });

    it('returns empty result when 0-trace.network entry is missing', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockGetEntry.mockReturnValue(null);
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries).toEqual([]);
      expect(result.totalRequests).toBe(0);
    });

    it('skips malformed JSON lines gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const networkData = [
        'not valid json',
        '{"type": "resource-snapshot"',
        makeNetworkLine(),
      ].join('\n');

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
      expect(result.totalRequests).toBe(1);
    });

    it('filters static assets by URL pattern (CSS, JS, images)', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const networkData = [
        makeNetworkLine(),
        makeStaticAssetLine('https://example.com/styles.css', 'text/css'),
        makeStaticAssetLine('https://example.com/app.js', 'application/javascript'),
        makeStaticAssetLine('https://example.com/logo.png', 'image/png'),
        makeStaticAssetLine('https://example.com/icon.svg', 'image/svg+xml'),
        makeStaticAssetLine('https://example.com/font.woff2', 'font/woff2'),
      ].join('\n');

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector({ excludeStaticAssets: true });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].url).toBe('https://api.example.com/users');
    });

    it('includes static assets when excludeStaticAssets is false', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const networkData = [
        makeNetworkLine(),
        makeStaticAssetLine('https://example.com/styles.css', 'text/css'),
      ].join('\n');

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector({ excludeStaticAssets: false });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(2);
    });

    it('truncates entries to maxEntries', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(makeNetworkLine({
          request: {
            method: 'GET',
            url: `https://api.example.com/item/${i}`,
            bodySize: 0,
            headers: [],
          },
          startedDateTime: `2024-01-01T10:00:${String(i).padStart(2, '0')}Z`,
        }));
      }

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(lines.join('\n'), 'utf8'),
      });
      const collector = new NetworkCollector({ maxEntries: 3, excludeStaticAssets: false });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(3);
      expect(result.totalRequests).toBe(10);
    });

    it('parses valid network entries correctly', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const networkData = makeNetworkLine({
        request: {
          method: 'POST',
          url: 'https://api.example.com/login',
          bodySize: 64,
          headers: [{ name: 'content-type', value: 'application/json' }],
          postData: '{"user":"test"}',
        },
        response: {
          status: 201,
          statusText: 'Created',
          bodySize: 256,
          headers: [{ name: 'content-type', value: 'application/json' }],
          content: { mimeType: 'application/json', size: 256 },
        },
        time: 320,
        startedDateTime: '2024-01-01T12:00:00Z',
        timings: { dns: 5, connect: 10, ssl: 15, wait: 200, receive: 90 },
      });

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector({ excludeStaticAssets: false, includeBodies: true });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
      const entry = result.entries[0];
      expect(entry.method).toBe('POST');
      expect(entry.url).toBe('https://api.example.com/login');
      expect(entry.urlPath).toBe('/login');
      expect(entry.status).toBe(201);
      expect(entry.statusText).toBe('Created');
      expect(entry.duration).toBe(320);
      expect(entry.requestSize).toBe(64);
      expect(entry.responseSize).toBe(256);
      expect(entry.contentType).toBe('application/json');
      expect(entry.timings).toEqual({ dns: 5, connect: 10, ssl: 15, wait: 200, receive: 90 });
      expect(entry.requestBody).toEqual({ user: 'test' });
    });

    it('skips entries without request or response', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const noRequest = JSON.stringify({
        type: 'resource-snapshot',
        snapshot: { response: { status: 200 } },
      });
      const noResponse = JSON.stringify({
        type: 'resource-snapshot',
        snapshot: { request: { method: 'GET', url: 'https://example.com' } },
      });
      const networkData = [noRequest, noResponse, makeNetworkLine()].join('\n');

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
    });

    it('skips non-resource-snapshot entries', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const otherType = JSON.stringify({ type: 'action', action: 'click' });
      const networkData = [otherType, makeNetworkLine()].join('\n');

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
    });

    it('updates summary with status and method counts', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const lines = [
        makeNetworkLine(),
        makeNetworkLine({
          request: { method: 'POST', url: 'https://api.example.com/data', bodySize: 0, headers: [] },
          response: { status: 404, statusText: 'Not Found', bodySize: 0, headers: [], content: { mimeType: 'application/json' } },
          time: 200,
          startedDateTime: '2024-01-01T10:00:01Z',
        }),
      ];

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(lines.join('\n'), 'utf8'),
      });
      const collector = new NetworkCollector();

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.summary.byMethod['GET']).toBe(1);
      expect(result.summary.byMethod['POST']).toBe(1);
      expect(result.summary.byStatus[200]).toBe(1);
      expect(result.summary.byStatus[400]).toBe(1);
      expect(result.summary.errors.length).toBe(1);
      expect(result.summary.errors[0].status).toBe(404);
      expect(result.summary.slowest).toBeDefined();
      expect(result.summary.slowest!.duration).toBe(200);
    });

    it('applies urlFilter to only include matching URLs', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const lines = [
        makeNetworkLine(),
        makeNetworkLine({
          request: { method: 'GET', url: 'https://other.com/data', bodySize: 0, headers: [] },
          response: { status: 200, statusText: 'OK', bodySize: 0, headers: [], content: { mimeType: 'application/json' } },
          time: 100,
          startedDateTime: '2024-01-01T10:00:01Z',
        }),
      ];

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(lines.join('\n'), 'utf8'),
      });
      const collector = new NetworkCollector({ urlFilter: 'api.example.com' });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries.length).toBe(1);
      expect(result.entries[0].url).toContain('api.example.com');
    });

    it('handles AdmZip constructor error gracefully', async () => {
      mockFs.existsSync.mockReturnValue(true);
      MockAdmZip.mockImplementationOnce(() => {
        throw new Error('Corrupt zip');
      });
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const collector = new NetworkCollector();
      const result = await collector.collectFromTrace('/path/to/corrupt.zip');

      expect(result.entries).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse trace file'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('includes headers when includeHeaders option is true', async () => {
      mockFs.existsSync.mockReturnValue(true);
      const networkData = makeNetworkLine({
        request: {
          method: 'GET',
          url: 'https://api.example.com/users',
          bodySize: 0,
          headers: [
            { name: 'Authorization', value: 'Bearer token' },
            { name: ':authority', value: 'api.example.com' },
          ],
        },
        response: {
          status: 200,
          statusText: 'OK',
          bodySize: 512,
          headers: [{ name: 'content-type', value: 'application/json' }],
          content: { mimeType: 'application/json', size: 512 },
        },
        time: 150,
        startedDateTime: '2024-01-01T10:00:00Z',
      });

      mockGetEntry.mockReturnValue({
        getData: () => Buffer.from(networkData, 'utf8'),
      });
      const collector = new NetworkCollector({ includeHeaders: true });

      const result = await collector.collectFromTrace('/path/to/trace.zip');

      expect(result.entries[0].requestHeaders).toEqual({ authorization: 'Bearer token' });
      expect(result.entries[0].responseHeaders).toEqual({ 'content-type': 'application/json' });
    });
  });
});
