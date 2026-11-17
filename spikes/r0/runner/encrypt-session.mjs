#!/usr/bin/env node
// Prints the encrypted session (tunnel URL + access token) and nothing else.
// Reads R0_SPIKE_KEY, SESSION_URL and SESSION_TOKEN from the environment.
import { encryptSession } from '../lib/session-crypto.mjs';

const { R0_SPIKE_KEY, SESSION_URL, SESSION_TOKEN } = process.env;
if (!R0_SPIKE_KEY) {
  console.error('R0_SPIKE_KEY is not set: refusing to hand off the session in plain text.');
  process.exit(1);
}
if (!SESSION_URL || !SESSION_TOKEN) {
  console.error('SESSION_URL and SESSION_TOKEN are required.');
  process.exit(1);
}
process.stdout.write(encryptSession(R0_SPIKE_KEY, { url: SESSION_URL, token: SESSION_TOKEN }));
