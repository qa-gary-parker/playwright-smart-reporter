import { describe, it, expect } from 'vitest';
import { buildSseHandler, type SseClient } from '../live/sse-handler';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildSseHandler', () => {
  it('sends new JSONL lines as SSE events', async () => {
    const tmpFile = path.join(os.tmpdir(), `sse-test-${Date.now()}.jsonl`);
    const sent: string[] = [];
    const mockClient: SseClient = {
      write: (data: string) => { sent.push(data); return true; },
      end: () => {},
    };

    fs.writeFileSync(tmpFile, '{"event":"start","totalExpected":2}\n');

    const handler = buildSseHandler(tmpFile);
    handler.addClient(mockClient);

    await new Promise(r => setTimeout(r, 100));

    fs.appendFileSync(tmpFile, '{"event":"test","testId":"t1","status":"passed"}\n');
    await new Promise(r => setTimeout(r, 300));

    handler.stop();
    fs.unlinkSync(tmpFile);

    const eventData = sent.filter(s => s.startsWith('data:'));
    expect(eventData.length).toBeGreaterThanOrEqual(1);
  });

  it('removes clients cleanly', () => {
    const tmpFile = path.join(os.tmpdir(), `sse-test2-${Date.now()}.jsonl`);
    fs.writeFileSync(tmpFile, '');

    const handler = buildSseHandler(tmpFile);
    const mockClient: SseClient = { write: () => true, end: () => {} };
    handler.addClient(mockClient);
    expect(handler.clientCount()).toBe(1);
    handler.removeClient(mockClient);
    expect(handler.clientCount()).toBe(0);

    handler.stop();
    fs.unlinkSync(tmpFile);
  });
});
