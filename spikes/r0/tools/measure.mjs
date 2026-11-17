#!/usr/bin/env node
// Measures a live R0 session from the PC and writes the numbers to
// spikes/r0/results/<date>.json (no URL or token is ever written).
//
//   node tools/measure.mjs [r0v1.xxxx] [--tap-a=x,y] [--tap-b=x,y] [--watch=x0,y0,x1,y1]
//                          [--taps=20] [--fps-seconds=30] [--avcc-seconds=15] [--out=file]
//
// What it measures (NFR-PERF-01, NFR-PERF-02, NFR-PERF-04, FR-SIM-13):
//   1. time to first video frame (MJPEG)
//   2. tap lag: taps the two tabs in turn (each tap switches the screen) and
//      times how long until the screen changes; median and p95
//   3. frame rate and data rate of MJPEG while the list scrolls
//   4. data rate of serve-sim's H.264 stream, for comparison
//   5. whether the WebSocket log stream connects and keeps delivering messages
//
// Frame arrival times are stamped before any decoding, and frames are decoded
// only after each measuring window, so decoding cannot inflate the lag.
// Don't touch the simulator while this runs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import jpeg from 'jpeg-js';

import {
  DEFAULT_TAP_A,
  DEFAULT_TAP_B,
  DEFAULT_WATCH,
  SCROLL_FROM,
  SCROLL_TO,
  parsePoint,
  parseRect,
} from '../lib/layout.mjs';
import { AvccParser, MjpegParser } from '../lib/mjpeg.mjs';
import { loadSession } from '../lib/session-input.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GATE_TAP_LAG_MS = 400; // NFR-PERF-02, median
const GATE_FPS = 15; // NFR-PERF-04, Mode B

function option(name, fallback) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const TAPS = Number(option('taps', 20));
const FPS_SECONDS = Number(option('fps-seconds', 30));
const AVCC_SECONDS = Number(option('avcc-seconds', 15));
const TAP_A = parsePoint(option('tap-a'), DEFAULT_TAP_A);
const TAP_B = parsePoint(option('tap-b'), DEFAULT_TAP_B);
const WATCH = parseRect(option('watch'), DEFAULT_WATCH);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const now = () => performance.now();
const round = (n, digits = 0) => (n == null ? null : Number(n.toFixed(digits)));

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

// --- Pixel comparison --------------------------------------------------------

function decode(frame) {
  if (!frame.image) {
    frame.image = jpeg.decode(frame.jpeg, { useTArray: true, formatAsRGBA: true });
  }
  return frame.image;
}

/** Share of pixels in `rect` that clearly changed between two frames (0 to 1). */
function changedShare(frameA, frameB, rect) {
  const a = decode(frameA);
  const b = decode(frameB);
  if (a.width !== b.width || a.height !== b.height) return 1;
  const x0 = Math.floor(rect.x0 * a.width);
  const x1 = Math.ceil(rect.x1 * a.width);
  const y0 = Math.floor(rect.y0 * a.height);
  const y1 = Math.ceil(rect.y1 * a.height);
  let changed = 0;
  let total = 0;
  for (let y = y0; y < y1; y += 3) {
    for (let x = x0; x < x1; x += 3) {
      const i = (y * a.width + x) * 4;
      const diff = Math.max(
        Math.abs(a.data[i] - b.data[i]),
        Math.abs(a.data[i + 1] - b.data[i + 1]),
        Math.abs(a.data[i + 2] - b.data[i + 2]),
      );
      // 48 is well above JPEG noise between two identical screens.
      if (diff > 48) changed += 1;
      total += 1;
    }
  }
  return total === 0 ? 0 : changed / total;
}

// --- Connections -------------------------------------------------------------

class MjpegReader {
  constructor(url) {
    this.url = url;
    this.frames = [];
    this.bytes = 0;
    this.count = 0; // all frames ever received (the list below keeps only recent ones)
    this.firstFrameMs = null;
    this.lastFrameAt = 0;
    this.abort = new AbortController();
  }

  async start() {
    const startedAt = now();
    const response = await fetch(this.url, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`MJPEG stream answered HTTP ${response.status}`);
    const parser = new MjpegParser((jpegBytes) => {
      const t = this.chunkAt;
      if (this.firstFrameMs === null) this.firstFrameMs = t - startedAt;
      this.lastFrameAt = t;
      this.count += 1;
      this.frames.push({ t, jpeg: jpegBytes });
      // Keep memory small: only the last few seconds are ever needed. Always pick
      // frames by time, never by position, because this list is trimmed.
      if (this.frames.length > 600) this.frames.splice(0, this.frames.length - 600);
    });
    (async () => {
      try {
        for await (const chunk of response.body) {
          this.chunkAt = now(); // stamp on arrival, before parsing
          this.bytes += chunk.length;
          parser.push(chunk);
        }
      } catch (error) {
        if (error.name !== 'AbortError') console.error(`MJPEG stream stopped: ${error.message}`);
      }
    })();
  }

  latest() {
    return this.frames.at(-1);
  }

  stop() {
    this.abort.abort();
  }
}

function openSocket(url, { binary = false } = {}) {
  return new Promise((resolveOpen, reject) => {
    const socket = new WebSocket(url);
    if (binary) socket.binaryType = 'arraybuffer';
    const path = new URL(url).pathname;
    const timer = setTimeout(() => reject(new Error(`WebSocket did not open: ${path}`)), 15000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolveOpen(socket);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`WebSocket failed: ${path}`));
    });
  });
}

/** serve-sim input message: byte 0x03, then JSON {type, x, y} with x and y from 0 to 1. */
function touchMessage(type, point) {
  const json = Buffer.from(JSON.stringify({ type, x: point.x, y: point.y }));
  return Buffer.concat([Buffer.from([0x03]), json]);
}

async function tap(input, point) {
  const sentAt = now();
  input.send(touchMessage('begin', point));
  await sleep(40);
  input.send(touchMessage('end', point));
  return sentAt;
}

/** One-finger drag from `from` to `to` over `ms`, sending a move every 16 ms. */
async function drag(input, from, to, ms = 400) {
  input.send(touchMessage('begin', from));
  const steps = Math.max(2, Math.round(ms / 16));
  for (let i = 1; i <= steps; i += 1) {
    await sleep(16);
    const k = i / steps;
    const point = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    input.send(touchMessage('move', point));
  }
  input.send(touchMessage('end', to));
}

/** Scrolls up and down until `stopAt` (a performance.now() time). */
async function keepScrolling(input, stopAt) {
  let up = true;
  while (now() < stopAt) {
    await (up ? drag(input, SCROLL_FROM, SCROLL_TO) : drag(input, SCROLL_TO, SCROLL_FROM));
    up = !up;
    await sleep(250);
  }
}

async function waitFor(check, timeoutMs, stepMs = 50) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (check()) return true;
    await sleep(stepMs);
  }
  return check();
}

/** Waits until no frame has arrived for `quietMs` (or `maxMs` passes). True if it got quiet. */
async function waitQuiet(stream, quietMs = 300, maxMs = 3000) {
  return waitFor(() => now() - stream.lastFrameAt >= quietMs, maxMs, 25);
}

// --- Main --------------------------------------------------------------------

async function main() {
  const { url, token } = await loadSession();
  const q = `t=${encodeURIComponent(token)}`;
  const wsBase = url.replace(/^http/, 'ws');
  const result = {
    measuredAt: new Date().toISOString(),
    client: { platform: process.platform, node: process.version },
    settings: {
      taps: TAPS,
      fpsSeconds: FPS_SECONDS,
      avccSeconds: AVCC_SECONDS,
      tapA: TAP_A,
      tapB: TAP_B,
      watch: WATCH,
    },
  };

  // Log stream first, so it sees everything that follows.
  console.log('Connecting to the WebSocket log stream...');
  const logs = { connected: false, openMs: null, lines: 0, ticks: 0, error: null };
  const logsStart = now();
  let logSocket = null;
  try {
    logSocket = await openSocket(`${wsBase}/ws/logs?${q}`);
    logs.connected = true;
    logs.openMs = round(now() - logsStart);
    logSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === 'tick') logs.ticks += 1;
      if (message.type === 'line' && !message.replay) logs.lines += 1;
    });
  } catch (error) {
    logs.error = error.message;
    console.error(`  ${error.message}`);
  }

  console.log('Opening the MJPEG stream...');
  const stream = new MjpegReader(`${url}/stream.mjpeg?${q}`);
  await stream.start();
  if (!(await waitFor(() => stream.firstFrameMs !== null, 30000))) {
    throw new Error('No video frame arrived within 30 s.');
  }
  result.timeToFirstFrameMs = round(stream.firstFrameMs);
  console.log(`  first frame after ${result.timeToFirstFrameMs} ms`);

  console.log('Opening the tap input socket...');
  const input = await openSocket(`${wsBase}/ws?${q}`, { binary: true });

  // Start on tab A, unmeasured, so the first measured tap (on B) changes the screen.
  await tap(input, TAP_A);
  await sleep(1500);

  // --- Tap lag ---
  console.log(`Measuring tap lag over ${TAPS} taps, switching tabs each time...`);
  const taps = [];
  for (let i = 1; i <= TAPS; i += 1) {
    const point = i % 2 === 1 ? TAP_B : TAP_A;
    const quiet = await waitQuiet(stream);
    const baseline = stream.latest();
    const sentAt = await tap(input, point);
    await sleep(2500); // collect frames; decode only afterwards
    const after = stream.frames.filter((f) => f.t >= sentAt);
    const hit = after.find((frame) => changedShare(baseline, frame, WATCH) > 0.01);
    const lagMs = hit ? hit.t - sentAt : null;
    taps.push({
      n: i,
      tab: point === TAP_A ? 'A' : 'B',
      lagMs: round(lagMs),
      framesAfterTap: after.length,
      screenWasQuiet: quiet,
    });
    const shown = lagMs == null ? 'no change seen' : `${round(lagMs)} ms`;
    console.log(`  tap ${String(i).padStart(2)}: ${shown}`);
    await sleep(300 + Math.random() * 400); // jitter, so taps do not line up with frame timing
  }
  const lags = taps.map((t) => t.lagMs).filter((v) => v != null);
  result.tapLag = {
    medianMs: round(percentile(lags, 50)),
    p95Ms: round(percentile(lags, 95)),
    minMs: lags.length ? Math.min(...lags) : null,
    maxMs: lags.length ? Math.max(...lags) : null,
    seen: lags.length,
    missed: taps.length - lags.length,
    taps,
  };

  // --- Frame rate and data rate while the list scrolls ---
  console.log(`Measuring MJPEG frame rate for ${FPS_SECONDS} s while scrolling...`);
  await tap(input, TAP_A); // the Search tab has the scrolling list
  await sleep(1500);
  const firstInWindow = stream.latest();
  const fpsStart = now();
  const countBefore = stream.count;
  const bytesBefore = stream.bytes;
  await keepScrolling(input, fpsStart + FPS_SECONDS * 1000);
  const seconds = (now() - fpsStart) / 1000;
  const framesInWindow = stream.count - countBefore;
  const screenMoved = stream.frames
    .slice(-10)
    .some((frame) => changedShare(firstInWindow, frame, WATCH) > 0.01);
  result.mjpeg = {
    fps: round(framesInWindow / seconds, 1),
    kilobytesPerSecond: round((stream.bytes - bytesBefore) / 1024 / seconds),
    framesCounted: framesInWindow,
    screenMoved,
  };
  console.log(`  ${result.mjpeg.fps} fps, ${result.mjpeg.kilobytesPerSecond} KB/s`);
  stream.stop();

  // --- H.264 data rate, same scrolling ---
  console.log(`Measuring the H.264 stream for ${AVCC_SECONDS} s while scrolling...`);
  const scrolling = keepScrolling(input, now() + AVCC_SECONDS * 1000);
  result.avcc = await measureAvcc(`${url}/stream.avcc?${q}`, AVCC_SECONDS);
  await scrolling;
  console.log(
    result.avcc.error
      ? `  ${result.avcc.error}`
      : `  ${result.avcc.framesPerSecond} frames/s, ${result.avcc.kilobytesPerSecond} KB/s`,
  );

  input.close();
  logSocket?.close();
  result.logs = logs;

  result.gate = {
    tapLagMedianUnder400ms:
      result.tapLag.medianMs != null && result.tapLag.medianMs < GATE_TAP_LAG_MS,
    mjpegAtLeast15fps: result.mjpeg.fps >= GATE_FPS,
    mjpegThroughTunnel: result.timeToFirstFrameMs != null,
    // The gateway sends a message every 5 s, so receiving any proves the WebSocket
    // path through the tunnel works even if the app itself logs little.
    webSocketLogsThroughTunnel: logs.connected && logs.ticks + logs.lines > 0,
    note: 'Start time (boot to tunnel ready, under 3 min) is in the job summary, not measured here.',
  };

  const outFile = option('out', null)
    ? resolve(option('out'))
    : join(here, '..', 'results', `${result.measuredAt.replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

  const { tapLag, mjpeg, avcc, gate } = result;
  console.log('');
  console.log('Result');
  console.log(`  time to first frame   ${result.timeToFirstFrameMs} ms`);
  console.log(
    `  tap lag               median ${tapLag.medianMs} ms, p95 ${tapLag.p95Ms} ms (${tapLag.missed} missed)`,
  );
  console.log(`  MJPEG                 ${mjpeg.fps} fps, ${mjpeg.kilobytesPerSecond} KB/s`);
  console.log(`  H.264                 ${avcc.kilobytesPerSecond ?? '-'} KB/s`);
  console.log(
    `  WebSocket logs        ${logs.connected ? 'connected' : 'FAILED'}, ${logs.lines} app lines, ${logs.ticks} keep-alive messages`,
  );
  console.log(`  gate: tap lag         ${gate.tapLagMedianUnder400ms ? 'PASS' : 'FAIL'}`);
  const streamsPass = gate.mjpegThroughTunnel && gate.webSocketLogsThroughTunnel;
  console.log(`  gate: MJPEG + WS logs ${streamsPass ? 'PASS' : 'FAIL'}`);
  if (tapLag.missed > TAPS / 2) {
    console.log(
      '  Most taps changed nothing: check --tap-a and --tap-b against the tab positions shown in the viewer.',
    );
  }
  console.log(`Saved to ${outFile}`);
  process.exit(0);
}

async function measureAvcc(url, seconds) {
  const abort = new AbortController();
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let bytes = 0;
  try {
    const response = await fetch(url, { signal: abort.signal });
    if (!response.ok) return { error: `H.264 stream answered HTTP ${response.status}` };
    const parser = new AvccParser((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
    const start = now();
    setTimeout(() => abort.abort(), seconds * 1000);
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        parser.push(chunk);
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
    const elapsed = (now() - start) / 1000;
    return {
      kilobytesPerSecond: round(bytes / 1024 / elapsed),
      framesPerSecond: round((counts[2] + counts[3]) / elapsed, 1),
      keyframes: counts[2],
      deltaFrames: counts[3],
    };
  } catch (error) {
    return { error: `H.264 stream failed: ${error.message}` };
  }
}

main().catch((error) => {
  console.error(`measure: ${error.message}`);
  process.exit(1);
});
