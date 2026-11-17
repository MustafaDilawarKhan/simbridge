#!/usr/bin/env node
// Turns the timing log ("<name> <unix ms>" per line) into a Markdown table for
// the job log and the job summary, with the R0 start-time gate (NFR-PERF-01).
//   node spikes/r0/runner/timings.mjs "$TIMINGS"
import { readFileSync } from 'node:fs';

const GATE_SECONDS = 180;
const LABELS = {
  dispatched: 'Run dispatched',
  job_start: 'Job started on the Mac',
  deps_installed: 'Packages installed',
  build_done: 'App built (Release, no Metro)',
  tools_ready: 'cloudflared and serve-sim ready',
  boot_start: 'Simulator boot started',
  booted: 'Simulator booted',
  installed: 'App installed',
  launched: 'App launched',
  serve_sim_ready: 'serve-sim streaming',
  gateway_ready: 'Gateway up',
  tunnel_ready: 'Tunnel reachable from the internet',
  session_end: 'Session ended',
};

const marks = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length === 2 && /^\d+$/.test(parts[1]))
  .map(([name, ms]) => ({ name, ms: Number(ms) }))
  .sort((a, b) => a.ms - b.ms);

const at = Object.fromEntries(marks.map((m) => [m.name, m.ms]));
const seconds = (from, to) =>
  at[from] != null && at[to] != null ? ((at[to] - at[from]) / 1000).toFixed(1) : null;

const lines = [
  '## R0 timings',
  '',
  '| Step | Time (UTC) | Since previous (s) | Since first (s) |',
  '| --- | --- | ---: | ---: |',
];
marks.forEach((mark, i) => {
  const time = new Date(mark.ms).toISOString().slice(11, 23);
  const sincePrevious = i === 0 ? '' : ((mark.ms - marks[i - 1].ms) / 1000).toFixed(1);
  const sinceFirst = ((mark.ms - marks[0].ms) / 1000).toFixed(1);
  lines.push(`| ${LABELS[mark.name] ?? mark.name} | ${time} | ${sincePrevious} | ${sinceFirst} |`);
});

const gate = seconds('boot_start', 'tunnel_ready');
lines.push('', '### Gate and phases', '');
if (gate != null) {
  const pass = Number(gate) <= GATE_SECONDS;
  lines.push(
    `- **Start-time gate (boot to tunnel ready, at most ${GATE_SECONDS} s): ${gate} s, ${pass ? 'PASS' : 'FAIL'}**`,
  );
}
const phases = [
  ['Waiting for a Mac (dispatch to job start)', 'dispatched', 'job_start'],
  ['Build phase (job start to app built)', 'job_start', 'build_done'],
  ['Boot (boot start to booted)', 'boot_start', 'booted'],
  ['Install and launch', 'booted', 'launched'],
  ['serve-sim, gateway and tunnel', 'launched', 'tunnel_ready'],
];
for (const [label, from, to] of phases) {
  const value = seconds(from, to);
  if (value != null) lines.push(`- ${label}: ${value} s`);
}
lines.push('- Tap lag is measured on the PC with `measure` (NFR-PERF-02).');

console.log(lines.join('\n'));
