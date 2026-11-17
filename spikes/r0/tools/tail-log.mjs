#!/usr/bin/env node
// Prints lines as they are added to a file (like `tail -f`). Used only by the
// local dry run, standing in for `xcrun simctl ... log stream`.
import { existsSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/tail-log.mjs <file>');
  process.exit(2);
}
if (!existsSync(file)) writeFileSync(file, '');

let offset = statSync(file).size;
const buffer = Buffer.alloc(64 * 1024);
setInterval(() => {
  const size = statSync(file).size;
  if (size <= offset) return;
  const fd = openSync(file, 'r');
  while (offset < size) {
    const read = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (read <= 0) break;
    process.stdout.write(buffer.subarray(0, read));
    offset += read;
  }
}, 100);
