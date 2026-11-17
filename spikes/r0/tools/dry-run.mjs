#!/usr/bin/env node
// Local dry run of the whole spike chain, with no Mac and no tunnel:
//
//   measure --> gateway --> fake-sim
//
// It checks the encryption, the gateway's token rules and routes, the WebSocket
// log stream, the shutdown flag, and that measure detects a known tap delay.
// Run it before spending runner minutes:  node tools/dry-run.mjs
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decryptSession, encryptSession } from '../lib/session-crypto.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'r0-dry-run-'));
const FAKE_PORT = 3199;
const GATEWAY_PORT = 8099;
const LAG_MS = 120;
const sessionToken = randomBytes(32).toString('base64url');
const fakeToken = randomBytes(32).toString('hex');
const gateway = `http://127.0.0.1:${GATEWAY_PORT}`;
const children = [];
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

function start(name, args, env) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (d) => (child.output += d));
  child.stderr.on('data', (d) => (child.output += d));
  children.push(child);
  return child;
}

async function waitHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  console.log('1. Session encryption');
  const session = { url: 'https://example-words.trycloudflare.com', token: sessionToken };
  const blob = encryptSession('correct horse battery staple', session);
  check(
    'encrypted text has no URL or token in it',
    !blob.includes('trycloudflare') && !blob.includes(sessionToken),
  );
  check(
    'right passphrase decrypts',
    decryptSession('correct horse battery staple', blob).url === session.url,
  );
  check(
    'line breaks from copy-paste are tolerated',
    decryptSession('correct horse battery staple', `${blob.slice(0, 40)}\n ${blob.slice(40)}`)
      .token === sessionToken,
  );
  let wrongRejected = false;
  try {
    decryptSession('wrong', blob);
  } catch {
    wrongRejected = true;
  }
  check('wrong passphrase is rejected', wrongRejected);

  console.log('2. Start fake-sim and gateway');
  const logFile = join(work, 'app.log');
  const flag = join(work, 'shutdown');
  start('fake-sim', ['tools/fake-sim.mjs'], {
    FAKE_PORT: String(FAKE_PORT),
    FAKE_TOKEN: fakeToken,
    FAKE_LAG_MS: String(LAG_MS),
    FAKE_LOG_FILE: logFile,
  });
  const gw = start('gateway', ['gateway/gateway.mjs'], {
    GATEWAY_PORT: String(GATEWAY_PORT),
    SESSION_TOKEN: sessionToken,
    UPSTREAM_BASE: `http://127.0.0.1:${FAKE_PORT}/helper/fake`,
    UPSTREAM_TOKEN: fakeToken,
    SHUTDOWN_FLAG: flag,
    LOG_CMD: JSON.stringify([process.execPath, join(root, 'tools', 'tail-log.mjs'), logFile]),
  });
  check('gateway answers /health', await waitHttp(`${gateway}/health`));

  console.log('3. Gateway token rules');
  check('viewer without token is refused', (await fetch(`${gateway}/`)).status === 401);
  check('viewer with wrong token is refused', (await fetch(`${gateway}/?t=wrong`)).status === 401);
  const viewer = await fetch(`${gateway}/?t=${encodeURIComponent(sessionToken)}`);
  check(
    'viewer with token loads',
    viewer.status === 200 && (await viewer.text()).includes('SimBridge R0 viewer'),
  );
  const config = await fetch(`${gateway}/config?t=${encodeURIComponent(sessionToken)}`);
  check(
    'config is proxied to the simulator',
    config.status === 200 && (await config.json()).width === 390,
  );

  console.log('4. measure against the fake simulator (takes about 25 s)');
  const resultFile = join(work, 'result.json');
  const measure = start(
    'measure',
    [
      'tools/measure.mjs',
      '--taps=8',
      '--fps-seconds=12',
      '--avcc-seconds=3',
      `--out=${resultFile}`,
    ],
    {
      R0_SESSION_URL: gateway,
      R0_SESSION_TOKEN: sessionToken,
    },
  );
  const code = await new Promise((r) => measure.on('exit', r));
  check('measure finished', code === 0, code === 0 ? '' : measure.output.slice(-600));
  if (code === 0) {
    const result = JSON.parse(readFileSync(resultFile, 'utf8'));
    const median = result.tapLag.medianMs;
    check('every tap was seen', result.tapLag.missed === 0, `${result.tapLag.seen} seen`);
    check(
      `tap lag reflects the ${LAG_MS} ms fake delay`,
      median >= LAG_MS && median < LAG_MS + 250,
      `median ${median} ms`,
    );
    check(
      'first frame arrived',
      result.timeToFirstFrameMs != null,
      `${result.timeToFirstFrameMs} ms`,
    );
    check(
      'frame rate measured while animating',
      result.mjpeg.fps > 10 && result.mjpeg.animationSeen,
      `${result.mjpeg.fps} fps`,
    );
    check(
      'H.264 data rate measured',
      !result.avcc.error && result.avcc.kilobytesPerSecond > 0,
      `${result.avcc.kilobytesPerSecond} KB/s`,
    );
    check(
      'WebSocket logs carried the tap lines',
      result.logs.connected && result.logs.tapLines >= 8,
      `${result.logs.tapLines} tap lines`,
    );
    const text = readFileSync(resultFile, 'utf8');
    check(
      'result file holds no URL or token',
      !text.includes(sessionToken) && !text.includes('127.0.0.1'),
    );
  }

  console.log('5. Shutdown and logging');
  await fetch(`${gateway}/shutdown?t=${encodeURIComponent(sessionToken)}`, { method: 'POST' });
  check('POST /shutdown sets the flag', existsSync(flag));
  check('gateway log never shows the token', !gw.output.includes(sessionToken));
}

try {
  await main();
} catch (error) {
  check('dry run crashed', false, error.stack);
} finally {
  for (const child of children) child.kill();
  rmSync(work, { recursive: true, force: true });
  console.log(failures === 0 ? '\nDry run passed.' : `\nDry run failed: ${failures} check(s).`);
  process.exit(failures === 0 ? 0 : 1);
}
