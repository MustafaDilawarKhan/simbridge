#!/usr/bin/env node
// A pretend serve-sim for testing on Windows, so bugs are found without
// spending a macOS runner. It copies the parts of serve-sim the spike uses:
//
//   GET /helper/fake/stream.mjpeg   MJPEG frames of a drawn copy of the sample app
//   GET /helper/fake/stream.avcc    fake H.264 chunks in serve-sim's wire format
//   GET /helper/fake/config         screen size
//   WS  /helper/fake/ws             taps (byte 0x03 + JSON), same-origin only
//
// Like serve-sim, it requires "Authorization: Bearer <FAKE_TOKEN>" when FAKE_TOKEN
// is set. FAKE_LAG_MS delays every tap's effect, to check measure sees the delay.
// Tap log lines go to FAKE_LOG_FILE, which tools/tail-log.mjs can follow.
import { appendFileSync } from 'node:fs';
import http from 'node:http';

import jpeg from 'jpeg-js';
import { WebSocketServer } from 'ws';

import { ANIMATE_TAP, COUNTER_WATCH } from '../lib/layout.mjs';

const PORT = Number(process.env.FAKE_PORT ?? 3100);
const TOKEN = process.env.FAKE_TOKEN ?? '';
const LAG_MS = Number(process.env.FAKE_LAG_MS ?? 0);
const LOG_FILE = process.env.FAKE_LOG_FILE ?? '';
const WIDTH = 390;
const HEIGHT = 844;
const BASE = '/helper/fake';

const state = { count: 0, animate: false, phase: 0 };

function logLine(text) {
  if (LOG_FILE) appendFileSync(LOG_FILE, `${new Date().toISOString()} R0Sample ${text}\n`);
}

// --- Drawing -----------------------------------------------------------------

function fill(buf, rect, [r, g, b]) {
  const x0 = Math.floor(rect.x0 * WIDTH);
  const x1 = Math.ceil(rect.x1 * WIDTH);
  const y0 = Math.floor(rect.y0 * HEIGHT);
  const y1 = Math.ceil(rect.y1 * HEIGHT);
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * WIDTH + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  }
}

function renderJpeg() {
  const data = Buffer.alloc(WIDTH * HEIGHT * 4, 255);
  fill(data, { x0: 0.05, x1: 0.95, y0: 0.12, y1: 0.16 }, [238, 238, 238]);
  const barStart = 0.05 + state.phase * 0.7;
  fill(data, { x0: barStart, x1: barStart + 0.15, y0: 0.12, y1: 0.16 }, [124, 58, 237]);
  fill(
    data,
    { x0: 0.1, x1: 0.9, y0: 0.45, y1: 0.65 },
    state.count % 2 === 0 ? [29, 78, 216] : [249, 115, 22],
  );
  fill(
    data,
    { x0: 0.1, x1: 0.9, y0: 0.8, y1: 0.9 },
    state.animate ? [22, 163, 74] : [107, 114, 128],
  );
  return jpeg.encode({ data, width: WIDTH, height: HEIGHT }, 70).data;
}

// --- Streams -----------------------------------------------------------------

const mjpegClients = new Set();
const avccClients = new Set();

function avccChunk(tag, size) {
  const out = Buffer.alloc(5 + size);
  out.writeUInt32BE(size + 1, 0);
  out[4] = tag;
  return out;
}

function emitFrame() {
  if (mjpegClients.size === 0 && avccClients.size === 0) return;
  const frame = renderJpeg();
  const part = Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`),
    frame,
    Buffer.from('\r\n'),
  ]);
  for (const res of mjpegClients) res.write(part);
  for (const res of avccClients) res.write(avccChunk(3, Math.ceil(frame.length / 8)));
}

// Animate at 30 fps; otherwise send a frame once a second (and on every change).
setInterval(() => {
  if (!state.animate) return;
  state.phase = (state.phase + 1 / 30) % 1;
  emitFrame();
}, 1000 / 30);
setInterval(() => {
  if (!state.animate) emitFrame();
}, 1000);

function within(point, rect) {
  return point.x >= rect.x0 && point.x <= rect.x1 && point.y >= rect.y0 && point.y <= rect.y1;
}

function onTouch(touch) {
  if (touch.type !== 'begin') return;
  setTimeout(() => {
    if (within(touch, { x0: 0.1, x1: 0.9, y0: 0.45, y1: 0.65 })) {
      state.count += 1;
      logLine(`[r0] tap ${state.count}`);
    } else if (within(touch, { x0: 0.1, x1: 0.9, y0: 0.8, y1: 0.9 })) {
      state.animate = !state.animate;
      logLine(`[r0] animate ${state.animate ? 'on' : 'off'}`);
    }
    emitFrame();
  }, LAG_MS);
}

// --- Server ------------------------------------------------------------------

function authorized(req) {
  return !TOKEN || req.headers.authorization === `Bearer ${TOKEN}`;
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401).end('Missing or invalid serve-sim auth token.');
    return;
  }
  const path = new URL(req.url ?? '/', 'http://fake').pathname;
  if (path === `${BASE}/stream.mjpeg`) {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' });
    mjpegClients.add(res);
    res.on('close', () => mjpegClients.delete(res));
    emitFrame();
    return;
  }
  if (path === `${BASE}/stream.avcc`) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.write(avccChunk(1, 40));
    res.write(avccChunk(2, 20000));
    avccClients.add(res);
    res.on('close', () => avccClients.delete(res));
    return;
  }
  if (path === `${BASE}/config`) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ width: WIDTH, height: HEIGHT, orientation: 'portrait' }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    const bytes = Buffer.from(data);
    if (bytes[0] !== 0x03) return;
    onTouch(JSON.parse(bytes.subarray(1).toString('utf8')));
  });
});

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '/', 'http://fake').pathname;
  // serve-sim refuses cross-origin sockets; so does the fake.
  const sameOrigin = req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  if (path !== `${BASE}/ws` || !authorized(req) || !sameOrigin) {
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `fake-sim on http://127.0.0.1:${PORT}${BASE} (lag ${LAG_MS} ms, animate tap at ${ANIMATE_TAP.y}, watch ${COUNTER_WATCH.y0}-${COUNTER_WATCH.y1})`,
  );
});
