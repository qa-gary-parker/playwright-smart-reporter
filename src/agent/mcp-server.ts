// Low-level Server with JSON Schema tools: McpServer.registerTool needs zod, an extra runtime dependency.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getReporterVersion } from '../generators/json-exporter';
import { summarizeFailure, type FailureBundle } from './failure-bundle';

const ID_INPUT = {
  type: 'object' as const,
  properties: { id: { type: 'string', description: 'Failure id from list_failures' } },
  required: ['id'],
  additionalProperties: false,
};

export const FAILURE_TOOLS = [
  {
    name: 'list_failures',
    description:
      'List the failed Playwright tests from the latest run: id, title, file:line, project, status, first error line, and the suspected first anomaly.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  },
  {
    name: 'get_failure',
    description:
      'Get one failure by id: error message and location, code frame, call log, failing step, every attempt, failed network requests, console errors, suspected first anomaly, history, and absolute and relative source paths.',
    inputSchema: ID_INPUT,
  },
  {
    name: 'get_trace_context',
    description: 'Get the full step list, network log, and console log for one failure by id.',
    inputSchema: ID_INPUT,
  },
];

const json = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const error = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

// loadBundle runs on every call, so an agent sees fresh failures after it re-runs the tests.
export function createFailuresMcpServer(loadBundle: () => FailureBundle): Server {
  const server = new Server({ name: 'playwright-smart-reporter', version: getReporterVersion() }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: FAILURE_TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    let bundle: FailureBundle;
    try {
      bundle = loadBundle();
    } catch (err) {
      return error(err instanceof Error ? err.message : String(err));
    }
    if (params.name === 'list_failures') {
      return json({ run: bundle.run, failures: bundle.failures.map(summarizeFailure) });
    }
    if (params.name !== 'get_failure' && params.name !== 'get_trace_context') {
      return error(`Unknown tool: ${params.name}`);
    }
    const id = params.arguments?.id;
    const failure = bundle.failures.find((f) => f.id === id);
    if (!failure) return error(`No failure with id ${JSON.stringify(id)}. Call list_failures for valid ids.`);
    if (params.name === 'get_trace_context') return json({ id: failure.id, ...failure.trace });
    const { trace: _trace, ...details } = failure;
    return json(details);
  });

  return server;
}

export async function startFailuresMcpServer(loadBundle: () => FailureBundle): Promise<void> {
  await createFailuresMcpServer(loadBundle).connect(new StdioServerTransport());
}
