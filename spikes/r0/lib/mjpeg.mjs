// Splits an MJPEG stream (multipart/x-mixed-replace) into single JPEG frames.
//
// serve-sim sends a Content-Length header with every part, so the parser reads
// exactly that many bytes. Without one it falls back to the JPEG end marker
// (FF D9).

const HEADER_END = Buffer.from('\r\n\r\n');
const JPEG_END = Buffer.from([0xff, 0xd9]);
const MAX_PENDING = 16 * 1024 * 1024;

export class MjpegParser {
  /** @param {(jpeg: Buffer) => void} onFrame */
  constructor(onFrame) {
    this.onFrame = onFrame;
    this.pending = Buffer.alloc(0);
  }

  /** @param {Buffer | Uint8Array} chunk */
  push(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    this.drain();
    if (this.pending.length > MAX_PENDING) this.pending = Buffer.alloc(0);
  }

  drain() {
    for (;;) {
      const headerEnd = this.pending.indexOf(HEADER_END);
      if (headerEnd === -1) return;
      const header = this.pending.subarray(0, headerEnd).toString('latin1');
      const bodyStart = headerEnd + HEADER_END.length;
      const lengthMatch = /content-length:\s*(\d+)/i.exec(header);

      let bodyEnd;
      if (lengthMatch) {
        bodyEnd = bodyStart + Number(lengthMatch[1]);
        if (this.pending.length < bodyEnd) return;
      } else {
        const end = this.pending.indexOf(JPEG_END, bodyStart);
        if (end === -1) return;
        bodyEnd = end + JPEG_END.length;
      }

      const body = this.pending.subarray(bodyStart, bodyEnd);
      this.pending = this.pending.subarray(bodyEnd);
      // Only pass on real JPEGs (they start with FF D8).
      if (body.length > 2 && body[0] === 0xff && body[1] === 0xd8) this.onFrame(Buffer.from(body));
    }
  }
}

/**
 * Splits serve-sim's `/stream.avcc` wire format into chunks:
 * [u32 big-endian length][1-byte tag][payload], where length = 1 + payload.
 * Tags: 0x01 decoder setup, 0x02 keyframe, 0x03 delta frame, 0x04 seed JPEG.
 */
export class AvccParser {
  /** @param {(tag: number, size: number) => void} onChunk */
  constructor(onChunk) {
    this.onChunk = onChunk;
    this.pending = Buffer.alloc(0);
  }

  /** @param {Buffer | Uint8Array} chunk */
  push(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.pending = this.pending.length === 0 ? data : Buffer.concat([this.pending, data]);
    while (this.pending.length >= 5) {
      const length = this.pending.readUInt32BE(0);
      if (length < 1 || length > MAX_PENDING) {
        this.pending = Buffer.alloc(0);
        return;
      }
      if (this.pending.length < 4 + length) return;
      this.onChunk(this.pending[4], 4 + length);
      this.pending = this.pending.subarray(4 + length);
    }
  }
}
