// R0 spike gateway: the only thing the Cloudflare tunnel can reach.
//
//   PC --tunnel--> gateway (this file, one port) --localhost--> serve-sim
//
// Routes (all except /health need ?t=<session token>; R0-only shortcut, ADR 0008):
//   GET  /health         "ok", used to check the tunnel is up
//   GET  /               viewer page (stream, click to tap, live logs)
//   GET  /stream.mjpeg   MJPEG video, proxied from serve-sim
//   GET  /stream.avcc    H.264 video, proxied from serve-sim (data-rate check)
//   GET  /config         screen size, proxied from serve-sim
//   WS   /ws             tap input, proxied to serve-sim's input socket
//   WS   /ws/logs        the app's log lines, served here (FR-SIM-13: WebSockets, never SSE)
//   POST /shutdown       ends the session early
//
// Settings come from environment variables (see the list below). The gateway
// never logs query strings, because they hold the token.
import { spawn } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

const here = dirname(fileURLToPath(import.meta.url));

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`gateway: environment variable ${name} is required`);
    process.exit(2);
  }
  return value;
}

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const HOST = process.env.GATEWAY_HOST ?? '127.0.0.1';
const SESSION_TOKEN = required('SESSION_TOKEN');
// For example http://127.0.0.1:3100/helper/<udid>
const UPSTREAM_BASE = new URL(required('UPSTREAM_BASE').replace(/\/+$/, ''));
const UPSTREAM_TOKEN = process.env.UPSTREAM_TOKEN ?? '';
const SHUTDOWN_FLAG = process.env.SHUTDOWN_FLAG ?? '';
const LOG_CMD = logCommand();

function logCommand() {
  if (process.env.LOG_CMD) return JSON.parse(process.env.LOG_CMD);
  const udid = required('SIM_UDID');
  const app = process.env.APP_PROCESS ?? 'R0Sample';
  return [
    'xcrun',
    'simctl',
    'spawn',
    udid,
    'log',
    'stream',
    '--style',
    'compact',
    '--level',
    'debug',
    '--predicate',
    `process == "${app}"`,
  ];
}

// --- Token check -----------------------------------------------------------

const tokenDigest = createHash('sha256').update(SESSION_TOKEN).digest();

function hasValidToken(url) {
  const given = url.searchParams.get('t');
  if (!given) return false;
  return timingSafeEqual(createHash('sha256').update(given).digest(), tokenDigest);
}

function log(method, url, status) {
  // Path only: the query string holds the token.
  console.log(`${new Date().toISOString()} ${method} ${url.pathname} ${status}`);
}

// --- Log stream (WS /ws/logs) ----------------------------------------------

const BACKLOG_LINES = 200;
const backlog = [];
const logClients = new Set();

function broadcast(message) {
  const text = JSON.stringify(message);
  for (const client of logClients) {
    if (client.readyState === client.OPEN) client.send(text);
  }
}

function startLogStream() {
  const [command, ...args] = LOG_CMD;
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let partial = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    partial += chunk;
    const lines = partial.split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = { type: 'line', t: Date.now(), line };
      backlog.push(message);
      if (backlog.length > BACKLOG_LINES) backlog.shift();
      broadcast(message);
    }
  });
  child.stderr.on('data', (chunk) => console.error(`log stream: ${String(chunk).trim()}`));
  child.on('error', (error) => console.error(`log stream failed to start: ${error.message}`));
  child.on('exit', (code) => {
    console.error(`log stream exited (${code}); restarting in 2 s`);
    setTimeout(startLogStream, 2000);
  });
}

const logServer = new WebSocketServer({ noServer: true });
logServer.on('connection', (socket) => {
  logClients.add(socket);
  socket.send(JSON.stringify({ type: 'hello', t: Date.now(), backlog: backlog.length }));
  for (const message of backlog) socket.send(JSON.stringify({ ...message, replay: true }));
  socket.on('close', () => logClients.delete(socket));
  socket.on('error', () => logClients.delete(socket));
});

// A small message every 5 s keeps idle connections open through proxies.
setInterval(() => broadcast({ type: 'tick', t: Date.now() }), 5000).unref();

// --- HTTP proxy to serve-sim -----------------------------------------------

function upstreamHeaders(extra = {}) {
  return {
    host: UPSTREAM_BASE.host,
    ...(UPSTREAM_TOKEN ? { authorization: `Bearer ${UPSTREAM_TOKEN}` } : {}),
    ...extra,
  };
}

function proxyGet(req, res, url, upstreamPath) {
  const target = new URL(UPSTREAM_BASE.pathname + upstreamPath, UPSTREAM_BASE);
  // Only our own headers go upstream: Cloudflare's forwarding headers would make
  // serve-sim treat the request as remote.
  const upstream = http.request(
    target,
    { method: 'GET', headers: upstreamHeaders({ accept: req.headers.accept ?? '*/*' }) },
    (upRes) => {
      const headers = {
        'content-type': upRes.headers['content-type'] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      };
      if (upRes.headers['content-length'])
        headers['content-length'] = upRes.headers['content-length'];
      res.writeHead(upRes.statusCode ?? 502, headers);
      log(req.method, url, upRes.statusCode);
      upRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    console.error(`upstream ${upstreamPath} failed: ${error.message}`);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('serve-sim is not reachable');
    log(req.method, url, 502);
  });
  // Stop the upstream stream when the viewer goes away.
  res.on('close', () => upstream.destroy());
  upstream.end();
}

const viewerHtml = readFileSync(join(here, 'viewer.html'));

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://gateway');

  if (url.pathname === '/health') {
    send(res, 200, 'ok');
    return;
  }
  if (!hasValidToken(url)) {
    send(res, 401, 'Missing or wrong token.');
    log(req.method, url, 401);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    });
    res.end(viewerHtml);
    log(req.method, url, 200);
    return;
  }
  if (req.method === 'GET' && ['/stream.mjpeg', '/stream.avcc', '/config'].includes(url.pathname)) {
    proxyGet(req, res, url, url.pathname);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/shutdown') {
    if (SHUTDOWN_FLAG) writeFileSync(SHUTDOWN_FLAG, new Date().toISOString());
    send(res, 200, 'Session ending.');
    log(req.method, url, 200);
    return;
  }
  send(res, 404, 'Not found.');
  log(req.method, url, 404);
});

// --- WebSocket upgrades ----------------------------------------------------

function refuse(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/** Pipes the browser's WebSocket straight through to serve-sim's input socket. */
function proxyInputSocket(req, clientSocket, head) {
  const upstream = net.connect(Number(UPSTREAM_BASE.port || 80), UPSTREAM_BASE.hostname);
  upstream.setNoDelay(true);
  clientSocket.setNoDelay(true);
  upstream.on('connect', () => {
    const origin = `${UPSTREAM_BASE.protocol}//${UPSTREAM_BASE.host}`;
    const lines = [
      `GET ${UPSTREAM_BASE.pathname}/ws HTTP/1.1`,
      `Host: ${UPSTREAM_BASE.host}`,
      // serve-sim only accepts same-origin WebSockets.
      `Origin: ${origin}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`,
      `Sec-WebSocket-Version: ${req.headers['sec-websocket-version'] ?? '13'}`,
    ];
    if (req.headers['sec-websocket-extensions']) {
      lines.push(`Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}`);
    }
    if (req.headers['sec-websocket-protocol']) {
      lines.push(`Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
    }
    if (UPSTREAM_TOKEN) lines.push(`Authorization: Bearer ${UPSTREAM_TOKEN}`);
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const closeBoth = () => {
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on('error', (error) => {
    console.error(`input socket upstream failed: ${error.message}`);
    closeBoth();
  });
  clientSocket.on('error', closeBoth);
  upstream.on('close', closeBoth);
  clientSocket.on('close', closeBoth);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://gateway');
  if (!hasValidToken(url)) {
    refuse(socket, 401, 'Unauthorized');
    log('WS', url, 401);
    return;
  }
  if (url.pathname === '/ws/logs') {
    logServer.handleUpgrade(req, socket, head, (ws) => logServer.emit('connection', ws, req));
    log('WS', url, 101);
    return;
  }
  if (url.pathname === '/ws') {
    proxyInputSocket(req, socket, head);
    log('WS', url, 101);
    return;
  }
  refuse(socket, 404, 'Not Found');
  log('WS', url, 404);
});

// Streams stay open for minutes: turn off Node's default request timeouts.
server.requestTimeout = 0;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 60_000;

startLogStream();
server.listen(PORT, HOST, () => {
  console.log(`gateway listening on http://${HOST}:${PORT} -> ${UPSTREAM_BASE.origin}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`gateway: ${signal}, stopping`);
    process.exit(0);
  });
}
