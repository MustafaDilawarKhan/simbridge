#!/usr/bin/env node
// Measures a live R0 session from the PC and writes the numbers to
// spikes/r0/results/<date>.json (no URL or token is ever written).
//
//   node tools/measure.mjs [r0v1.xxxx] [--tap-a=x,y] [--tap-b=x,y] [--watch=x0,y0,x1,y1]
//                          [--taps=20] [--fps-seconds=20] [--big-frame-bytes=3000]
//                          [--mjpeg-taps=6] [--mjpeg-seconds=10] [--out=file]
//
// The main stream is H.264 (decided after run 5: full-size MJPEG needs about
// 44 Mbit/s for 15 fps, more than a normal home line). What it measures
// (NFR-PERF-01, NFR-PERF-02, NFR-PERF-04, FR-SIM-13):
//   1. time to first H.264 frame
//   2. tap lag over H.264: taps A and B in turn (each tap must change the
//      screen) and times how long until the first large frame arrives.
//      serve-sim sends frames only when the screen changes, and small ones for
//      tiny changes such as a blinking cursor, so the first frame of at least
//      --big-frame-bytes after a tap on a still screen is the app answering.
//   3. H.264 frame rate and data rate while the list scrolls
//   4. MJPEG, for comparison: time to first frame, a few taps (pixel
//      comparison), frame rate and data rate while scrolling
//   5. whether the WebSocket log stream connects and keeps delivering messages
//
// Arrival times are stamped as bytes arrive, before any parsing or decoding.
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
const FPS_SECONDS = Number(option('fps-seconds', 20));
const BIG_FRAME_BYTES = Number(option('big-frame-bytes', 3000));
const MJPEG_TAPS = Number(option('mjpeg-taps', 6));
const MJPEG_SECONDS = Number(option('mjpeg-seconds', 10));
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
  if (frame.image === undefined) {
    try {
      frame.image = jpeg.decode(frame.jpeg, { useTArray: true, formatAsRGBA: true });
    } catch {
      frame.image = null; // a damaged frame (run 5): skip it instead of stopping
    }
  }
  return frame.image;
}

/** Share of pixels in `rect` that clearly changed between two frames (0 to 1). */
function changedShare(frameA, frameB, rect) {
  const a = decode(frameA);
  const b = decode(frameB);
  if (!a || !b) return 0;
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

/** serve-sim's H.264 stream: records the arrival time, tag and size of every chunk. */
class AvccReader {
  constructor(url) {
    this.url = url;
    this.chunks = []; // { t, tag, size }, video frames only (tags 2 and 3)
    this.bytes = 0;
    this.frameCount = 0;
    this.firstFrameMs = null;
    this.lastBigAt = 0;
    this.abort = new AbortController();
  }

  async start() {
    const startedAt = now();
    const response = await fetch(this.url, { signal: this.abort.signal });
    if (!response.ok) throw new Error(`H.264 stream answered HTTP ${response.status}`);
    const parser = new AvccParser((tag, size) => {
      const t = this.chunkAt;
      // The seed JPEG (tag 4) is the first picture a viewer sees.
      if (this.firstFrameMs === null && (tag === 2 || tag === 3 || tag === 4)) {
        this.firstFrameMs = t - startedAt;
      }
      if (tag !== 2 && tag !== 3) return;
      this.frameCount += 1;
      if (size >= BIG_FRAME_BYTES) this.lastBigAt = t;
      this.chunks.push({ t, tag, size });
      if (this.chunks.length > 5000) this.chunks.splice(0, this.chunks.length - 5000);
    });
    (async () => {
      try {
        for await (const chunk of response.body) {
          this.chunkAt = now();
          this.bytes += chunk.length;
          parser.push(chunk);
        }
      } catch (error) {
        if (error.name !== 'AbortError') console.error(`H.264 stream stopped: ${error.message}`);
      }
    })();
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

/** Waits until no MJPEG frame has arrived for `quietMs` (or `maxMs` passes). True if it got quiet. */
async function waitQuiet(stream, quietMs = 300, maxMs = 3000) {
  return waitFor(() => now() - stream.lastFrameAt >= quietMs, maxMs, 25);
}

/** Waits until no large H.264 frame has arrived for `quietMs`. True if it got quiet. */
async function waitQuietAvcc(avcc, quietMs = 600, maxMs = 4000) {
  return waitFor(() => now() - avcc.lastBigAt >= quietMs, maxMs, 25);
}

function summarize(lags, count) {
  return {
    medianMs: round(percentile(lags, 50)),
    p95Ms: round(percentile(lags, 95)),
    minMs: lags.length ? round(Math.min(...lags)) : null,
    maxMs: lags.length ? round(Math.max(...lags)) : null,
    seen: lags.length,
    missed: count - lags.length,
  };
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
      bigFrameBytes: BIG_FRAME_BYTES,
      mjpegTaps: MJPEG_TAPS,
      mjpegSeconds: MJPEG_SECONDS,
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

  // --- H.264: the main stream ---
  console.log('Opening the H.264 stream...');
  const avcc = new AvccReader(`${url}/stream.avcc?${q}`);
  await avcc.start();
  if (!(await waitFor(() => avcc.firstFrameMs !== null, 30000))) {
    throw new Error('No H.264 picture arrived within 30 s.');
  }
  result.timeToFirstFrameMs = round(avcc.firstFrameMs);
  console.log(`  first picture after ${result.timeToFirstFrameMs} ms`);

  console.log('Opening the tap input socket...');
  const input = await openSocket(`${wsBase}/ws?${q}`, { binary: true });

  // Start on A, unmeasured, so the first measured tap (on B) changes the screen.
  await tap(input, TAP_A);
  await sleep(1500);

  console.log(`Measuring tap lag over H.264, ${TAPS} taps, A and B in turn...`);
  const taps = [];
  for (let i = 1; i <= TAPS; i += 1) {
    const point = i % 2 === 1 ? TAP_B : TAP_A;
    const quiet = await waitQuietAvcc(avcc);
    const sentAt = await tap(input, point);
    await waitFor(() => avcc.lastBigAt >= sentAt, 3000, 10);
    const hit = avcc.chunks.find((c) => c.t >= sentAt && c.size >= BIG_FRAME_BYTES);
    const lagMs = hit ? hit.t - sentAt : null;
    taps.push({
      n: i,
      point: point === TAP_A ? 'A' : 'B',
      lagMs: round(lagMs),
      frameBytes: hit?.size ?? null,
      screenWasQuiet: quiet,
    });
    console.log(`  tap ${String(i).padStart(2)}: ${lagMs == null ? 'no change seen' : `${round(lagMs)} ms`}`);
    await sleep(800 + Math.random() * 400); // let the screen settle; jitter vs frame timing
  }
  const lags = taps.map((t) => t.lagMs).filter((v) => v != null);
  result.tapLag = { stream: 'H.264', ...summarize(lags, taps.length), taps };

  console.log(`Measuring H.264 frame rate for ${FPS_SECONDS} s while scrolling...`);
  await sleep(1000);
  let start = now();
  let framesBefore = avcc.frameCount;
  let bytesBefore = avcc.bytes;
  await keepScrolling(input, start + FPS_SECONDS * 1000);
  let seconds = (now() - start) / 1000;
  result.h264 = {
    fps: round((avcc.frameCount - framesBefore) / seconds, 1),
    kilobytesPerSecond: round((avcc.bytes - bytesBefore) / 1024 / seconds),
    megabitsPerSecond: round(((avcc.bytes - bytesBefore) * 8) / 1e6 / seconds, 1),
  };
  console.log(
    `  ${result.h264.fps} fps, ${result.h264.kilobytesPerSecond} KB/s (${result.h264.megabitsPerSecond} Mbit/s)`,
  );
  avcc.stop();

  // --- MJPEG, for comparison ---
  console.log('Opening the MJPEG stream, for comparison...');
  const stream = new MjpegReader(`${url}/stream.mjpeg?${q}`);
  await stream.start();
  const mjpegOk = await waitFor(() => stream.firstFrameMs !== null, 30000);
  result.mjpeg = { timeToFirstFrameMs: mjpegOk ? round(stream.firstFrameMs) : null };
  if (mjpegOk && MJPEG_TAPS > 0) {
    console.log(`Measuring tap lag over MJPEG, ${MJPEG_TAPS} taps...`);
    await sleep(1500);
    const mjpegTaps = [];
    for (let i = 1; i <= MJPEG_TAPS; i += 1) {
      const point = i % 2 === 1 ? TAP_B : TAP_A;
      await waitQuiet(stream);
      const baseline = stream.latest();
      const sentAt = await tap(input, point);
      await sleep(4000); // collect frames; decode only afterwards
      const hit = stream.frames
        .filter((f) => f.t >= sentAt)
        .find((frame) => changedShare(baseline, frame, WATCH) > 0.01);
      const lagMs = hit ? hit.t - sentAt : null;
      mjpegTaps.push(round(lagMs));
      console.log(`  tap ${i}: ${lagMs == null ? 'no change seen' : `${round(lagMs)} ms`}`);
    }
    result.mjpeg.tapLag = summarize(
      mjpegTaps.filter((v) => v != null),
      mjpegTaps.length,
    );
  }
  if (mjpegOk && MJPEG_SECONDS > 0) {
    console.log(`Measuring MJPEG frame rate for ${MJPEG_SECONDS} s while scrolling...`);
    start = now();
    framesBefore = stream.count;
    bytesBefore = stream.bytes;
    await keepScrolling(input, start + MJPEG_SECONDS * 1000);
    seconds = (now() - start) / 1000;
    result.mjpeg.fps = round((stream.count - framesBefore) / seconds, 1);
    result.mjpeg.kilobytesPerSecond = round((stream.bytes - bytesBefore) / 1024 / seconds);
    console.log(`  ${result.mjpeg.fps} fps, ${result.mjpeg.kilobytesPerSecond} KB/s`);
  }
  stream.stop();

  input.close();
  logSocket?.close();
  result.logs = logs;

  result.gate = {
    tapLagMedianUnder400ms:
      result.tapLag.medianMs != null && result.tapLag.medianMs < GATE_TAP_LAG_MS,
    h264AtLeast15fps: result.h264.fps >= GATE_FPS,
    videoThroughTunnel: result.timeToFirstFrameMs != null,
    mjpegThroughTunnel: result.mjpeg.timeToFirstFrameMs != null,
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

  const { tapLag, h264, mjpeg, gate } = result;
  const yes = (ok) => (ok ? 'PASS' : 'FAIL');
  console.log('');
  console.log('Result');
  console.log(`  first H.264 picture   ${result.timeToFirstFrameMs} ms`);
  console.log(
    `  tap lag (H.264)       median ${tapLag.medianMs} ms, p95 ${tapLag.p95Ms} ms (${tapLag.missed} of ${TAPS} missed)`,
  );
  console.log(`  H.264 while scrolling ${h264.fps} fps, ${h264.megabitsPerSecond} Mbit/s`);
  if (mjpeg.tapLag) {
    console.log(
      `  MJPEG (comparison)    tap lag median ${mjpeg.tapLag.medianMs} ms, ${mjpeg.fps ?? '-'} fps, ${mjpeg.kilobytesPerSecond ?? '-'} KB/s`,
    );
  }
  console.log(
    `  WebSocket logs        ${logs.connected ? 'connected' : 'FAILED'}, ${logs.lines} app lines, ${logs.ticks} keep-alive messages`,
  );
  console.log(`  gate: tap lag         ${yes(gate.tapLagMedianUnder400ms)}`);
  console.log(`  gate: 15 fps (H.264)  ${yes(gate.h264AtLeast15fps)}`);
  console.log(
    `  gate: video + WS logs ${yes(gate.videoThroughTunnel && gate.mjpegThroughTunnel && gate.webSocketLogsThroughTunnel)}`,
  );
  if (tapLag.missed > TAPS / 2) {
    console.log(
      '  Most taps changed nothing: check --tap-a and --tap-b (each tap must visibly change the screen).',
    );
  }
  console.log(`Saved to ${outFile}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`measure: ${error.message}`);
  process.exit(1);
});
