#!/usr/bin/env node

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

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
  -h, --help            Show this help message

Examples:
  playwright-smart-reporter-serve
  playwright-smart-reporter-serve ./example/smart-report.html
  playwright-smart-reporter-serve ./example --port 3000
`);
}

interface ServeOptions {
  reportPath: string;
  port: number;
  open: boolean;
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
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port') {
      options.port = parseInt(args[++i] || '0', 10);
    } else if (arg === '--no-open') {
      options.open = false;
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

function main(): void {
  const options = parseArgs(process.argv);
  const { dir, file } = resolveReport(options.reportPath);

  const server = http.createServer((req, res) => {
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
      if (fs.existsSync(cwdPath) && fs.statSync(cwdPath).isFile()) {
        serveFile(cwdPath, res);
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

    serveFile(filePath, res);
  });

  function serveFile(filePath: string, res: http.ServerResponse): void {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    fs.createReadStream(filePath).pipe(res);
  }

  server.listen(options.port, () => {
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
