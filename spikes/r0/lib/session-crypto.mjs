// Encrypts the session (tunnel URL + access token) on the runner and decrypts
// it on the PC. Only the encrypted text ever appears in the public job log.
//
// Format: "r0v1." + base64url(salt[16] | iv[12] | tag[16] | ciphertext)
// Key:    scrypt(passphrase, salt) -> 32 bytes, cipher AES-256-GCM.
// GCM's tag means a wrong passphrase or a damaged copy fails loudly instead of
// producing garbage.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const PREFIX = 'r0v1.';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
// N = 2^15 makes each passphrase guess cost tens of milliseconds.
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new Error('The passphrase is empty.');
  }
  return scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT_OPTIONS);
}

/**
 * @param {string} passphrase
 * @param {{ url: string, token: string }} session
 * @returns {string} the encrypted text, safe to print in a public log
 */
export function encryptSession(passphrase, session) {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ url: session.url, token: session.token }), 'utf8'),
    cipher.final(),
  ]);
  return PREFIX + Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/**
 * @param {string} passphrase
 * @param {string} text the encrypted text copied from the job log
 * @returns {{ url: string, token: string }}
 */
export function decryptSession(passphrase, text) {
  // Copying from a browser can add spaces or line breaks; base64url has neither.
  const clean = String(text).replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) {
    throw new Error(`This does not look like an R0 session: it should start with "${PREFIX}".`);
  }
  const raw = Buffer.from(clean.slice(PREFIX.length), 'base64url');
  if (raw.length <= SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new Error('The encrypted text is too short; copy the whole line from the job log.');
  }
  const salt = raw.subarray(0, SALT_BYTES);
  const iv = raw.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = raw.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);

  let plain;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Could not decrypt: the passphrase is wrong or the text was not copied whole.');
  }

  const session = JSON.parse(plain);
  if (typeof session.url !== 'string' || !/^https?:\/\//.test(session.url)) {
    throw new Error('Decrypted, but the session has no valid URL.');
  }
  if (typeof session.token !== 'string' || session.token.length < 16) {
    throw new Error('Decrypted, but the session has no valid token.');
  }
  return { url: session.url.replace(/\/+$/, ''), token: session.token };
}
