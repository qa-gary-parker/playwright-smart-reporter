import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIAnalyzer } from './ai-analyzer';
import type { TestResultData, FailureCluster, SuiteStats, A11ySuiteScore } from '../types';

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

    it('returns true for starter tier with licenseKey', () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'starter' });
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
        'https://stagewright.dev/api/ai/analyze',
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

  describe('analyzeSuiteHealth', () => {
    it('returns undefined when not available', async () => {
      const analyzer = new AIAnalyzer({ tier: 'community' });
      const stats = createSuiteStats();

      const result = await analyzer.analyzeSuiteHealth([], stats, [], []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls proxy with suite-health type and returns summary', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Your suite has 3 recurring failures in auth flows.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const stats = createSuiteStats({ failed: 3, passRate: 70 });
      const clusters = [createFailureCluster({ count: 3, errorType: 'Authentication Error' })];
      const flakyResults = [createTestResult({ flakinessScore: 0.5 })];

      const result = await analyzer.analyzeSuiteHealth(flakyResults, stats, clusters, []);

      expect(result).toBe('Your suite has 3 recurring failures in auth flows.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('suite-health');
      expect(body.prompt).toContain('Pass Rate: 70%');
      expect(body.prompt).toContain('Authentication Error');
    });

    it('includes history trend in prompt when summaries available', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Health summary'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const stats = createSuiteStats({ passRate: 85 });
      const historySummaries = [
        { runId: 'r1', timestamp: '2025-01-01', total: 10, passed: 9, failed: 1, skipped: 0, flaky: 0, slow: 0, duration: 1000, passRate: 90 },
        { runId: 'r2', timestamp: '2025-01-02', total: 10, passed: 8, failed: 2, skipped: 0, flaky: 0, slow: 0, duration: 1000, passRate: 80 },
      ];

      await analyzer.analyzeSuiteHealth([], stats, [], historySummaries);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toContain('90%');
      expect(body.prompt).toContain('80%');
      expect(body.prompt).toContain('85% (current)');
    });

    it('returns undefined on proxy error', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const stats = createSuiteStats();

      const result = await analyzer.analyzeSuiteHealth([], stats, [], []);

      expect(result).toBeUndefined();
    });

    it('returns undefined when rate limited', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // First trigger rate limiting via analyzeFailed
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ resetAt: 1700000000 }) });
      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      await analyzer.analyzeFailed([createTestResult({ status: 'failed', error: 'Error' })]);

      mockFetch.mockClear();
      const result = await analyzer.analyzeSuiteHealth([], createSuiteStats(), [], []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
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

  describe('analyzeAccessibility', () => {
    function createSuiteScore(overrides: Partial<A11ySuiteScore> = {}): A11ySuiteScore {
      return {
        totalViolations: 5,
        critical: 1,
        serious: 2,
        moderate: 1,
        minor: 1,
        testsWithViolations: 3,
        testsScanned: 10,
        rating: 'fair',
        topViolationIds: ['color-contrast', 'image-alt'],
        ...overrides,
      };
    }

    function createTestResultWithA11y(overrides: Partial<TestResultData> = {}): TestResultData {
      return createTestResult({
        accessibility: {
          violations: [
            {
              id: 'color-contrast',
              impact: 'serious',
              description: 'Elements must have sufficient color contrast',
              helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/color-contrast',
              wcagTags: ['wcag2aa', 'wcag143'],
              nodes: [{ html: '<button>', target: ['button'], failureSummary: 'Fix contrast' }],
            },
          ],
          passes: 10,
          incomplete: 0,
          inapplicable: 0,
          timestamp: '2025-01-01T00:00:00Z',
          standard: 'WCAG2AA',
        },
        ...overrides,
      });
    }

    it('returns undefined when isAvailable() is false (no license key)', async () => {
      const analyzer = new AIAnalyzer({ tier: 'pro' });
      const suiteScore = createSuiteScore();

      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns undefined when isAvailable() is false (community tier)', async () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'community' });
      const suiteScore = createSuiteScore();

      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns undefined when testsScanned is 0', async () => {
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      const suiteScore = createSuiteScore({ testsScanned: 0 });

      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns undefined when rate limited', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});

      // Trigger rate limiting on the same analyzer instance via analyzeFailed
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ resetAt: 1700000000 }),
      });
      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      await analyzer.analyzeFailed([createTestResult({ status: 'failed', error: 'Error' })]);

      mockFetch.mockClear();
      const suiteScore = createSuiteScore();
      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns string suggestion from proxy response', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Accessibility analysis complete.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      const suiteScore = createSuiteScore({ critical: 2, serious: 3, totalViolations: 8 });
      const results = [createTestResultWithA11y()];

      const result = await analyzer.analyzeAccessibility(suiteScore, results);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toBe('Accessibility analysis complete.');
    });

    it('prompt includes violation severity counts from suite score', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Severity analysis done.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key-123', tier: 'pro' });
      const suiteScore = createSuiteScore({
        rating: 'poor',
        totalViolations: 12,
        testsWithViolations: 7,
        testsScanned: 10,
        critical: 3,
        serious: 4,
      });

      await analyzer.analyzeAccessibility(suiteScore, []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toContain('poor');
      expect(body.prompt).toContain('12');
      expect(body.prompt).toContain('7');
      expect(body.prompt).toContain('10');
      expect(body.prompt).toContain('3'); // critical count
      expect(body.prompt).toContain('4'); // serious count
    });

    it('calls proxy with type accessibility and returns suggestion', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Your app has critical contrast issues.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'my-key', tier: 'pro' });
      const suiteScore = createSuiteScore();
      const results = [createTestResultWithA11y()];

      const result = await analyzer.analyzeAccessibility(suiteScore, results);

      expect(result).toBe('Your app has critical contrast issues.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://stagewright.dev/api/ai/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer my-key',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('accessibility');
    });

    it('proxy request body contains accessibility score data', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Fix your contrast ratios.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const suiteScore = createSuiteScore({
        rating: 'poor',
        totalViolations: 20,
        critical: 5,
        testsScanned: 15,
        testsWithViolations: 8,
      });

      await analyzer.analyzeAccessibility(suiteScore, []);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toContain('poor');
      expect(body.prompt).toContain('15');
      expect(body.prompt).toContain('20');
      expect(body.prompt).toContain('5');
    });

    it('returns undefined on proxy error (fetch throws)', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const suiteScore = createSuiteScore();

      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
    });

    it('returns undefined on proxy 500 error', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const suiteScore = createSuiteScore();

      const result = await analyzer.analyzeAccessibility(suiteScore, []);

      expect(result).toBeUndefined();
    });

    it('aggregates violations across multiple results for prompt', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('Multiple issues found.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const suiteScore = createSuiteScore();

      const results = [
        createTestResultWithA11y({ testId: 'test-1' }),
        createTestResultWithA11y({
          testId: 'test-2',
          accessibility: {
            violations: [
              {
                id: 'image-alt',
                impact: 'critical',
                description: 'Images must have alternate text',
                helpUrl: 'https://dequeuniversity.com/rules/axe/4.4/image-alt',
                wcagTags: ['wcag2a', 'wcag111'],
                nodes: [{ html: '<img src="logo.png">', target: ['img'], failureSummary: 'Add alt' }],
              },
            ],
            passes: 5,
            incomplete: 0,
            inapplicable: 0,
            timestamp: '2025-01-01T00:00:00Z',
            standard: 'WCAG2AA',
          },
        }),
      ];

      await analyzer.analyzeAccessibility(suiteScore, results);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // Both violations should appear in prompt
      expect(body.prompt).toContain('color-contrast');
      expect(body.prompt).toContain('image-alt');
    });

    it('skips results with no accessibility data when building violation map', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockProxyResponse('No violations from skipped tests.'));

      const analyzer = new AIAnalyzer({ licenseKey: 'key', tier: 'pro' });
      const suiteScore = createSuiteScore();

      const results = [
        createTestResult({ testId: 'no-a11y' }), // no accessibility field
        createTestResultWithA11y({ testId: 'has-a11y' }),
      ];

      const result = await analyzer.analyzeAccessibility(suiteScore, results);

      expect(result).toBe('No violations from skipped tests.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toContain('color-contrast');
    });
  });
});
