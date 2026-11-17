#!/usr/bin/env node
// A pretend serve-sim for testing on Windows, so bugs are found without
// spending a macOS runner. It copies the parts of serve-sim the spike uses:
//
//   GET /helper/fake/stream.mjpeg   MJPEG frames of a drawn two-tab app
//   GET /helper/fake/stream.avcc    fake H.264 chunks in serve-sim's wire format
//   GET /helper/fake/config         screen size
//   WS  /helper/fake/ws             touches (byte 0x03 + JSON), same-origin only
//
// The drawn app has two tabs at the bottom (left half and right half of the
// bar at y 0.90 to 0.98) and a striped list that moves when dragged, like the
// test app expo-rsc-movies. Like serve-sim, it requires
// "Authorization: Bearer <FAKE_TOKEN>" when FAKE_TOKEN is set. FAKE_LAG_MS
// delays every tab switch, to check that measure sees the delay. Log lines go
// to FAKE_LOG_FILE, which tools/tail-log.mjs can follow.
import { appendFileSync } from 'node:fs';
import http from 'node:http';

import jpeg from 'jpeg-js';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.FAKE_PORT ?? 3100);
const TOKEN = process.env.FAKE_TOKEN ?? '';
const LAG_MS = Number(process.env.FAKE_LAG_MS ?? 0);
const LOG_FILE = process.env.FAKE_LOG_FILE ?? '';
const WIDTH = 390;
const HEIGHT = 844;
const BASE = '/helper/fake';
const TAB_BAR = { y0: 0.9, y1: 0.98 };

const state = { tab: 'A', scroll: 0, dragFromY: null };

function logLine(text) {
  if (LOG_FILE) appendFileSync(LOG_FILE, `${new Date().toISOString()} ExpoMovies ${text}\n`);
}

// --- Drawing -----------------------------------------------------------------

function fill(buf, rect, [r, g, b]) {
  const x0 = Math.max(0, Math.floor(rect.x0 * WIDTH));
  const x1 = Math.min(WIDTH, Math.ceil(rect.x1 * WIDTH));
  const y0 = Math.max(0, Math.floor(rect.y0 * HEIGHT));
  const y1 = Math.min(HEIGHT, Math.ceil(rect.y1 * HEIGHT));
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
  // Content: tab A is a blue striped list that scrolls; tab B is a plain orange page.
  if (state.tab === 'A') {
    for (let row = -1; row < 12; row += 1) {
      const y0 = 0.08 + row * 0.08 + (state.scroll % 0.16);
      fill(data, { x0: 0.05, x1: 0.95, y0, y1: y0 + 0.05 }, [29, 78, 216]);
    }
  } else {
    fill(data, { x0: 0.05, x1: 0.95, y0: 0.1, y1: 0.85 }, [249, 115, 22]);
  }
  fill(data, { x0: 0, x1: 1, y0: 0.88, y1: 1 }, [245, 245, 245]);
  const selected = state.tab === 'A' ? { x0: 0.1, x1: 0.45 } : { x0: 0.55, x1: 0.9 };
  fill(data, { ...selected, ...TAB_BAR }, [0, 122, 255]);
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

// Send a frame on every change, and at least once a second.
setInterval(emitFrame, 1000);

function onTouch(touch) {
  const inTabBar = touch.y >= TAB_BAR.y0 && touch.y <= TAB_BAR.y1;
  if (touch.type === 'begin') {
    state.dragFromY = inTabBar ? null : touch.y;
    if (inTabBar) {
      const tab = touch.x < 0.5 ? 'A' : 'B';
      setTimeout(() => {
        if (state.tab !== tab) logLine(`switched to tab ${tab}`);
        state.tab = tab;
        emitFrame();
      }, LAG_MS);
    }
    return;
  }
  if (touch.type === 'move' && state.dragFromY !== null && state.tab === 'A') {
    state.scroll += touch.y - state.dragFromY;
    state.dragFromY = touch.y;
    emitFrame();
    return;
  }
  if (touch.type === 'end') state.dragFromY = null;
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
  console.log(`fake-sim on http://127.0.0.1:${PORT}${BASE} (tab switch lag ${LAG_MS} ms)`);
});
