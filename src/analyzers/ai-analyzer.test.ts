import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function mockAnthropicResponse(suggestion: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: suggestion }] }),
  };
}

function mockOpenAIResponse(suggestion: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: suggestion } }] }),
  };
}

function mockGeminiResponse(suggestion: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: suggestion }] }, role: 'model' }] }),
  };
}

function clearAiKeys() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
}

describe('AIAnalyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAiKeys();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('isAvailable', () => {
    it('returns true with ANTHROPIC_API_KEY set', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'key-123');
      expect(new AIAnalyzer().isAvailable()).toBe(true);
    });

    it('returns true with OPENAI_API_KEY set', () => {
      vi.stubEnv('OPENAI_API_KEY', 'key-123');
      expect(new AIAnalyzer().isAvailable()).toBe(true);
    });

    it('returns true with GEMINI_API_KEY set', () => {
      vi.stubEnv('GEMINI_API_KEY', 'key-123');
      expect(new AIAnalyzer().isAvailable()).toBe(true);
    });

    it('returns false with no API keys set', () => {
      expect(new AIAnalyzer().isAvailable()).toBe(false);
    });
  });

  describe('analyzeFailed', () => {
    it('skips analysis when no failed tests', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'key-123');
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ status: 'skipped' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('logs a tip and skips when no API keys are set', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Test failed' })];

      await analyzer.analyzeFailed(results);

      const logCalls = logSpy.mock.calls.map(c => String(c[0]));
      expect(logCalls.some(m => m.includes('ANTHROPIC_API_KEY'))).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });

    it('calls Anthropic API with correct URL, auth headers, and body', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'my-key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Check your selector syntax'));

      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ testId: 'test-1', status: 'failed', error: 'Element not found' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': 'my-key',
            'anthropic-version': '2023-06-01',
          }),
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('claude-haiku-4-5');
      expect(body.messages[0].content).toContain('Element not found');
      expect(results[0].aiSuggestion).toBe('Check your selector syntax');
    });

    it('falls back to OpenAI when only OPENAI_API_KEY is set', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('OPENAI_API_KEY', 'openai-key');
      mockFetch.mockResolvedValueOnce(mockOpenAIResponse('OpenAI suggestion'));

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer openai-key' }),
        })
      );
      expect(results[0].aiSuggestion).toBe('OpenAI suggestion');
    });

    it('falls back to Gemini when only GEMINI_API_KEY is set', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('GEMINI_API_KEY', 'gemini-key');
      mockFetch.mockResolvedValueOnce(mockGeminiResponse('Gemini suggestion'));

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-key' }),
        })
      );
      expect(results[0].aiSuggestion).toBe('Gemini suggestion');
    });

    it('prefers Anthropic when multiple keys are set', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-key');
      vi.stubEnv('OPENAI_API_KEY', 'openai-key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('suggestion'));

      const analyzer = new AIAnalyzer();
      await analyzer.analyzeFailed([createTestResult({ status: 'failed', error: 'Error' })]);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.anything()
      );
    });

    it('processes in batches of 3 concurrent requests', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      for (let i = 0; i < 5; i++) {
        mockFetch.mockResolvedValueOnce(mockAnthropicResponse(`suggestion-${i}`));
      }

      const analyzer = new AIAnalyzer();
      const results = Array.from({ length: 5 }, (_, i) =>
        createTestResult({ testId: `test-${i}`, status: 'failed', error: `Error ${i}` })
      );

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(5);
      results.forEach((r, i) => {
        expect(r.aiSuggestion).toBe(`suggestion-${i}`);
      });
    });

    it('handles API error gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'bad-key');

      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get AI suggestion'),
        expect.any(Error)
      );
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('handles generic server error gracefully', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');

      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalled();
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('uses custom aiPrompt if provided', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Custom suggestion'));

      const analyzer = new AIAnalyzer();
      const customPrompt = 'Custom prompt for analysis';
      const results = [
        createTestResult({ status: 'failed', error: 'Error', aiPrompt: customPrompt }),
      ];

      await analyzer.analyzeFailed(results);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toBe(customPrompt);
    });

    it('analyzes timedOut tests', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Test suggestion'));

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'timedOut', error: 'Test timed out' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(results[0].aiSuggestion).toBe('Test suggestion');
    });
  });

  describe('analyzeClusters', () => {
    it('skips analysis when no clusters', async () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      const analyzer = new AIAnalyzer();

      await analyzer.analyzeClusters([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips analysis when no API keys are set', async () => {
      const analyzer = new AIAnalyzer();
      const clusters = [createFailureCluster()];

      await analyzer.analyzeClusters(clusters);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('analyzes clusters and attaches suggestions', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Cluster suggestion'));

      const analyzer = new AIAnalyzer();
      const clusters = [createFailureCluster()];

      await analyzer.analyzeClusters(clusters);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Timeout Error');
      expect(clusters[0].aiSuggestion).toBe('Cluster suggestion');
    });
  });

  describe('analyzeSuiteHealth', () => {
    it('returns undefined when no API keys are set', async () => {
      const analyzer = new AIAnalyzer();
      const stats = createSuiteStats();

      const result = await analyzer.analyzeSuiteHealth([], stats, [], []);

      expect(result).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('builds suite-health prompt and returns summary', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Your suite has 3 recurring failures in auth flows.'));

      const analyzer = new AIAnalyzer();
      const stats = createSuiteStats({ failed: 3, passRate: 70 });
      const clusters = [createFailureCluster({ count: 3, errorType: 'Authentication Error' })];
      const flakyResults = [createTestResult({ flakinessScore: 0.5 })];

      const result = await analyzer.analyzeSuiteHealth(flakyResults, stats, clusters, []);

      expect(result).toBe('Your suite has 3 recurring failures in auth flows.');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('Pass Rate: 70%');
      expect(body.messages[0].content).toContain('Authentication Error');
    });

    it('includes history trend in prompt when summaries available', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce(mockAnthropicResponse('Health summary'));

      const analyzer = new AIAnalyzer();
      const stats = createSuiteStats({ passRate: 85 });
      const historySummaries = [
        { runId: 'r1', timestamp: '2025-01-01', total: 10, passed: 9, failed: 1, skipped: 0, flaky: 0, slow: 0, duration: 1000, passRate: 90 },
        { runId: 'r2', timestamp: '2025-01-02', total: 10, passed: 8, failed: 2, skipped: 0, flaky: 0, slow: 0, duration: 1000, passRate: 80 },
      ];

      await analyzer.analyzeSuiteHealth([], stats, [], historySummaries);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[0].content).toContain('90%');
      expect(body.messages[0].content).toContain('80%');
      expect(body.messages[0].content).toContain('85% (current)');
    });

    it('returns undefined on API error', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubEnv('ANTHROPIC_API_KEY', 'key');
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const analyzer = new AIAnalyzer();
      const stats = createSuiteStats();

      const result = await analyzer.analyzeSuiteHealth([], stats, [], []);

      expect(result).toBeUndefined();
    });
  });

  describe('generateRecommendations', () => {
    it('recommends fixing consistently failing tests separately from flaky ones', () => {
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ testId: 'broken-1', flakinessScore: 1, outcome: 'unexpected' }),
        createTestResult({ testId: 'flaky-1', flakinessScore: 0.5 }),
      ];
      const stats = createSuiteStats();

      const recommendations = analyzer.generateRecommendations(results, stats);

      const failingRec = recommendations.find(r => r.title === 'Fix Consistently Failing Tests');
      const flakyRec = recommendations.find(r => r.title === 'Fix Flaky Tests');
      expect(failingRec?.affectedTests).toEqual(['broken-1']);
      expect(flakyRec?.affectedTests).toEqual(['flaky-1']);
    });

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
