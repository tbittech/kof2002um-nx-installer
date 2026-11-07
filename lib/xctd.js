// XCTD (magic 0FF512ED): files the Xbox 360 kernel decompressed transparently on read.
// Header: +0 magic, +4 version, +8 hash, +0C flags (BE): window = 15 + ((flags >> 4) & 3),
// block count = (flags & 0xFFFF) >> 6; +10 the block sizes, 20-bit MSB-first fields (32-bit if
// flags & 0x00400000), padded to 32 bits; then each block's XMem frames. Every block is an independent
// LZX stream starting on a 0x20000 boundary of the file. A frame is [FF uu uu] cc cc + data, where uu is
// the output size when it is not 0x8000. Block count 0: no frames, the file is that many zero bytes.
import { lzxDecompress } from './lzx.js';

export const XCTD_MAGIC = 0x0FF512ED;

const be16 = (d, o) => (d[o] << 8) | d[o + 1];
const be32 = (d, o) => ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;

export function isXctd(d) {
  return d.length >= 0x14 && be32(d, 0) === XCTD_MAGIC;
}

// Parses the header: { sizes, total, window, blocksAt } or throws.
export function xctdInfo(d) {
  if (!isXctd(d)) throw new Error('not XCTD');
  const flags = be32(d, 0x0C);
  const window = 15 + ((flags >>> 4) & 3);
  let nb = (flags & 0xFFFF) >>> 6;
  const zero = nb === 0;
  if (zero) nb = 1;
  const w = (flags & 0x00400000) ? 32 : 20;
  const sizes = [];
  let total = 0;
  for (let i = 0; i < nb; i++) {
    let v = 0;
    for (let b = 0; b < w; b++) {
      const bit = i * w + b;
      v = v * 2 + ((d[0x10 + (bit >>> 3)] >>> (7 - (bit & 7))) & 1);
    }
    sizes.push(v);
    total += v;
  }
  return { sizes, total, window, zero, start: 0x10 + Math.ceil((nb * w) / 32) * 4 };
}

// Decompresses a whole XCTD file. A block that does not decode is left as zeros and reported in
// `damaged` (like `xctd -k`); a broken container throws, and the caller then keeps the file as it is.
export function xctdDecompress(d) {
  const info = xctdInfo(d);
  const out = new Uint8Array(info.total);
  const damaged = [];
  if (info.zero) return { data: out, damaged, zero: true };
  const n = d.length;
  let q = info.start, op = 0;
  for (let i = 0; i < info.sizes.length; i++) {
    if (i) q = (q + 0x1FFFF) & ~0x1FFFF;
    const size = info.sizes[i];
    const parts = [];
    let rl = 0, left = size;
    while (left) {
      if (q + 2 > n) throw new Error(`eof in block ${i}`);
      let u = left < 0x8000 ? left : 0x8000;
      if (d[q] === 0xFF) { u = be16(d, q + 1); q += 3; }
      const c = be16(d, q); q += 2;
      if (q + c > n || u === 0 || u > left) throw new Error(`bad frame in block ${i}`);
      parts.push(d.subarray(q, q + c)); rl += c; q += c; left -= u;
    }
    const raw = new Uint8Array(rl + 64);
    let p = 0;
    for (const part of parts) { raw.set(part, p); p += part.length; }
    try {
      out.set(lzxDecompress(raw, info.window, size), op);
    } catch (e) {
      damaged.push(i);
    }
    op += size;
  }
  if (q !== n) throw new Error(`trailing data ${q}/${n}`);
  return { data: out, damaged, zero: false };
}
