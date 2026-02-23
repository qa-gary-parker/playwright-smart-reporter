import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIAnalyzer } from './ai-analyzer';
import type { TestResultData } from '../types';

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

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('AIAnalyzer config', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('community tier with custom model', () => {
    it('downgrades to default model and logs warning', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer({
        ai: { model: 'claude-3-opus-20240229' },
        tier: 'community',
      });

      const results = [createTestResult({ status: 'failed', error: 'Error' })];
      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe('claude-3-haiku-20240307');

      expect(warnSpy).toHaveBeenCalledWith(
        'Smart Reporter: Custom AI model requires a Pro license. Using default model.'
      );
    });
  });

  describe('pro tier with custom model', () => {
    it('uses the custom model directly', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer({
        ai: { model: 'claude-3-opus-20240229' },
        tier: 'pro',
      });

      const results = [createTestResult({ status: 'failed', error: 'Error' })];
      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.model).toBe('claude-3-opus-20240229');
    });
  });

  describe('custom system prompt', () => {
    it('passes system prompt through when pro tier', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer({
        ai: { systemPrompt: 'You are a test analysis expert.' },
        tier: 'pro',
      });

      const results = [createTestResult({ status: 'failed', error: 'Error' })];
      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.system).toBe('You are a test analysis expert.');
    });
  });

  describe('custom prompt template', () => {
    it('interpolates variables in custom template', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer({
        ai: { promptTemplate: 'Fix {{title}} in {{file}} with error: {{error}} using {{framework}}' },
        tier: 'pro',
      });

      const results = [createTestResult({
        title: 'Login Test',
        file: 'auth.spec.ts',
        status: 'failed',
        error: 'Timeout waiting for selector',
      })];
      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.messages[0].content).toBe(
        'Fix Login Test in auth.spec.ts with error: Timeout waiting for selector using Playwright'
      );
    });
  });

  describe('custom maxTokens', () => {
    it('uses custom maxTokens when pro tier', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'suggestion' }],
        }),
      });

      const analyzer = new AIAnalyzer({
        ai: { maxTokens: 1024 },
        tier: 'pro',
      });

      const results = [createTestResult({ status: 'failed', error: 'Error' })];
      await analyzer.analyzeFailed(results);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.max_tokens).toBe(1024);
    });
  });
});
