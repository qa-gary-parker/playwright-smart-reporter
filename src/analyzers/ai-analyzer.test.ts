import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIAnalyzer } from './ai-analyzer';
import type { TestResultData, FailureCluster, SuiteStats } from '../types';

function createTestResult(overrides: Partial<TestResultData> = {}): TestResultData {
  return {
    testId: 'test-1',
    title: 'Test 1',
    file: 'test.spec.ts',
    status: 'passed',
    duration: 1000,
    retry: 0,
    steps: [],
    history: [],
    ...overrides,
  };
}

function createFailureCluster(overrides: Partial<FailureCluster> = {}): FailureCluster {
  return {
    id: 'cluster-1',
    errorType: 'Timeout Error',
    count: 1,
    tests: [createTestResult({ status: 'failed', error: 'TimeoutError: Waiting for selector' })],
    ...overrides,
  };
}

function createSuiteStats(overrides: Partial<SuiteStats> = {}): SuiteStats {
  return {
    total: 10,
    passed: 9,
    failed: 1,
    skipped: 0,
    flaky: 0,
    slow: 0,
    needsRetry: 0,
    passRate: 90,
    averageStability: 85,
    ...overrides,
  };
}

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockProxyResponse(suggestion: string, remaining = 50, resetAt = 1700000000) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ suggestion, remaining, resetAt }),
  };
}

describe('AIAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true for pro tier with licenseKey', () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns true for team tier with licenseKey', () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'team' });
      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns false for community tier', () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'community' });
      expect(analyzer.isAvailable()).toBe(false);
    });

    it('returns false when no licenseKey is set', () => {
      const analyzer = new AIAnalyzer({ tier: 'pro' });
      expect(analyzer.isAvailable()).toBe(false);
    });

    it('returns false with no config at all', () => {
      const analyzer = new AIAnalyzer();
      expect(analyzer.isAvailable()).toBe(false);
    });
  });

  describe('analyzeFailed', () => {
    it('skips analysis when no failed tests', async () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ status: 'skipped' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns silently for community tier with failures (upsell handled by smart-reporter)', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const analyzer = new AIAnalyzer({ tier: 'community' });
      const results = [
        createTestResult({ status: 'failed', error: 'Test failed' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('calls proxy with correct URL, auth, and body', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Check your selector syntax'));

      const analyzer = new AIAnalyzer({ licenseKey: 'my-key', tier: 'pro' });
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'Element not found',
        }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://stagewright.dev/api/v1/ai/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-key',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('failure');
      expect(body.prompt).toContain('Element not found');
      expect(results[0].aiSuggestion).toBe('Check your selector syntax');
    });

    it('uses custom proxyUrl when provided', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('suggestion'));

      const analyzer = new AIAnalyzer({
        licenseKey: 'key',
        tier: 'pro',
        proxyUrl: 'https://custom.proxy/ai',
      });
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://custom.proxy/ai',
        expect.anything()
      );
    });

    it('processes in batches of 3 concurrent requests', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockProxyResponse(`suggestion-${i}`));
      }

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = Array.from({ length: 5 }, (_, i) =>
        createTestResult({ testId: `test-${i}`, status: 'failed', error: `Error ${i}` })
      );

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(5);
      results.forEach((r, i) => {
        expect(r.aiSuggestion).toBe(`suggestion-${i}`);
      });
    });

    it('stops sending after 429 rate limit', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ resetAt: 1700000000 }),
      });

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = Array.from({ length: 4 }, (_, i) =>
        createTestResult({ testId: `test-${i}`, status: 'failed', error: `Error ${i}` })
      );

      await analyzer.analyzeFailed(results);

      // First call returned 429, remaining calls in batch may still fire
      // but subsequent batches should not
      expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('handles 401 auth error gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      const analyzer = new AIAnalyzer({ licenseKey: 'bad-key', tier: 'pro' });
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get AI suggestion'),
        expect.any(Error)
      );
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('handles 403 auth error gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalled();
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('logs quota on first successful response', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('suggestion', 42, 1700000000));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('AI quota remaining: 42'))).toBe(true);

      logSpy.mockRestore();
    });

    it('uses custom aiPrompt if provided', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Custom suggestion'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const customPrompt = 'Custom prompt for analysis';
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Error',
          aiPrompt: customPrompt,
        }),
      ];

      await analyzer.analyzeFailed(results);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toBe(customPrompt);
    });

    it('analyzes timedOut tests', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Test suggestion'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = [
        createTestResult({
          status: 'timedOut',
          error: 'Test timed out',
        }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(results[0].aiSuggestion).toBe('Test suggestion');
    });

    it('handles generic server error gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalled();
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('analyzeClusters', () => {
    it('skips analysis when no clusters', async () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });

      await analyzer.analyzeClusters([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips analysis when not available', async () => {
      const analyzer = new AIAnalyzer({ tier: 'community' });
      const clusters = [createFailureCluster()];

      await analyzer.analyzeClusters(clusters);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('analyzes clusters via proxy', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Cluster suggestion'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const clusters = [createFailureCluster()];

      await analyzer.analyzeClusters(clusters);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('cluster');
      expect(clusters[0].aiSuggestion).toBe('Cluster suggestion');
    });
  });

  describe('generateRecommendations', () => {
    it('generates flakiness recommendations for flaky tests', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ testId: 'test-1', flakinessScore: 0.5 }),
        createTestResult({ testId: 'test-2', flakinessScore: 0.8 }),
      ];
      const stats = createSuiteStats();

      const recommendations = analyzer.generateRecommendations(results, stats);

      const flakinessRec = recommendations.find(r => r.type === 'flakiness');
      expect(flakinessRec).toBeDefined();
      expect(flakinessRec?.affectedTests).toContain('test-1');
      expect(flakinessRec?.affectedTests).toContain('test-2');
      expect(flakinessRec?.icon).toBe('🔴');
    });

    it('does not generate flakiness recommendations for stable tests', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ flakinessScore: 0.1 }),
        createTestResult({ flakinessScore: 0.2 }),
      ];
      const stats = createSuiteStats();

      const recommendations = analyzer.generateRecommendations(results, stats);

      const flakinessRec = recommendations.find(r => r.type === 'flakiness');
      expect(flakinessRec).toBeUndefined();
    });

    it('generates retry recommendations for tests needing attention', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({
          testId: 'test-1',
          retryInfo: {
            totalRetries: 3,
            passedOnRetry: 2,
            failedRetries: 2,
            retryPattern: [false, false, true],
            needsAttention: true,
          },
        }),
      ];
      const stats = createSuiteStats();

      const recommendations = analyzer.generateRecommendations(results, stats);

      const retryRec = recommendations.find(r => r.type === 'retry');
      expect(retryRec).toBeDefined();
      expect(retryRec?.affectedTests).toContain('test-1');
      expect(retryRec?.icon).toBe('🔄');
    });

    it('generates performance recommendations for slowing tests', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ testId: 'test-1', performanceTrend: '↑ 50%' }),
        createTestResult({ testId: 'test-2', performanceTrend: '↓ 10%' }),
      ];
      const stats = createSuiteStats();

      const recommendations = analyzer.generateRecommendations(results, stats);

      const perfRec = recommendations.find(r => r.type === 'performance');
      expect(perfRec).toBeDefined();
      expect(perfRec?.affectedTests).toContain('test-1');
      expect(perfRec?.affectedTests).not.toContain('test-2');
      expect(perfRec?.icon).toBe('🐢');
    });

    it('generates suite pass rate recommendation when below 90%', () => {
      const analyzer = new AIAnalyzer();
      const results: TestResultData[] = [];
      const stats = createSuiteStats({ passRate: 75 });

      const recommendations = analyzer.generateRecommendations(results, stats);

      const suiteRec = recommendations.find(
        r => r.type === 'suite' && r.title === 'Improve Suite Pass Rate'
      );
      expect(suiteRec).toBeDefined();
      expect(suiteRec?.description).toContain('75%');
      expect(suiteRec?.icon).toBe('📊');
    });

    it('does not generate pass rate recommendation when at or above 90%', () => {
      const analyzer = new AIAnalyzer();
      const results: TestResultData[] = [];
      const stats = createSuiteStats({ passRate: 95 });

      const recommendations = analyzer.generateRecommendations(results, stats);

      const passRateRec = recommendations.find(
        r => r.type === 'suite' && r.title === 'Improve Suite Pass Rate'
      );
      expect(passRateRec).toBeUndefined();
    });

    it('generates stability recommendation when below 70', () => {
      const analyzer = new AIAnalyzer();
      const results: TestResultData[] = [];
      const stats = createSuiteStats({ averageStability: 55 });

      const recommendations = analyzer.generateRecommendations(results, stats);

      const stabilityRec = recommendations.find(
        r => r.type === 'suite' && r.title === 'Improve Suite Stability'
      );
      expect(stabilityRec).toBeDefined();
      expect(stabilityRec?.description).toContain('55');
      expect(stabilityRec?.icon).toBe('⚠️');
    });

    it('sorts recommendations by priority (highest first)', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ testId: 'test-1', flakinessScore: 0.5 }),
        createTestResult({ testId: 'test-2', performanceTrend: '↑ 50%' }),
      ];
      const stats = createSuiteStats({ passRate: 75, averageStability: 55 });

      const recommendations = analyzer.generateRecommendations(results, stats);

      for (let i = 0; i < recommendations.length - 1; i++) {
        expect(recommendations[i].priority).toBeGreaterThanOrEqual(
          recommendations[i + 1].priority
        );
      }
    });
  });
});
