#!/usr/bin/env node
// Saves the live simulator screen as a JPEG, to see where things are before
// running measure (for example where the tabs or a close button sit).
//
//   node tools/screenshot.mjs [r0v1.xxxx] [--out=screen.jpg]
//
// It reads one frame of the MJPEG stream and never prints the URL or token.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MjpegParser } from '../lib/mjpeg.mjs';
import { loadSession } from '../lib/session-input.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const out = resolve(outArg ? outArg.slice(6) : 'screen.jpg');

const { url, token } = await loadSession();
const abort = new AbortController();
setTimeout(() => abort.abort(), 30000);
const response = await fetch(`${url}/stream.mjpeg?t=${encodeURIComponent(token)}`, {
  signal: abort.signal,
});
if (!response.ok) {
  console.error(`screenshot: the stream answered HTTP ${response.status}`);
  process.exit(1);
}
// serve-sim sends frames only when the screen changes, so keep the newest one
// and save it after 2 s (or as soon as 5 have arrived).
let latest = null;
let count = 0;
const save = () => {
  writeFileSync(out, latest);
  console.log(`Saved ${out} (${Math.round(latest.length / 1024)} KB)`);
  process.exit(0);
};
const parser = new MjpegParser((frame) => {
  latest = frame;
  count += 1;
  if (count === 1) setTimeout(save, 2000);
  if (count >= 5) save();
});
try {
  for await (const chunk of response.body) parser.push(chunk);
} catch (error) {
  console.error(`screenshot: ${error.name === 'AbortError' ? 'no frame within 30 s' : error.message}`);
  process.exit(1);
}
