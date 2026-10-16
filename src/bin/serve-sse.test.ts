import { afterEach, describe, it, expect } from 'vitest';
import { buildSseHandler, type SseClient, type SseHandler } from '../live/sse-handler';
import { spawn } from 'child_process';
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

describe('SSE handler: line integrity', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Longer than the handler's 500 ms poll, so every event still to come has been sent.
  const settle = () => sleep(700);
  let handler: SseHandler | undefined;
  const files: string[] = [];
  afterEach(() => {
    handler?.stop();
    handler = undefined;
    for (const f of files.splice(0)) fs.rmSync(f, { force: true });
  });

  function tmp(name: string): string {
    const file = path.join(os.tmpdir(), `${process.pid}-${Date.now()}-${name}`);
    files.push(file);
    return file;
  }
  function start(name: string): string {
    const file = tmp(`${name}.jsonl`);
    fs.writeFileSync(file, '');
    handler = buildSseHandler(file);
    return file;
  }
  function listen(): () => string[] {
    const sent: string[] = [];
    handler!.addClient({ write: (data: string) => { sent.push(data); return true; }, end: () => {} });
    return () => sent.filter((s) => s.startsWith('data:'));
  }

  it('sends a line written in two parts once, when it is whole', async () => {
    const file = start('sse-half');
    const events = listen();

    fs.appendFileSync(file, '{"event":"test","testId":"t1"');
    await settle();
    expect(events()).toEqual([]);

    fs.appendFileSync(file, ',"status":"passed"}\n');
    await settle();
    expect(events()).toEqual(['data: {"event":"test","testId":"t1","status":"passed"}\n\n']);
  });

  it('sends a character split across two writes as that character', async () => {
    const file = start('sse-utf8');
    const events = listen();
    const line = Buffer.from('{"event":"test","title":"café"}\n');
    const cut = line.indexOf(0xa9); // between the two bytes of é

    fs.appendFileSync(file, line.subarray(0, cut));
    await settle();
    fs.appendFileSync(file, line.subarray(cut));
    await settle();
    expect(events()).toEqual(['data: {"event":"test","title":"café"}\n\n']);
  });

  it('sends a client that connects after lines were written each line once', async () => {
    const file = start('sse-late');
    fs.appendFileSync(file, '{"event":"start","totalExpected":1}\n');
    fs.appendFileSync(file, '{"event":"test","testId":"t1","status":"passed"}\n');
    await sleep(100);

    const events = listen();
    await settle();
    expect(events()).toEqual([
      'data: {"event":"start","totalExpected":1}\n\n',
      'data: {"event":"test","testId":"t1","status":"passed"}\n\n',
    ]);
  });

  // The reporter writes from another process than serve. On macOS such a burst also raises
  // 'rename' events for a file that still exists.
  it('sends each line of a fast burst from another process once, in order', async () => {
    const file = start('sse-burst');
    const events = listen();
    const count = 10000;
    const line = (i: number) => JSON.stringify({ event: 'test', testId: `t${i}`, pad: 'x'.repeat(200) });
    const writer = tmp('sse-burst-writer.cjs');
    fs.writeFileSync(writer, "const fs = require('fs'); const fd = fs.openSync(process.argv[2], 'a'); for (let i = 0; i < Number(process.argv[3]); i++) fs.writeSync(fd, JSON.stringify({ event: 'test', testId: 't' + i, pad: 'x'.repeat(200) }) + '\\n'); fs.closeSync(fd);");

    const child = spawn(process.execPath, [writer, file, String(count)], { stdio: 'inherit' });
    expect(await new Promise((resolve) => child.on('exit', resolve))).toBe(0);
    await expect.poll(() => events().length, { timeout: 10_000 }).toBeGreaterThanOrEqual(count);
    await settle();
    expect(events()).toEqual(Array.from({ length: count }, (_, i) => `data: ${line(i)}\n\n`));
  }, 30_000);
});
