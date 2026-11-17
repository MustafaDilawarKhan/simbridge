// Reads the encrypted session and the passphrase on the PC, without echoing the
// passphrase and without putting it on the command line (shell history).
import readline from 'node:readline';

import { decryptSession } from './session-crypto.mjs';

/** Asks one question on the terminal; with hidden=true nothing typed is shown. */
export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: Boolean(process.stdin.isTTY),
    });
    process.stdout.write(question);
    if (hidden) rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/**
 * Where the session comes from, in order:
 * 1. R0_SESSION_URL + R0_SESSION_TOKEN (plain values, for the local dry run only)
 * 2. the encrypted text: first command-line argument that starts with "r0v1.",
 *    else R0_SESSION_BLOB, else a prompt
 * The passphrase comes from R0_SPIKE_KEY if set, else a hidden prompt.
 * @returns {Promise<{ url: string, token: string }>}
 */
export async function loadSession(argv = process.argv.slice(2)) {
  if (process.env.R0_SESSION_URL && process.env.R0_SESSION_TOKEN) {
    return {
      url: process.env.R0_SESSION_URL.replace(/\/+$/, ''),
      token: process.env.R0_SESSION_TOKEN,
    };
  }
  const blob =
    argv.find((arg) => arg.startsWith('r0v1.')) ??
    process.env.R0_SESSION_BLOB ??
    (await ask('Paste the encrypted session text from the job log (starts with r0v1.): '));
  const passphrase =
    process.env.R0_SPIKE_KEY ??
    (await ask('Passphrase (R0_SPIKE_KEY, not shown): ', { hidden: true }));
  return decryptSession(passphrase, blob);
}
