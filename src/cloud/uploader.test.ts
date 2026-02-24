import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { CloudUploader } from './uploader';
import type { SmartReporterOptions, TestResultData } from '../types';

vi.mock('fs');
vi.mock('../utils/ci-detector', () => ({
  detectCIInfo: vi.fn(() => ({
    provider: 'github',
    branch: 'main',
    commit: 'abc12345',
    buildId: '999',
  })),
}));

const mockFs = vi.mocked(fs);

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test one',
    file: 'tests/login.spec.ts',
    status: 'passed',
    duration: 1500,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

describe('CloudUploader', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Ensure no env leak from previous tests
    delete process.env.STAGEWRIGHT_API_KEY;
    delete process.env.STAGEWRIGHT_PROJECT_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe('constructor and isEnabled', () => {
    it('is enabled when apiKey is provided and uploadToCloud is not false', () => {
      const uploader = new CloudUploader({ apiKey: 'key-123' });

      expect(uploader.isEnabled()).toBe(true);
    });

    it('reads API key from environment variable', () => {
      vi.stubEnv('STAGEWRIGHT_API_KEY', 'env-key-456');

      const uploader = new CloudUploader({});

      expect(uploader.isEnabled()).toBe(true);
    });

    it('is disabled when no API key is set', () => {
      const uploader = new CloudUploader({});

      expect(uploader.isEnabled()).toBe(false);
    });

    it('is disabled when uploadToCloud is explicitly false', () => {
      const uploader = new CloudUploader({
        apiKey: 'key-123',
        uploadToCloud: false,
      });

      expect(uploader.isEnabled()).toBe(false);
    });
  });

  describe('mapStatus (via transformResults)', () => {
    async function getCloudStatus(result: Partial<TestResultData>): Promise<string> {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1', url: 'https://app.stagewright.dev/runs/run-1' }),
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([createTestResult(result)], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      return body.results[0].status;
    }

    it('maps flaky outcome to flaky', async () => {
      expect(await getCloudStatus({ outcome: 'flaky', status: 'passed' })).toBe('flaky');
    });

    it('maps skipped status to skipped', async () => {
      expect(await getCloudStatus({ status: 'skipped' })).toBe('skipped');
    });

    it('maps expected outcome to passed', async () => {
      expect(await getCloudStatus({ outcome: 'expected', status: 'passed' })).toBe('passed');
    });

    it('maps passed status to passed', async () => {
      expect(await getCloudStatus({ status: 'passed' })).toBe('passed');
    });

    it('maps unexpected outcome with failed status to failed', async () => {
      expect(await getCloudStatus({ outcome: 'unexpected', status: 'failed' })).toBe('failed');
    });

    it('maps test.fail() expected failure (status failed, outcome expected) to passed', async () => {
      expect(await getCloudStatus({ status: 'failed', outcome: 'expected' })).toBe('passed');
    });

    it('maps timedOut status with no outcome to failed', async () => {
      expect(await getCloudStatus({ status: 'timedOut' })).toBe('failed');
    });
  });

  describe('transformResults', () => {
    it('maps all basic fields correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const testData = createTestResult({
        testId: 'test-abc',
        title: 'My test',
        file: 'tests/foo.spec.ts',
        status: 'failed',
        outcome: 'unexpected',
        duration: 2500,
        retry: 2,
        error: 'Line one error\nStack trace here',
        stabilityScore: { overall: 85, flakiness: 90, performance: 80, reliability: 85, grade: 'B', needsAttention: false },
        flakinessIndicator: 'Stable',
        performanceTrend: 'improving',
        aiSuggestion: 'Try adding a wait',
        tags: ['smoke', 'critical'],
        steps: [
          { title: 'Click', duration: 100, category: 'pw:api' },
        ],
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const r = body.results[0];

      expect(r.testId).toBe('test-abc');
      expect(r.title).toBe('My test');
      expect(r.filePath).toBe('tests/foo.spec.ts');
      expect(r.status).toBe('failed');
      expect(r.durationMs).toBe(2500);
      expect(r.retryCount).toBe(2);
      expect(r.errorMessage).toBe('Line one error');
      expect(r.errorStack).toBe('Line one error\nStack trace here');
      expect(r.stabilityScore).toBe(85);
      expect(r.stabilityGrade).toBe('B');
      expect(r.flakinessIndicator).toBe('Stable');
      expect(r.performanceTrend).toBe('improving');
      expect(r.aiSuggestion).toBe('Try adding a wait');
      expect(r.tags).toEqual(['smoke', 'critical']);
      expect(r.steps).toEqual([{ title: 'Click', duration: 100, category: 'pw:api' }]);
    });

    it('includes screenshot file attachments but excludes base64 data URIs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const testData = createTestResult({
        attachments: {
          screenshots: [
            '/tmp/screenshots/fail.png',
            'data:image/png;base64,iVBOR...',
          ],
          videos: [],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attachments = body.results[0].attachments;

      expect(attachments).toHaveLength(1);
      expect(attachments[0].name).toBe('fail.png');
      expect(attachments[0].contentType).toBe('image/png');
      expect(attachments[0].path).toBe('/tmp/screenshots/fail.png');
    });

    it('includes video attachments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const testData = createTestResult({
        attachments: {
          screenshots: [],
          videos: ['/tmp/videos/test.webm'],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attachments = body.results[0].attachments;

      expect(attachments).toHaveLength(1);
      expect(attachments[0].name).toBe('test.webm');
      expect(attachments[0].contentType).toBe('video/webm');
    });

    it('includes trace attachments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const testData = createTestResult({
        attachments: {
          screenshots: [],
          videos: [],
          traces: ['/tmp/traces/trace.zip'],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attachments = body.results[0].attachments;

      expect(attachments).toHaveLength(1);
      expect(attachments[0].name).toBe('trace.zip');
      expect(attachments[0].contentType).toBe('application/zip');
    });

    it('includes custom attachments with path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const testData = createTestResult({
        attachments: {
          screenshots: [],
          videos: [],
          traces: [],
          custom: [
            { name: 'har-log', contentType: 'application/json', path: '/tmp/network.har' },
            { name: 'no-path', contentType: 'text/plain' }, // no path, should be skipped
          ],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const attachments = body.results[0].attachments;

      expect(attachments).toHaveLength(1);
      expect(attachments[0].name).toBe('har-log');
    });
  });

  describe('upload', () => {
    it('returns not-enabled error when disabled', async () => {
      const uploader = new CloudUploader({});

      const result = await uploader.upload([], Date.now());

      expect(result).toEqual({ success: false, error: 'Cloud upload not enabled' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('succeeds with 200 response and no artifact URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          runId: 'run-abc',
          url: 'https://app.stagewright.dev/runs/run-abc',
        }),
      });

      const uploader = new CloudUploader({ apiKey: 'key-123' });
      const result = await uploader.upload(
        [createTestResult()],
        Date.now() - 5000,
      );

      expect(result.success).toBe(true);
      expect(result.runId).toBe('run-abc');
      expect(result.url).toBe('https://app.stagewright.dev/runs/run-abc');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://app.stagewright.dev/api/v1/runs');
      expect(opts.method).toBe('POST');
      expect(opts.headers['X-API-Key']).toBe('key-123');
      expect(opts.headers['Content-Type']).toBe('application/json');
    });

    it('sends correct payload stats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const results = [
        createTestResult({ status: 'passed', outcome: 'expected' }),
        createTestResult({ testId: 'test-2', status: 'failed', outcome: 'unexpected' }),
        createTestResult({ testId: 'test-3', status: 'skipped', outcome: 'skipped' }),
        createTestResult({ testId: 'test-4', status: 'passed', outcome: 'flaky' }),
      ];

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload(results, Date.now() - 2000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.totalTests).toBe(4);
      expect(body.passed).toBe(2); // status=passed matches test-1 and test-4; skipped has no matching criterion
      expect(body.failed).toBe(1);
      expect(body.skipped).toBe(1);
      expect(body.flaky).toBe(1);
      expect(body.passRate).toBe(50);
    });

    it('includes CI info in payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([createTestResult()], Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.ciProvider).toBe('github');
      expect(body.branch).toBe('main');
      expect(body.commitSha).toBe('abc12345');
      expect(body.ciBuildId).toBe('999');
    });

    it('includes stability score and grade in payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const results = [
        createTestResult({
          stabilityScore: { overall: 95, flakiness: 100, performance: 90, reliability: 95, grade: 'A', needsAttention: false },
        }),
        createTestResult({
          testId: 'test-2',
          stabilityScore: { overall: 85, flakiness: 80, performance: 85, reliability: 90, grade: 'B', needsAttention: false },
        }),
      ];

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload(results, Date.now() - 1000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.stabilityScore).toBe(90); // avg of 95 and 85
      expect(body.stabilityGrade).toBe('A'); // 90 >= 90
    });

    it('uploads artifacts when artifact URLs are returned', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runId: 'run-1',
            artifactUploadUrls: {
              '/tmp/screenshot.png': 'https://storage.example.com/upload/screenshot',
            },
          }),
        })
        .mockResolvedValueOnce({ ok: true }); // artifact upload

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('png-data'));

      const testData = createTestResult({
        attachments: {
          screenshots: ['/tmp/screenshot.png'],
          videos: [],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      await uploader.upload([testData], Date.now() - 1000);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [artifactUrl, artifactOpts] = mockFetch.mock.calls[1];
      expect(artifactUrl).toBe('https://storage.example.com/upload/screenshot');
      expect(artifactOpts.method).toBe('PUT');
      expect(artifactOpts.headers['Content-Type']).toBe('image/png');
    });

    it('skips artifact upload when uploadArtifacts is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          runId: 'run-1',
          artifactUploadUrls: {
            '/tmp/screenshot.png': 'https://storage.example.com/upload/screenshot',
          },
        }),
      });

      const testData = createTestResult({
        attachments: {
          screenshots: ['/tmp/screenshot.png'],
          videos: [],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key', uploadArtifacts: false });
      await uploader.upload([testData], Date.now() - 1000);

      expect(mockFetch).toHaveBeenCalledTimes(1); // only the main upload
    });

    it('returns error on API 4xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      const uploader = new CloudUploader({ apiKey: 'bad-key' });
      const result = await uploader.upload([createTestResult()], Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
      expect(result.error).toContain('Unauthorized');
    });

    it('returns error on API 5xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([createTestResult()], Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('500');
      expect(result.error).toContain('Internal Server Error');
    });

    it('returns error on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network unreachable'));

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([createTestResult()], Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network unreachable');
    });

    it('returns error on non-Error throw', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([createTestResult()], Date.now());

      expect(result.success).toBe(false);
      expect(result.error).toContain('string error');
    });

    it('uses custom endpoint when configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const uploader = new CloudUploader({
        apiKey: 'key',
        cloudEndpoint: 'https://custom.api.dev/v2',
      });
      await uploader.upload([createTestResult()], Date.now());

      expect(mockFetch.mock.calls[0][0]).toBe('https://custom.api.dev/v2/runs');
    });

    it('handles artifact upload failure gracefully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            runId: 'run-1',
            artifactUploadUrls: {
              '/tmp/screenshot.png': 'https://storage.example.com/upload/screenshot',
            },
          }),
        })
        .mockResolvedValueOnce({ ok: false, status: 403 });

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('png-data'));

      const testData = createTestResult({
        attachments: {
          screenshots: ['/tmp/screenshot.png'],
          videos: [],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([testData], Date.now() - 1000);

      // Main upload should still succeed even if artifact upload fails
      expect(result.success).toBe(true);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to upload artifact'),
      );
    });

    it('skips artifact upload when file does not exist', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          runId: 'run-1',
          artifactUploadUrls: {
            '/tmp/missing.png': 'https://storage.example.com/upload/missing',
          },
        }),
      });

      mockFs.existsSync.mockReturnValue(false);

      const testData = createTestResult({
        attachments: {
          screenshots: ['/tmp/missing.png'],
          videos: [],
          traces: [],
          custom: [],
        },
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([testData], Date.now() - 1000);

      expect(result.success).toBe(true);
      // Only main upload, no artifact upload attempt
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles empty results array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ runId: 'run-1' }),
      });

      const uploader = new CloudUploader({ apiKey: 'key' });
      const result = await uploader.upload([], Date.now());

      expect(result.success).toBe(true);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.totalTests).toBe(0);
      expect(body.passRate).toBe(0);
    });
  });
});
