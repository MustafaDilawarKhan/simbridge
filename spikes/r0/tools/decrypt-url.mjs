#!/usr/bin/env node
// Decrypts the session text printed by the R0 spike workflow and shows the
// tunnel URL and the viewer link.
//
//   node tools/decrypt-url.mjs              (asks for the text and the passphrase)
//   node tools/decrypt-url.mjs r0v1.xxxx    (asks only for the passphrase)
import { loadSession } from '../lib/session-input.mjs';

try {
  const { url, token } = await loadSession();
  const viewer = `${url}/?t=${encodeURIComponent(token)}`;
  console.log('');
  console.log(`Tunnel URL:   ${url}`);
  console.log(`Viewer link:  ${viewer}`);
  console.log('');
  console.log('Open the viewer link in your browser to see and tap the simulator.');
  console.log('Keep both private: anyone with the viewer link can control the simulator');
  console.log('until the session ends. Never paste them into an issue, PR or chat.');
} catch (error) {
  console.error(`decrypt-url: ${error.message}`);
  process.exit(1);
}
