#!/usr/bin/env node
// Prints the UDID of the simulator called <name> on the newest iOS runtime.
//   node spikes/r0/runner/resolve-device.mjs "iPhone 17 Pro"
// If there is no such simulator, it lists the iPhone models that exist and fails.
import { execFileSync } from 'node:child_process';

const wanted = process.argv[2];
if (!wanted) {
  console.error('usage: resolve-device.mjs <simulator name>');
  process.exit(2);
}

const list = JSON.parse(
  execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '-j'], { encoding: 'utf8' }),
);

function iosVersion(runtime) {
  const match = /iOS-(\d+)-(\d+)(?:-(\d+))?$/.exec(runtime);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

const candidates = [];
const iphones = new Set();
for (const [runtime, devices] of Object.entries(list.devices ?? {})) {
  const version = iosVersion(runtime);
  if (!version) continue;
  for (const device of devices) {
    if (device.isAvailable === false) continue;
    if (device.name.startsWith('iPhone')) iphones.add(device.name);
    if (device.name === wanted) candidates.push({ udid: device.udid, version, runtime });
  }
}

candidates.sort((a, b) => {
  for (let i = 0; i < 3; i += 1)
    if (a.version[i] !== b.version[i]) return b.version[i] - a.version[i];
  return 0;
});

if (candidates.length === 0) {
  console.error(`No available simulator called "${wanted}". iPhone models on this runner:`);
  for (const name of [...iphones].sort()) console.error(`  ${name}`);
  process.exit(1);
}

const pick = candidates[0];
console.error(`Using "${wanted}" on ${pick.runtime.split('.').pop()} (${pick.udid})`);
process.stdout.write(pick.udid);
