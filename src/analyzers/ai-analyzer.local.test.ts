import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAnalyzer, callOpenAICompatible, resolveAIProvider } from './ai-analyzer';
import type { FailureCluster, TestResultData } from '../types';

// Real HTTP against a stub that speaks OpenAI-compatible /v1/chat/completions, the API Ollama serves.

interface StubRequest {
  method: string;
  path: string;
  authorization?: string;
  body: { model: string; max_tokens: number; messages: Array<{ role: string; content: string }> };
}

type Handler = (res: ServerResponse) => void;

const reply = (content: string, delayMs = 0): Handler => (res) => {
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  }, delayMs);
};
const status = (code: number): Handler => (res) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end('{"error":{"message":"model not found"}}');
};
const hang: Handler = () => {};

const servers: Array<{ closeAllConnections(): void; close(): void }> = [];

async function startStub(handler: Handler = reply('stub suggestion')) {
  const requests: StubRequest[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method!, path: req.url!, authorization: req.headers.authorization, body: JSON.parse(raw) });
      handler(res);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { port, origin: `http://127.0.0.1:${port}`, requests };
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function failed(i: number): TestResultData {
  return { testId: `t${i}`, title: `test ${i}`, file: 'a.spec.ts', status: 'failed', duration: 1, retry: 0, steps: [], history: [], error: `Error ${i}` };
}

const STATS = { total: 4, passed: 0, failed: 4, skipped: 0, flaky: 0, slow: 0, needsRetry: 0, passRate: 0, averageStability: 50 };

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    s.close();
  }
});

describe('callOpenAICompatible', () => {
  it('posts the model and prompt to <baseUrl>/chat/completions with no Authorization header when no key is set', async () => {
    const stub = await startStub();

    const text = await callOpenAICompatible('why did it fail?', { baseUrl: `${stub.origin}/v1`, model: 'llama3.2' });

    expect(text).toBe('stub suggestion');
    expect(stub.requests).toStrictEqual([{
      method: 'POST',
      path: '/v1/chat/completions',
      authorization: undefined,
      body: { model: 'llama3.2', max_tokens: 512, messages: [{ role: 'user', content: 'why did it fail?' }] },
    }]);
  });

  it('sends the key as a Bearer token when one is set', async () => {
    const stub = await startStub();

    await callOpenAICompatible('p', { baseUrl: `${stub.origin}/v1`, model: 'm', apiKey: 'sk-local' });

    expect(stub.requests.map((r) => r.authorization)).toStrictEqual(['Bearer sk-local']);
  });

  it('names the URL and suggests pulling the model on a 404', async () => {
    const stub = await startStub(status(404));

    await expect(callOpenAICompatible('p', { baseUrl: `${stub.origin}/v1`, model: 'llama3.2' })).rejects.toThrow(
      `OpenAI-compatible API error: 404 from ${stub.origin}/v1/chat/completions (check that model "llama3.2" exists there; for Ollama run \`ollama pull llama3.2\`)`,
    );
  });
});

describe('AIAnalyzer with a local model', () => {
  it('sends OLLAMA_HOST / OLLAMA_MODEL analysis to the Ollama endpoint with no key', async () => {
    const stub = await startStub();
    const results = [failed(1)];

    await new AIAnalyzer(undefined, { OLLAMA_HOST: `127.0.0.1:${stub.port}`, OLLAMA_MODEL: 'qwen2.5:7b' }).analyzeFailed(results);

    expect(results[0].aiSuggestion).toBe('stub suggestion');
    expect(stub.requests.map((r) => [r.path, r.body.model, r.authorization])).toStrictEqual([['/v1/chat/completions', 'qwen2.5:7b', undefined]]);
    expect(logSpy).toHaveBeenCalledWith('\n   Analyzing 1 failure(s) with AI (ollama, qwen2.5:7b)...');
  });

  it('uses an explicit ai.provider "ollama" even when a cloud key is set, and never sends that key', async () => {
    const stub = await startStub();
    const results = [failed(1)];

    await new AIAnalyzer({ provider: 'ollama', baseUrl: `${stub.origin}/v1/` }, { ANTHROPIC_API_KEY: 'sk-ant-api03-real' }).analyzeFailed(results);

    expect(results[0].aiSuggestion).toBe('stub suggestion');
    expect(stub.requests.map((r) => [r.path, r.body.model, r.authorization])).toStrictEqual([['/v1/chat/completions', 'llama3.2', undefined]]);
  });

  it('sends OPENAI_API_KEY as the Bearer token to an openai-compatible endpoint', async () => {
    const stub = await startStub();
    const results = [failed(1)];

    await new AIAnalyzer({ provider: 'openai-compatible', baseUrl: `${stub.origin}/v1`, model: 'gateway-model' }, { OPENAI_API_KEY: 'sk-gateway' }).analyzeFailed(results);

    expect(results[0].aiSuggestion).toBe('stub suggestion');
    expect(stub.requests.map((r) => [r.path, r.body.model, r.authorization])).toStrictEqual([['/v1/chat/completions', 'gateway-model', 'Bearer sk-gateway']]);
  });

  it('skips all analysis with one warning when the host is unreachable', async () => {
    const port = await closedPort();
    const analyzer = new AIAnalyzer(undefined, { OLLAMA_HOST: `127.0.0.1:${port}` });
    const results = [failed(1), failed(2), failed(3), failed(4)];
    const cluster: FailureCluster = { id: 'c1', errorType: 'Error', count: 4, tests: results };

    await analyzer.analyzeFailed(results);
    await analyzer.analyzeClusters([cluster]);
    const summary = await analyzer.analyzeSuiteHealth(results, STATS, [cluster], []);

    expect(warnSpy.mock.calls).toStrictEqual([[
      `⚠️  AI analysis skipped: ollama request to http://127.0.0.1:${port}/v1/chat/completions failed (connect ECONNREFUSED 127.0.0.1:${port}). The test run and report are unaffected.`,
    ]]);
    expect(results.map((r) => r.aiSuggestion)).toStrictEqual([undefined, undefined, undefined, undefined]);
    expect(cluster.aiSuggestion).toBe(undefined);
    expect(summary).toBe(undefined);
    expect(errorSpy.mock.calls).toStrictEqual([]);
  });

  it('abandons a model slower than ai.timeoutMs after the first batch, with one warning', async () => {
    const stub = await startStub(hang);
    const results = [failed(1), failed(2), failed(3), failed(4), failed(5)];

    await new AIAnalyzer({ provider: 'ollama', baseUrl: stub.origin, timeoutMs: 200 }, {}).analyzeFailed(results);

    expect(stub.requests.length).toBe(3);
    expect(warnSpy.mock.calls).toStrictEqual([[
      '⚠️  AI analysis skipped: ollama (llama3.2) did not respond within 0.2s; raise ai.timeoutMs for slow local models. The test run and report are unaffected.',
    ]]);
    expect(results.map((r) => r.aiSuggestion)).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(errorSpy.mock.calls).toStrictEqual([]);
  });

  it('stops at ai.maxTotalMs and keeps the suggestions already produced', async () => {
    const stub = await startStub(reply('stub suggestion', 300));
    const results = [failed(1), failed(2), failed(3), failed(4), failed(5), failed(6)];

    await new AIAnalyzer({ provider: 'ollama', baseUrl: stub.origin, timeoutMs: 5_000, maxTotalMs: 500 }, {}).analyzeFailed(results);

    expect(results.map((r) => r.aiSuggestion)).toStrictEqual([
      'stub suggestion', 'stub suggestion', 'stub suggestion', undefined, undefined, undefined,
    ]);
    expect(warnSpy.mock.calls).toStrictEqual([[
      '⚠️  AI analysis skipped: the 0.5s total analysis cap (ai.maxTotalMs) was reached; remaining items were not analyzed. The test run and report are unaffected.',
    ]]);
    expect(errorSpy.mock.calls).toStrictEqual([]);
  });
});

describe('resolveAIProvider', () => {
  const ALL = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g', CLAUDE_CODE_OAUTH_TOKEN: 'c', OLLAMA_HOST: '127.0.0.1:11434' };

  it.each([
    ['all set', ALL, { provider: 'anthropic', model: 'claude-haiku-4-5', apiKey: 'a' }, true],
    ['no Anthropic', { ...ALL, ANTHROPIC_API_KEY: '' }, { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: 'o' }, true],
    ['no Anthropic or OpenAI', { ...ALL, ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '' }, { provider: 'gemini', model: 'gemini-2.5-flash', apiKey: 'g' }, true],
    ['only the CLI token and Ollama', { CLAUDE_CODE_OAUTH_TOKEN: 'c', OLLAMA_HOST: 'x' }, { provider: 'claude-cli', model: 'claude-haiku-4-5', apiKey: 'c' }, true],
    ['only OLLAMA_HOST', { OLLAMA_HOST: '127.0.0.1:11434' }, { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434/v1' }, false],
    ['only OLLAMA_MODEL', { OLLAMA_MODEL: 'qwen2.5:7b' }, { provider: 'ollama', model: 'qwen2.5:7b', baseUrl: 'http://127.0.0.1:11434/v1' }, false],
    ['nothing', {}, undefined, false],
  ])('detects from env in documented order: %s', (_name, env, expected, shadowed) => {
    const r = resolveAIProvider(undefined, env);
    expect(r.resolved).toStrictEqual(expected);
    expect(r.localShadowed).toBe(shadowed);
  });

  it('routes an OAuth token in ANTHROPIC_API_KEY to the Claude CLI (issue #40)', () => {
    expect(resolveAIProvider(undefined, { ANTHROPIC_API_KEY: 'sk-ant-oat01-x', OPENAI_API_KEY: 'o' })).toStrictEqual({
      resolved: { provider: 'openai', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: 'o' },
      oauthInApiKey: true,
      localShadowed: false,
    });
    expect(resolveAIProvider({ provider: 'anthropic' }, { ANTHROPIC_API_KEY: 'sk-ant-oat01-x' }).resolved)
      .toStrictEqual({ provider: 'claude-cli', model: 'claude-haiku-4-5', apiKey: 'sk-ant-oat01-x' });
  });

  it('lets an explicit ai.provider win over every key, with ai.model applied', () => {
    expect(resolveAIProvider({ provider: 'ollama', model: 'phi4' }, ALL)).toStrictEqual({
      resolved: { provider: 'ollama', model: 'phi4', baseUrl: 'http://127.0.0.1:11434/v1' },
      oauthInApiKey: false,
      localShadowed: false,
    });
    expect(resolveAIProvider({ model: 'claude-sonnet-4-5' }, { ANTHROPIC_API_KEY: 'a' }).resolved)
      .toStrictEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'a' });
  });

  it.each([
    [{ provider: 'openai' } as const, 'ai.provider is "openai" but OPENAI_API_KEY is not set'],
    [{ provider: 'openai-compatible', baseUrl: 'http://gw/v1' } as const, 'ai.provider is "openai-compatible" but it needs both ai.baseUrl and ai.model'],
    [{ provider: 'mistral' as never }, 'ai.provider is "mistral" but that is not a supported provider'],
  ])('reports why an explicit provider cannot run: %o', (config, problem) => {
    expect(resolveAIProvider(config, { ANTHROPIC_API_KEY: 'a' })).toStrictEqual({ problem, oauthInApiKey: false, localShadowed: false });
  });

  it.each([
    ['0.0.0.0', 'http://0.0.0.0:11434/v1'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/v1'],
    ['[::1]', 'http://[::1]:11434/v1'],
    ['http://gpu-box:11434/', 'http://gpu-box:11434/v1'],
    ['https://ollama.example.com', 'https://ollama.example.com/v1'],
    ['http://localhost:11434/v1', 'http://localhost:11434/v1'],
  ])('normalises OLLAMA_HOST %s to %s', (host, baseUrl) => {
    expect(resolveAIProvider(undefined, { OLLAMA_HOST: host }).resolved?.baseUrl).toBe(baseUrl);
  });
});

describe('AIAnalyzer messages', () => {
  it('mentions the local option in the no-key tip', async () => {
    await new AIAnalyzer(undefined, {}).analyzeFailed([failed(1)]);

    expect(logSpy.mock.calls).toStrictEqual([[
      '💡 Tip: Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY for AI failure analysis (or CLAUDE_CODE_OAUTH_TOKEN to use the Claude Code CLI, or OLLAMA_HOST / OLLAMA_MODEL to use a local Ollama model with no key)',
    ]]);
  });

  it('warns when a cloud key shadows OLLAMA_HOST', () => {
    new AIAnalyzer(undefined, { OPENAI_API_KEY: 'o', OLLAMA_HOST: '127.0.0.1:11434' });

    expect(warnSpy.mock.calls).toStrictEqual([[
      "⚠️  OLLAMA_HOST/OLLAMA_MODEL is set, but AI analysis uses openai because its key takes precedence. Set ai: { provider: 'ollama' } to use the local model.",
    ]]);
  });

  it('warns once instead of printing the tip when the explicit provider is unusable', async () => {
    const analyzer = new AIAnalyzer({ provider: 'openai' }, {});
    await analyzer.analyzeFailed([failed(1)]);

    expect(analyzer.isAvailable()).toBe(false);
    expect(warnSpy.mock.calls).toStrictEqual([['⚠️  AI analysis is disabled: ai.provider is "openai" but OPENAI_API_KEY is not set.']]);
    expect(logSpy.mock.calls).toStrictEqual([]);
  });

  it('disables analysis instead of throwing on malformed options', () => {
    const analyzer = new AIAnalyzer({ baseUrl: 42 as unknown as string }, {});

    expect(analyzer.isAvailable()).toBe(false);
    expect(warnSpy.mock.calls).toStrictEqual([['⚠️  AI analysis is disabled: the ai options are invalid (host.trim is not a function).']]);
  });
});
