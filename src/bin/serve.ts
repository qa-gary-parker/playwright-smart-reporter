#!/usr/bin/env node

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { buildSseHandler } from '../live/sse-handler';
import { browserCommand, killTree } from './serve-process';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

function printUsage(): void {
  console.log(`
Usage: playwright-smart-reporter-serve [report-path] [options]

Serves the smart report locally so the embedded trace viewer can load trace files.

Arguments:
  report-path           Path to smart-report.html or the directory containing it
                        (default: ./smart-report.html or ./example/smart-report.html)

Options:
  --port <port>         Port to serve on (default: 0 = auto-assign)
  --no-open             Don't open the browser automatically
  --live                Enable SSE endpoint for live reporting
  --live-file <path>    Path to live results JSONL (default: .smart-live-results.jsonl)
  --run-command <cmd>   Command to run tests (enables /run endpoint)
  --cwd <dir>           Working directory for --run-command (default: current directory)
  -h, --help            Show this help message

Examples:
  playwright-smart-reporter-serve
  playwright-smart-reporter-serve ./example/smart-report.html
  playwright-smart-reporter-serve ./example --port 3000
  playwright-smart-reporter-serve --live --run-command "npx playwright test" --cwd ./my-project
`);
}

interface ServeOptions {
  reportPath: string;
  port: number;
  open: boolean;
  live: boolean;
  liveFile: string;
  runCommand: string;
  runCwd: string;
  running: boolean;
  lastExitCode: number | null;
}

function parseArgs(argv: string[]): ServeOptions {
  const args = argv.slice(2);

  if (args.includes('-h') || args.includes('--help')) {
    printUsage();
    process.exit(0);
  }

  const options: ServeOptions = {
    reportPath: '',
    port: 0,
    open: true,
    live: false,
    liveFile: '.smart-live-results.jsonl',
    runCommand: '',
    runCwd: process.cwd(),
    running: false,
    lastExitCode: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port') {
      const value = args[++i] ?? '';
      options.port = Number(value);
      if (!/^\d+$/.test(value) || options.port > 65535) {
        console.error(`Error: --port must be a whole number from 0 to 65535 (got "${value}").`);
        process.exit(1);
      }
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--live') {
      options.live = true;
    } else if (arg === '--live-file') {
      options.liveFile = args[++i] || '.smart-live-results.jsonl';
    } else if (arg === '--run-command') {
      options.runCommand = args[++i] || '';
    } else if (arg === '--cwd') {
      options.runCwd = path.resolve(process.cwd(), args[++i] || '.');
    } else if (!arg.startsWith('-') && !options.reportPath) {
      options.reportPath = arg;
    }
  }

  return options;
}

function resolveReport(reportPath: string): { dir: string; file: string } {
  // If a path was provided, use it
  if (reportPath) {
    const resolved = path.resolve(process.cwd(), reportPath);
    if (fs.existsSync(resolved)) {
      const stat = fs.statSync(resolved);
      if (stat.isFile()) {
        return { dir: path.dirname(resolved), file: path.basename(resolved) };
      }
      if (stat.isDirectory()) {
        // Look for smart-report.html in the directory
        const htmlFile = fs.readdirSync(resolved).find(f => f.endsWith('.html') && f.includes('report'));
        if (htmlFile) {
          return { dir: resolved, file: htmlFile };
        }
        // Fallback to any HTML file
        const anyHtml = fs.readdirSync(resolved).find(f => f.endsWith('.html'));
        if (anyHtml) {
          return { dir: resolved, file: anyHtml };
        }
      }
    }
    console.error(`Error: Cannot find report at ${resolved}`);
    process.exit(1);
  }

  // Auto-detect: check common locations
  const candidates = [
    'smart-report.html',
    'example/smart-report.html',
  ];

  for (const candidate of candidates) {
    const resolved = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) {
      return { dir: path.dirname(resolved), file: path.basename(resolved) };
    }
  }

  console.error('Error: No report file found. Provide a path to your smart-report.html.');
  printUsage();
  process.exit(1);
}

function openBrowser(url: string): void {
  const [command, args] = browserCommand(process.platform, url);
  const hint = () => console.log(`  Open manually: ${url}`);
  const opener = spawn(command, args, { stdio: 'ignore' });
  // A command that cannot start emits 'error' and no 'exit'.
  opener.on('error', hint);
  opener.on('exit', (code) => {
    if (code !== 0) hint();
  });
}

// Quotes one argument so the shell passes it through literally. Windows cmd cannot quote every
// character safely, so there the characters it would act on are refused instead.
function shellQuote(arg: string): string | undefined {
  if (/[\0\r\n]/.test(arg)) return undefined;
  if (process.platform === 'win32') return /["%!^]/.test(arg) ? undefined : `"${arg}"`;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build filtered Playwright command from base command + filter payload. Undefined when a value cannot be passed safely.
 */
function buildFilteredCommand(
  baseCommand: string,
  filters: { files?: unknown; grep?: unknown }
): string | undefined {
  const parts = [baseCommand];
  const files = filters.files === undefined ? [] : filters.files;
  if (!Array.isArray(files) || !files.every((f) => typeof f === 'string')) return undefined;
  if (filters.grep !== undefined && typeof filters.grep !== 'string') return undefined;

  for (const file of files) {
    if (!file) continue;
    // Prefix with ./ to prevent substring matching (e.g. "demo.spec.ts" matching "feature-demo.spec.ts")
    const quoted = shellQuote(file.startsWith('./') || file.startsWith('/') ? file : `./${file}`);
    if (!quoted) return undefined;
    parts.push(quoted);
  }

  if (filters.grep) {
    const quoted = shellQuote(filters.grep);
    if (!quoted) return undefined;
    parts.push('--grep', quoted);
  }

  return parts.join(' ');
}

// Only the report trace and media files are served from the working directory, never project files such as .env.
const CWD_FALLBACK_EXTENSIONS = new Set(['.zip', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.webm', '.mp4']);

function main(): void {
  const options = parseArgs(process.argv);
  const { dir, file } = resolveReport(options.reportPath);

  let sseHandler: ReturnType<typeof buildSseHandler> | null = null;
  if (options.live) {
    // Resolve live file relative to runCwd (where the reporter writes) when available
    const liveBase = options.runCommand ? options.runCwd : process.cwd();
    const liveFilePath = path.resolve(liveBase, options.liveFile);
    sseHandler = buildSseHandler(liveFilePath);
  }

  let runChild: ChildProcess | null = null;
  // taskkill ends the run with exit code 1 and no signal, so a cancel is recorded here.
  let cancelled = false;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (runChild) killTree(runChild);
      process.exit(128 + os.constants.signals[signal]);
    });
  }

  function isLocalhostRequest(req: http.IncomingMessage): boolean {
    const remoteAddr = req.socket.remoteAddress || '';
    return remoteAddr.includes('127.0.0.1') || remoteAddr.includes('::1');
  }

  // The report is only ever opened as http://localhost:<port> or http://127.0.0.1:<port>.
  let localOrigins = new Set<string>();
  const isLocalHost = (req: http.IncomingMessage) => localOrigins.has(`http://${req.headers.host ?? ''}`);
  // Browsers send Origin with cross-site requests; a request without one comes from a local tool such as curl.
  const isOwnOrigin = (req: http.IncomingMessage) => !req.headers.origin || localOrigins.has(req.headers.origin);

  function setRunCors(res: http.ServerResponse, req: http.IncomingMessage): void {
    const origin = req.headers.origin || '';
    if (localOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
  }

  function refuse(res: http.ServerResponse, status: number, error: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error }));
  }

  const server = http.createServer((req, res) => {
    // DNS rebinding: a page on another domain can resolve that domain to 127.0.0.1, so check the Host it asked for.
    if (!isLocalHost(req)) {
      refuse(res, 403, 'Forbidden host');
      return;
    }

    // CORS preflight for /run
    if (req.url === '/run' && req.method === 'OPTIONS') {
      setRunCors(res, req);
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for live reporting
    if (sseHandler && req.url === '/sse') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':ok\n\n');
      const client = { write: (data: string) => res.write(data), end: () => res.end() };
      sseHandler.addClient(client);
      req.on('close', () => { sseHandler!.removeClient(client); });
      return;
    }

    // Cancel test run endpoint
    if (req.url === '/run' && req.method === 'DELETE' && options.runCommand) {
      setRunCors(res, req);
      if (!isOwnOrigin(req)) {
        refuse(res, 403, 'Runs can only be controlled from the report');
        return;
      }
      if (!isLocalhostRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only localhost requests allowed' }));
        return;
      }
      if (!options.running || !runChild) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No test run in progress' }));
        return;
      }
      cancelled = true;
      killTree(runChild);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cancelled' }));
      return;
    }

    // Run tests endpoint (only when --run-command is configured)
    if (req.url === '/run' && req.method === 'POST' && options.runCommand) {
      setRunCors(res, req);
      if (!isOwnOrigin(req)) {
        refuse(res, 403, 'Runs can only be started from the report');
        return;
      }
      // JSON makes a cross-site browser request send a CORS preflight first, which only the report's origin passes.
      if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) {
        refuse(res, 415, 'Send the run filters as application/json');
        return;
      }
      if (!isLocalhostRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only localhost requests allowed' }));
        return;
      }

      if (options.running) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'A test run is already in progress' }));
        return;
      }

      // Read POST body for filter parameters
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        let filters: { files?: unknown; grep?: unknown } = {};
        try {
          if (body) filters = JSON.parse(body) ?? {};
        } catch {
          // ignore malformed body — run unfiltered
        }

        const fullCommand = buildFilteredCommand(options.runCommand, typeof filters === 'object' ? filters : {});
        if (!fullCommand) {
          refuse(res, 400, 'A filter value cannot be passed to the run command safely');
          return;
        }

        // Truncate live JSONL so SSE clients don't replay old events
        const liveFilePath = path.resolve(options.runCwd, options.liveFile);
        try { fs.writeFileSync(liveFilePath, ''); } catch { /* ok if it doesn't exist yet */ }

        options.running = true;
        options.lastExitCode = null;
        cancelled = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', command: fullCommand }));

        // On POSIX the run leads its own process group, which killTree signals. Windows has no
        // process groups, so killTree uses taskkill there.
        runChild = spawn(fullCommand, {
          cwd: options.runCwd,
          shell: true,
          detached: process.platform !== 'win32',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        runChild.on('error', (err) => {
          options.running = false;
          options.lastExitCode = -1;
          runChild = null;
          console.error(`\n  Could not start the test run: ${err.message}`);
        });
        runChild.stdout?.on('data', (data: Buffer) => process.stdout.write(data));
        runChild.stderr?.on('data', (data: Buffer) => process.stderr.write(data));

        runChild.on('close', (code, signal) => {
          options.running = false;
          runChild = null;
          if (signal || cancelled) {
            options.lastExitCode = -1;
            console.log('\n  Test run cancelled');
          } else if (code && code !== 0) {
            options.lastExitCode = code;
            console.log(`\n  Test run finished with exit code ${code}`);
          } else {
            options.lastExitCode = 0;
            console.log('\n  Test run finished successfully');
          }
        });
      });
      return;
    }

    if (req.url === '/run' && req.method === 'GET' && options.runCommand) {
      setRunCors(res, req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: options.running, command: options.runCommand, lastExitCode: options.lastExitCode }));
      return;
    }

    let urlPath: string;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

    // Default to report file
    const requestedFile = safePath === '/' ? file : safePath.replace(/^\//, '');
    const filePath = path.join(dir, requestedFile);

    // Security: ensure we don't serve files outside the report directory
    const resolvedFile = path.resolve(filePath);
    const resolvedDir = path.resolve(dir);
    if (resolvedFile !== resolvedDir && !resolvedFile.startsWith(resolvedDir + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Check for test-results directory (traces are often stored there, relative to CWD)
    if (!fs.existsSync(filePath)) {
      // Try resolving from CWD (test-results/ is typically at project root)
      const cwdPath = path.join(process.cwd(), requestedFile);
      const resolvedCwd = path.resolve(cwdPath);
      const resolvedCwdDir = path.resolve(process.cwd());
      if (!resolvedCwd.startsWith(resolvedCwdDir + path.sep)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (CWD_FALLBACK_EXTENSIONS.has(path.extname(cwdPath).toLowerCase()) && fs.existsSync(cwdPath) && fs.statSync(cwdPath).isFile()) {
        serveFile(cwdPath, res, req);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    serveFile(filePath, res, req);
  });

  function serveFile(filePath: string, res: http.ServerResponse, req: http.IncomingMessage): void {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const origin = req.headers.origin || '';
    const corsHeader = localOrigins.has(origin) ? origin : '';

    // When live mode is enabled and this is the report HTML, inject SSE URL and run capability
    if (options.live && ext === '.html') {
      let body = fs.readFileSync(filePath, 'utf-8');
      // The 2.x live page and the v3 report both declare where SSE events come from.
      if (body.includes('data-live-mode') || body.includes('name="smart-live-sse"')) {
        body = body.replace(/__SSE_URL__/g, '/sse');
      }
      if (options.runCommand) {
        body = body.replace(/__RUN_ENABLED__/g, 'true');
      }
      const buf = Buffer.from(body, 'utf-8');
      const headers: Record<string, string | number> = {
        'Content-Type': contentType,
        'Content-Length': buf.byteLength,
        'Cache-Control': 'no-cache',
      };
      if (corsHeader) {
        headers['Access-Control-Allow-Origin'] = corsHeader;
      }
      res.writeHead(200, headers);
      res.end(buf);
      return;
    }

    const headers: Record<string, string | number> = {
      'Content-Type': contentType,
      'Content-Length': fs.statSync(filePath).size,
      'Cache-Control': 'no-cache',
    };
    if (corsHeader) {
      headers['Access-Control-Allow-Origin'] = corsHeader;
    }

    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }

  server.listen(options.port, '127.0.0.1', () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : options.port;
    const url = `http://localhost:${port}`;
    // Encoded, so file name characters such as & and | do not reach Windows cmd when start opens the URL.
    const reportUrl = `${url}/${encodeURIComponent(file)}`;
    localOrigins = new Set([url, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);

    console.log(`\n  Serving smart report from: ${dir}`);
    console.log(`  Report file: ${file}`);
    console.log(`\n  Local:   ${url}`);
    console.log(`  Report:  ${reportUrl}`);
    console.log(`\n  Trace viewer is fully functional over HTTP.`);
    console.log(`  Press Ctrl+C to stop.\n`);

    if (options.open) {
      openBrowser(reportUrl);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: Port ${options.port} is already in use. Try --port <other-port>`);
    } else {
      console.error('Server error:', err.message);
    }
    process.exit(1);
  });
}

main();
