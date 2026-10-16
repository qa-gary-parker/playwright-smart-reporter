import * as fs from 'fs';
import * as path from 'path';

export interface SseClient {
  write(data: string): boolean;
  end(): void;
}

export interface SseHandler {
  addClient(client: SseClient): void;
  removeClient(client: SseClient): void;
  clientCount(): number;
  stop(): void;
}

function splitLines(buf: Buffer): string[] {
  return buf.toString('utf-8').split('\n').filter(l => l.trim());
}

export function buildSseHandler(jsonlPath: string): SseHandler {
  const clients: Set<SseClient> = new Set();
  // Byte offset just past the last complete line read. A line still being written is read
  // again once it ends, so it is sent once and whole; 0x0A never occurs inside a UTF-8 character.
  let lastOffset = 0;
  let watcher: fs.FSWatcher | null = null;
  let dirWatcher: fs.FSWatcher | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function readNewLines(): string[] {
    let buf: Buffer;
    try {
      const fd = fs.openSync(jsonlPath, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size < lastOffset) {
          // File was truncated/recreated (e.g. new test run) — reset
          lastOffset = 0;
        }
        buf = Buffer.alloc(size - lastOffset);
        buf = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, lastOffset));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
    const end = buf.lastIndexOf(0x0a);
    if (end === -1) return [];
    lastOffset += end + 1;
    return splitLines(buf.subarray(0, end));
  }

  function readSentLines(): string[] {
    try {
      const fd = fs.openSync(jsonlPath, 'r');
      try {
        const buf = Buffer.alloc(lastOffset);
        return splitLines(buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)));
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return [];
    }
  }

  // Reads even with no client connected, so the lines a later client is replayed are not sent again.
  function broadcastNewLines(): void {
    const lines = readNewLines();
    for (const line of lines) {
      const message = `data: ${line}\n\n`;
      for (const client of clients) {
        try {
          client.write(message);
        } catch {
          clients.delete(client);
        }
      }
    }
  }

  function startFileWatcher(): void {
    if (watcher) return;
    try {
      watcher = fs.watch(jsonlPath, (event) => {
        if (event === 'rename') {
          // File may have been replaced — restart watcher. macOS also reports some appends as a
          // rename, so the offset starts over only when the file is gone; a smaller file resets it on read.
          watcher?.close();
          watcher = null;
          if (fs.existsSync(jsonlPath)) {
            startFileWatcher();
            broadcastNewLines();
          } else {
            // File deleted, watch directory for recreation
            lastOffset = 0;
            startDirWatcher();
          }
          return;
        }
        broadcastNewLines();
      });
    } catch {
      // ignore
    }
  }

  function startDirWatcher(): void {
    if (dirWatcher) return;
    const dir = path.dirname(jsonlPath);
    const base = path.basename(jsonlPath);
    try {
      dirWatcher = fs.watch(dir, (_event, filename) => {
        if (filename === base && fs.existsSync(jsonlPath) && !watcher) {
          lastOffset = 0;
          startFileWatcher();
          if (dirWatcher) {
            dirWatcher.close();
            dirWatcher = null;
          }
          broadcastNewLines();
        }
      });
    } catch {
      // Parent dir doesn't exist yet
    }
  }

  readNewLines();

  // Watch the file if it exists, otherwise watch the parent directory for creation
  if (fs.existsSync(jsonlPath)) {
    startFileWatcher();
  } else {
    startDirWatcher();
  }

  // Polling fallback: fs.watch is unreliable on macOS for file creation in large dirs.
  // Poll every 500ms to catch new data regardless of watcher state.
  // Skip polling when no clients are connected to avoid unnecessary I/O.
  pollInterval = setInterval(() => {
    if (clients.size === 0) return;
    if (!fs.existsSync(jsonlPath)) return;
    if (!watcher) {
      lastOffset = 0;
      startFileWatcher();
    }
    broadcastNewLines();
  }, 500);

  return {
    addClient(client: SseClient) {
      // Connected clients get the newest lines first, so the replay below ends where they are.
      broadcastNewLines();
      try {
        for (const line of readSentLines()) {
          client.write(`data: ${line}\n\n`);
        }
      } catch {
        // ignore
      }
      clients.add(client);
    },
    removeClient(client: SseClient) {
      clients.delete(client);
    },
    clientCount() {
      return clients.size;
    },
    stop() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (dirWatcher) {
        dirWatcher.close();
        dirWatcher = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      clients.clear();
    },
  };
}
