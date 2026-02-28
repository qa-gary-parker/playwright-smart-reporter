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

export function buildSseHandler(jsonlPath: string): SseHandler {
  const clients: Set<SseClient> = new Set();
  let lastOffset = 0;
  let watcher: fs.FSWatcher | null = null;
  let dirWatcher: fs.FSWatcher | null = null;

  if (fs.existsSync(jsonlPath)) {
    lastOffset = fs.statSync(jsonlPath).size;
  }

  function broadcastNewLines(): void {
    if (clients.size === 0) return;

    let content: string;
    try {
      const fd = fs.openSync(jsonlPath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size <= lastOffset) {
        fs.closeSync(fd);
        return;
      }
      const buf = Buffer.alloc(stat.size - lastOffset);
      fs.readSync(fd, buf, 0, buf.length, lastOffset);
      fs.closeSync(fd);
      lastOffset = stat.size;
      content = buf.toString('utf-8');
    } catch {
      return;
    }

    const lines = content.split('\n').filter(l => l.trim());
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
      watcher = fs.watch(jsonlPath, () => {
        broadcastNewLines();
      });
    } catch {
      // ignore
    }
  }

  // Watch the file if it exists, otherwise watch the parent directory for creation
  if (fs.existsSync(jsonlPath)) {
    startFileWatcher();
  } else {
    const dir = path.dirname(jsonlPath);
    const base = path.basename(jsonlPath);
    try {
      dirWatcher = fs.watch(dir, (_event, filename) => {
        if (filename === base && fs.existsSync(jsonlPath) && !watcher) {
          startFileWatcher();
          if (dirWatcher) {
            dirWatcher.close();
            dirWatcher = null;
          }
        }
      });
    } catch {
      // Parent dir doesn't exist yet — rare edge case
    }
  }

  return {
    addClient(client: SseClient) {
      clients.add(client);
      if (fs.existsSync(jsonlPath)) {
        try {
          const content = fs.readFileSync(jsonlPath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          for (const line of lines) {
            client.write(`data: ${line}\n\n`);
          }
        } catch {
          // ignore
        }
      }
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
      clients.clear();
    },
  };
}
