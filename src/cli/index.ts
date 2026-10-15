#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport, defaultProjectsDir } from '../core/report.js';

const HELP = `context-desk — see what your AI coding sessions actually looked like.

Usage: npx context-desk [options]

  --dir <path>     Claude Code projects folder (default: ${defaultProjectsDir()})
  --port <n>       Local port (default: 4777)
  --json <file>    Write the report as JSON and exit, no UI
  --no-open        Don't open the browser
  -h, --help       Show this help

Everything runs on this machine. Nothing is uploaded.`;

interface Options {
  dir: string;
  port: number;
  json: string | null;
  open: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { dir: defaultProjectsDir(), port: 4777, json: null, open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) fail(`${arg} needs a value`);
      return v;
    };
    if (arg === '-h' || arg === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (arg === '--dir') opts.dir = next();
    else if (arg === '--port') opts.port = Number(next());
    else if (arg === '--json') opts.json = next();
    else if (arg === '--no-open') opts.open = false;
    else fail(`Unknown option: ${arg}\n\n${HELP}`);
  }
  if (!Number.isInteger(opts.port) || opts.port <= 0 || opts.port > 65535) fail('--port must be 1-65535');
  return opts;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch {
    // the URL is printed anyway
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  process.stdout.write(`Reading ${opts.dir}\n`);
  const report = await buildReport(opts.dir, (done, total) => {
    if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${total} sessions`);
  });
  if (process.stdout.isTTY) process.stdout.write('\n');
  const { totals } = report;
  console.log(`  ${totals.projects} projects · ${totals.sessions} sessions · ${totals.signals} steering moments`);

  if (opts.json) {
    writeFileSync(opts.json, JSON.stringify(report, null, 2));
    console.log(`Report written to ${opts.json}`);
    return;
  }

  const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui');
  if (!existsSync(join(uiDir, 'index.html'))) fail(`UI build not found at ${uiDir}. Run npm run build.`);
  const payload = JSON.stringify(report);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/report') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(payload);
      return;
    }
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.)+/, '');
    let file = join(uiDir, rel);
    if (!file.startsWith(uiDir) || !existsSync(file) || extname(file) === '') file = join(uiDir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') fail(`Port ${opts.port} is busy. Try --port ${opts.port + 1}`);
    fail(err.message);
  });

  // Bound to loopback only: transcripts never become reachable from the network.
  server.listen(opts.port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${opts.port}`;
    console.log(`\n  Open ${url}  (Ctrl+C to stop)\n`);
    if (opts.open) openBrowser(url);
  });
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
