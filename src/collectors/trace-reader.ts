import * as fs from 'fs';
import AdmZip from 'adm-zip';

/** Anchor from a context's `context-options` event: the same instant on the wall clock and the trace's monotonic clock. */
export interface TraceClock {
  wallTime: number;
  monotonicTime: number;
}

export interface TraceConsoleEvent {
  time: number;   // wall-clock epoch ms
  level: string;
  text: string;
}

export interface TraceContext {
  resources: any[];               // resource-snapshot payloads from <n>-trace.network, in file order
  console: TraceConsoleEvent[];
  clock?: TraceClock;
}

export interface TraceContents {
  contexts: TraceContext[];
}

// A test zip holds one <n>-trace.{trace,network} pair per browser context, numbered from 0.
const MAX_CONTEXTS = 32;

/**
 * Opens a Playwright trace zip once. Without `timeline` it reads only 0-trace.network,
 * which is all the network log has ever used. With `timeline` it reads every context's
 * network and its console messages and uncaught page errors.
 */
export function readTrace(tracePath: string, options: { timeline?: boolean } = {}): TraceContents {
  if (!tracePath || !fs.existsSync(tracePath)) return { contexts: [] };

  const zip = new AdmZip(tracePath);
  const contexts: TraceContext[] = [];
  const max = options.timeline ? MAX_CONTEXTS : 1;
  for (let n = 0; n < max; n++) {
    const network = zip.getEntry(`${n}-trace.network`);
    const events = options.timeline ? zip.getEntry(`${n}-trace.trace`) : null;
    if (!network && !events) break;
    const context: TraceContext = {
      resources: network ? parseResources(network.getData().toString('utf8')) : [],
      console: [],
    };
    if (events) readEvents(events.getData().toString('utf8'), context);
    contexts.push(context);
  }
  return { contexts };
}

/** Request start as wall-clock epoch ms, preferring the monotonic stamp so it shares a clock with console events. */
export function resourceStartTime(snapshot: any, clock: TraceClock | undefined): number | undefined {
  if (clock && typeof snapshot?._monotonicTime === 'number') return toWallTime(clock, snapshot._monotonicTime);
  const parsed = Date.parse(snapshot?.startedDateTime);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toWallTime(clock: TraceClock, monotonic: number): number {
  return clock.wallTime + (monotonic - clock.monotonicTime);
}

function parseResources(text: string): any[] {
  const resources: any[] = [];
  for (const line of text.trim().split('\n')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'resource-snapshot' && parsed.snapshot) resources.push(parsed.snapshot);
    } catch {
      // Skip malformed lines
    }
  }
  return resources;
}

// Trace files are mostly DOM snapshots; only lines carrying these markers are worth parsing.
const MARKERS = ['"type":"context-options"', '"type":"console"', '"pageError"'];

function readEvents(text: string, context: TraceContext): void {
  const pending: Array<{ monotonic: number; level: string; text: string }> = [];
  for (const line of text.split('\n')) {
    if (!MARKERS.some((m) => line.includes(m))) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'context-options') {
      // v6 traces carry no monotonicTime; their events cannot be placed on the wall clock.
      if (!context.clock && typeof event.wallTime === 'number' && typeof event.monotonicTime === 'number') {
        context.clock = { wallTime: event.wallTime, monotonicTime: event.monotonicTime };
      }
    } else if (event.type === 'console' && typeof event.time === 'number') {
      pending.push({ monotonic: event.time, level: String(event.messageType ?? 'log'), text: String(event.text ?? '') });
    } else if (event.type === 'event' && event.method === 'pageError' && typeof event.time === 'number') {
      pending.push({ monotonic: event.time, level: 'error', text: `Uncaught ${describeError(event.params?.error)}` });
    }
  }
  const clock = context.clock;
  if (!clock) return;
  context.console = pending.map((e) => ({ time: toWallTime(clock, e.monotonic), level: e.level, text: e.text }));
}

function describeError(serialized: any): string {
  const error = serialized?.error;
  if (error) return error.name ? `${error.name}: ${error.message ?? ''}` : String(error.message ?? '');
  return String(serialized?.value ?? 'unknown error');
}
