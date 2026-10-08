#!/usr/bin/env node

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec, spawn, type ChildProcess } from 'child_process';
import { buildSseHandler } from '../live/sse-handler';

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
      options.port = parseInt(args[++i] || '0', 10);
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
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';

  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      console.log(`  Open manually: ${url}`);
    }
  });
}

/**
 * Sanitize a string for safe shell interpolation — strip dangerous metacharacters.
 */
function sanitizeShellArg(input: string): string {
  return input.replace(/[;&`$(){}!\\\n\r]/g, '');
}

/**
 * Build filtered Playwright command from base command + filter payload.
 */
function buildFilteredCommand(
  baseCommand: string,
  filters: { files?: string[]; grep?: string }
): string {
  const parts = [baseCommand];

  if (filters.files && Array.isArray(filters.files) && filters.files.length > 0) {
    for (const file of filters.files) {
      const safe = sanitizeShellArg(file);
      if (!safe) continue;
      // Prefix with ./ to prevent substring matching (e.g. "demo.spec.ts" matching "feature-demo.spec.ts")
      const anchored = safe.startsWith('./') || safe.startsWith('/') ? safe : `./${safe}`;
      parts.push(`"${anchored}"`);
    }
  }

  if (filters.grep && typeof filters.grep === 'string') {
    const safe = sanitizeShellArg(filters.grep);
    if (safe) parts.push(`--grep "${safe}"`);
  }

  return parts.join(' ');
}

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

  function isLocalhostRequest(req: http.IncomingMessage): boolean {
    const remoteAddr = req.socket.remoteAddress || '';
    return remoteAddr.includes('127.0.0.1') || remoteAddr.includes('::1');
  }

  function setRunCors(res: http.ServerResponse, req: http.IncomingMessage): void {
    const origin = req.headers.origin || '';
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    }
  }

  const server = http.createServer((req, res) => {
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
        'Access-Control-Allow-Origin': '*',
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
      // Kill entire process group (shell + child processes)
      try {
        process.kill(-runChild.pid!, 'SIGTERM');
      } catch {
        runChild.kill('SIGTERM');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cancelled' }));
      return;
    }

    // Run tests endpoint (only when --run-command is configured)
    if (req.url === '/run' && req.method === 'POST' && options.runCommand) {
      setRunCors(res, req);
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
        let filters: { files?: string[]; grep?: string } = {};
        try {
          if (body) filters = JSON.parse(body);
        } catch {
          // ignore malformed body — run unfiltered
        }

        const fullCommand = buildFilteredCommand(options.runCommand, filters);

        // Truncate live JSONL so SSE clients don't replay old events
        const liveFilePath = path.resolve(options.runCwd, options.liveFile);
        try { fs.writeFileSync(liveFilePath, ''); } catch { /* ok if it doesn't exist yet */ }

        options.running = true;
        options.lastExitCode = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'started', command: fullCommand }));

        runChild = spawn(fullCommand, {
          cwd: options.runCwd,
          shell: true,
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        runChild.stdout?.on('data', (data: Buffer) => process.stdout.write(data));
        runChild.stderr?.on('data', (data: Buffer) => process.stderr.write(data));

        runChild.on('close', (code, signal) => {
          options.running = false;
          runChild = null;
          if (signal) {
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

    const urlPath = decodeURIComponent(req.url || '/');
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');

    // Default to report file
    const requestedFile = safePath === '/' ? file : safePath.replace(/^\//, '');
    const filePath = path.join(dir, requestedFile);

    // Security: ensure we don't serve files outside the report directory
    const resolvedFile = path.resolve(filePath);
    const resolvedDir = path.resolve(dir);
    if (!resolvedFile.startsWith(resolvedDir)) {
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
      if (!resolvedCwd.startsWith(resolvedCwdDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      if (fs.existsSync(cwdPath) && fs.statSync(cwdPath).isFile()) {
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
    const corsHeader = /^https?:\/\/localhost(:\d+)?$/.test(origin) ? origin : '';

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

    console.log(`\n  Serving smart report from: ${dir}`);
    console.log(`  Report file: ${file}`);
    console.log(`\n  Local:   ${url}`);
    console.log(`  Report:  ${url}/${file}`);
    console.log(`\n  Trace viewer is fully functional over HTTP.`);
    console.log(`  Press Ctrl+C to stop.\n`);

    if (options.open) {
      openBrowser(`${url}/${file}`);
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
