### Local models (Ollama and OpenAI-compatible endpoints)

Run AI failure analysis on a local model. No API key is needed, and no failure data leaves your network.

**Ollama**

```bash
ollama pull llama3.2
export OLLAMA_HOST=127.0.0.1:11434   # optional, this is the default
export OLLAMA_MODEL=llama3.2         # optional, this is the default
```

Setting `OLLAMA_HOST` or `OLLAMA_MODEL` turns on local analysis when no cloud key is set. To use Ollama even when a cloud key is set, choose it in the config:

```ts
reporter: [
  ['playwright-smart-reporter', {
    ai: {
      provider: 'ollama',
      model: 'qwen2.5:7b',
      baseUrl: 'http://gpu-box:11434', // default: OLLAMA_HOST, then http://127.0.0.1:11434
      timeoutMs: 120_000,              // slow CPU-only machine
    },
  }],
],
```

**Other OpenAI-compatible servers** (LM Studio, vLLM, LiteLLM, a company gateway)

```ts
ai: {
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1', // requests go to <baseUrl>/chat/completions
  model: 'qwen2.5-7b-instruct',
},
```

- `openai-compatible` needs both `baseUrl` and `model`.
- If `OPENAI_API_KEY` is set, the reporter sends it to `baseUrl` as a Bearer token. Otherwise it sends no `Authorization` header.
- Ollama never gets a key.

**Options (`ai`)**

| Option | Default | Meaning |
|---|---|---|
| `provider` | detected from env | `'anthropic'`, `'openai'`, `'gemini'`, `'ollama'` or `'openai-compatible'`. When set, it wins over every env key and never falls back to another provider. |
| `baseUrl` | per provider | Endpoint for `openai`, `ollama` and `openai-compatible`. Anthropic, Gemini and the Claude CLI ignore it. |
| `model` | per provider | Replaces the model of whichever provider is selected. Defaults: `claude-haiku-4-5`, `gpt-4o-mini`, `gemini-2.5-flash`. For Ollama: `OLLAMA_MODEL`, then `llama3.2`. |
| `timeoutMs` | `60000` | Time limit for one AI call, for every provider. |
| `maxTotalMs` | `300000` | Time limit for all AI analysis in one run. |

**Provider order when `ai.provider` is not set** (the first match wins)

1. `ANTHROPIC_API_KEY`
2. `OPENAI_API_KEY`
3. `GEMINI_API_KEY`
4. `CLAUDE_CODE_OAUTH_TOKEN`, using the Claude Code CLI. A subscription OAuth token (`sk-ant-oat…`) found in `ANTHROPIC_API_KEY` is also sent this way.
5. `OLLAMA_HOST` or `OLLAMA_MODEL`

A cloud key wins over `OLLAMA_*`. When that happens, the reporter prints a warning. Set `ai: { provider: 'ollama' }` to use the local model. Each run prints the provider and model it uses, for example `Analyzing 3 failure(s) with AI (ollama, llama3.2)...`. The report data records the same values in `ai.provider` and `ai.model`.

**Limits and failure behaviour**

- AI never fails a test run. If the model is unreachable, does not respond within `timeoutMs`, or uses up `maxTotalMs`, the reporter prints one warning. It skips the rest of the analysis and still writes the report. Suggestions made before the stop stay in the report.
- Failures go to the model three at a time. A slow local model may run out of `maxTotalMs` on a large failure set. Raise `timeoutMs` and `maxTotalMs` for CPU-only machines.
- An HTTP 404 from an OpenAI-compatible server usually means the model does not exist there. For Ollama, run `ollama pull <model>`.
- `OLLAMA_HOST` accepts the same forms as Ollama: `0.0.0.0`, `host:port`, `http://host:port`, or a URL that ends in `/v1`.
