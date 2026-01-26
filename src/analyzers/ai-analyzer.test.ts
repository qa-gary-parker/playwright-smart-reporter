import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIAnalyzer } from './ai-analyzer';
import type { TestResultData, FailureCluster, SuiteStats } from '../types';

// Helper to create test result data
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

// Helper to create failure cluster
function createFailureCluster(overrides: Partial<FailureCluster> = {}): FailureCluster {
  return {
    id: 'cluster-1',
    errorType: 'Timeout Error',
    count: 1,
    tests: [createTestResult({ status: 'failed', error: 'TimeoutError: Waiting for selector' })],
    ...overrides,
  };
}

// Helper to create suite stats
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

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AIAnalyzer', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };
    // Clear all AI keys
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('isAvailable', () => {
    it('returns true when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      const analyzer = new AIAnalyzer();

      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns true when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      const analyzer = new AIAnalyzer();

      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns true when GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const analyzer = new AIAnalyzer();

      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns true when multiple keys are set', () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      process.env.OPENAI_API_KEY = 'test-openai-key';
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const analyzer = new AIAnalyzer();

      expect(analyzer.isAvailable()).toBe(true);
    });

    it('returns false when no keys are set', () => {
      const analyzer = new AIAnalyzer();

      expect(analyzer.isAvailable()).toBe(false);
    });
  });

  describe('analyzeFailed', () => {
    it('skips analysis when no failed tests', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ status: 'passed' }),
        createTestResult({ status: 'skipped' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('logs tip message when no API keys are set', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({ status: 'failed', error: 'Test failed' }),
      ];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalledWith(
        '💡 Tip: Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI failure analysis'
      );
      expect(mockFetch).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('analyzes failed tests with Anthropic', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Check your selector syntax' }],
        }),
      });

      const analyzer = new AIAnalyzer();
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
        'https://api.anthropic.com/v1/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-api-key': 'test-anthropic-key',
          }),
        })
      );
      expect(results[0].aiSuggestion).toBe('Check your selector syntax');
    });

    it('analyzes failed tests with OpenAI when Anthropic key is not set', async () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Add proper wait condition' } }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'Timeout waiting for element',
        }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        })
      );
      expect(results[0].aiSuggestion).toBe('Add proper wait condition');
    });

    it('analyzes failed tests with Gemini when Anthropic and OpenAI keys are not set', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'Increase timeout value' }] },
            role: 'model',
          }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({
          testId: 'test-1',
          status: 'failed',
          error: 'Test timeout exceeded',
        }),
      ];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-goog-api-key': 'test-gemini-key',
          }),
        })
      );
      expect(results[0].aiSuggestion).toBe('Increase timeout value');
    });

    it('analyzes timedOut tests', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Test suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer();
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

    it('uses custom aiPrompt if provided', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Custom suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const customPrompt = 'Custom prompt for analysis';
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Error',
          aiPrompt: customPrompt,
        }),
      ];

      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messages[0].content).toBe(customPrompt);
    });

    it('handles API errors gracefully', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Test error',
        }),
      ];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalled();
      expect(results[0].aiSuggestion).toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe('analyzeClusters', () => {
    it('skips analysis when no clusters', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
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

    it('analyzes clusters with available AI provider', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'Cluster suggestion' }] },
            role: 'model',
          }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const clusters = [createFailureCluster()];

      await analyzer.analyzeClusters(clusters);

      expect(mockFetch).toHaveBeenCalledTimes(1);
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
        createTestResult({ testId: 'test-2', performanceTrend: '↓ 10%' }), // improved, should not be included
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

      // Verify sorted by priority descending
      for (let i = 0; i < recommendations.length - 1; i++) {
        expect(recommendations[i].priority).toBeGreaterThanOrEqual(
          recommendations[i + 1].priority
        );
      }
    });
  });

  describe('AI provider priority (fall-through behavior)', () => {
    it('prefers Anthropic when all keys are set', async () => {
      process.env.ANTHROPIC_API_KEY = 'anthropic-key';
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Anthropic response' }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.anthropic.com/v1/messages',
        expect.anything()
      );
    });

    it('falls back to OpenAI when only OpenAI and Gemini keys are set', async () => {
      process.env.OPENAI_API_KEY = 'openai-key';
      process.env.GEMINI_API_KEY = 'gemini-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'OpenAI response' } }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.anything()
      );
    });

    it('uses Gemini when only Gemini key is set', async () => {
      process.env.GEMINI_API_KEY = 'gemini-key';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'Gemini response' }] },
            role: 'model',
          }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        expect.anything()
      );
    });
  });

  describe('Gemini API request format', () => {
    it('sends correct request body format', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: 'Response' }] },
            role: 'model',
          }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [
        createTestResult({
          status: 'failed',
          error: 'Test error',
          title: 'My Test',
          file: 'test.spec.ts',
        }),
      ];

      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);

      // Verify contents is an array
      expect(Array.isArray(body.contents)).toBe(true);
      expect(body.contents[0].parts).toBeDefined();
      expect(body.contents[0].parts[0].text).toContain('My Test');

      // Verify generationConfig
      expect(body.generationConfig.maxOutputTokens).toBe(512);
    });

    it('handles empty candidates array', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(results[0].aiSuggestion).toBe('No suggestion available');
    });

    it('handles missing parts in response', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [] },
            role: 'model',
          }],
        }),
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(results[0].aiSuggestion).toBe('No suggestion available');
    });

    it('throws on Gemini API error', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      const analyzer = new AIAnalyzer();
      const results = [createTestResult({ status: 'failed', error: 'Error' })];

      await analyzer.analyzeFailed(results);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get AI suggestion'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });
});
