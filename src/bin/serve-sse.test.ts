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

    expect(sent.filter(s => s.startsWith('data:'))).toEqual([
      'data: {"event":"start","totalExpected":2}\n\n',
      'data: {"event":"test","testId":"t1","status":"passed"}\n\n',
    ]);
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

describe('SSE handler: file truncation and recreation', () => {
  it('detects file truncation and re-sends from start', async () => {
    const tmpFile = path.join(os.tmpdir(), `sse-trunc-${Date.now()}.jsonl`);
    const sent: string[] = [];
    const mockClient: SseClient = {
      write: (data: string) => { sent.push(data); return true; },
      end: () => {},
    };

    // Initial file with some data
    fs.writeFileSync(tmpFile, '{"event":"start","totalExpected":5}\n{"event":"test","testId":"t1","status":"passed"}\n');
    const handler = buildSseHandler(tmpFile);
    handler.addClient(mockClient);

    // Client should receive existing lines on connect
    await new Promise(r => setTimeout(r, 100));
    const initialEvents = sent.filter(s => s.startsWith('data:'));
    expect(initialEvents.length).toBe(2);

    // Truncate and rewrite (simulates new test run)
    fs.writeFileSync(tmpFile, '{"event":"start","totalExpected":3}\n');
    await new Promise(r => setTimeout(r, 700));

    const allEvents = sent.filter(s => s.startsWith('data:'));
    // Should have the 2 initial + at least 1 new event from the truncated file
    expect(allEvents.length).toBeGreaterThanOrEqual(3);

    handler.stop();
    fs.unlinkSync(tmpFile);
  });

  it('picks up file created after handler starts', async () => {
    const tmpFile = path.join(os.tmpdir(), `sse-create-${Date.now()}.jsonl`);
    const sent: string[] = [];
    const mockClient: SseClient = {
      write: (data: string) => { sent.push(data); return true; },
      end: () => {},
    };

    // Start handler before file exists
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    const handler = buildSseHandler(tmpFile);
    handler.addClient(mockClient);

    await new Promise(r => setTimeout(r, 100));
    expect(sent.filter(s => s.startsWith('data:')).length).toBe(0);

    // Create the file
    fs.writeFileSync(tmpFile, '{"event":"start","totalExpected":2}\n');
    await new Promise(r => setTimeout(r, 700));

    const events = sent.filter(s => s.startsWith('data:'));
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toContain('"start"');

    handler.stop();
    fs.unlinkSync(tmpFile);
  });
});
