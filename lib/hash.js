// SHA-1 (synchronous, for the 4 KiB STFS blocks), 64-bit FNV-1a (the asset pack checksums) and CRC-32 (zip).

const W = new Int32Array(80);
// SHA-1 of d[off, off+len) as a 40-char hex string.
export function sha1Hex(d, off = 0, len = d.length) {
  let h0 = 0x67452301, h1 = 0xEFCDAB89 | 0, h2 = 0x98BADCFE | 0, h3 = 0x10325476, h4 = 0xC3D2E1F0 | 0;
  const total = len + 9;
  const padded = Math.ceil(total / 64) * 64;
  const tail = new Uint8Array(padded - (len & ~63));
  tail.set(d.subarray(off + (len & ~63), off + len));
  tail[len & 63] = 0x80;
  const bitsHi = Math.floor(len / 0x20000000), bitsLo = (len * 8) >>> 0;
  const tl = tail.length;
  tail[tl - 8] = bitsHi >>> 24; tail[tl - 7] = bitsHi >>> 16; tail[tl - 6] = bitsHi >>> 8; tail[tl - 5] = bitsHi;
  tail[tl - 4] = bitsLo >>> 24; tail[tl - 3] = bitsLo >>> 16; tail[tl - 2] = bitsLo >>> 8; tail[tl - 1] = bitsLo;
  const full = len & ~63;
  for (let c = 0; c < full + tl; c += 64) {
    const src = c < full ? d : tail;
    const base = c < full ? off + c : c - full;
    for (let i = 0; i < 16; i++) {
      const o = base + i * 4;
      W[i] = (src[o] << 24) | (src[o + 1] << 16) | (src[o + 2] << 8) | src[o + 3];
    }
    for (let i = 16; i < 80; i++) { const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16]; W[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, cc = h2, dd = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & cc) | (~b & dd); k = 0x5A827999; }
      else if (i < 40) { f = b ^ cc ^ dd; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & cc) | (b & dd) | (cc & dd); k = 0x8F1BBCDC | 0; }
      else { f = b ^ cc ^ dd; k = 0xCA62C1D6 | 0; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
      e = dd; dd = cc; cc = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + cc) | 0; h3 = (h3 + dd) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

// 64-bit FNV-1a kept as two 32-bit halves. prime = 2^40 + 0x1B3. The basis is the one of the port's
// PackDevice (1469598103934665603 = 0x14650FB0739D0383, not the textbook one): the console checks it.
export class Fnv64 {
  constructor() { this.hi = 0x14650FB0; this.lo = 0x739D0383; }
  update(d) {
    let hi = this.hi, lo = this.lo;
    for (let i = 0, n = d.length; i < n; i++) {
      lo = (lo ^ d[i]) >>> 0;
      const l = lo * 0x1B3;
      const nlo = l >>> 0;
      hi = (hi * 0x1B3 + Math.floor(l / 4294967296) + ((lo << 8) >>> 0)) >>> 0;
      lo = nlo;
    }
    this.hi = hi; this.lo = lo;
    return this;
  }
  bytes() { // little endian, as struct.pack('<Q')
    const b = new Uint8Array(8);
    const v = new DataView(b.buffer);
    v.setUint32(0, this.lo, true); v.setUint32(4, this.hi, true);
    return b;
  }
  hex() { return this.hi.toString(16).padStart(8, '0') + this.lo.toString(16).padStart(8, '0'); }
  isZero() { return this.hi === 0 && this.lo === 0; }
}

const CRC = new Int32Array(256 * 8);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c;
}
for (let n = 0; n < 256; n++) for (let t = 1; t < 8; t++) CRC[t * 256 + n] = (CRC[(t - 1) * 256 + n] >>> 8) ^ CRC[CRC[(t - 1) * 256 + n] & 0xFF];

// Slice-by-8 CRC-32; pass the previous value to continue.
export function crc32(d, crc = 0) {
  let c = ~crc;
  let i = 0;
  const n = d.length;
  for (; i + 8 <= n; i += 8) {
    const a = c ^ (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
    const b = d[i + 4] | (d[i + 5] << 8) | (d[i + 6] << 16) | (d[i + 7] << 24);
    c = CRC[7 * 256 + (a & 0xFF)] ^ CRC[6 * 256 + ((a >>> 8) & 0xFF)] ^ CRC[5 * 256 + ((a >>> 16) & 0xFF)] ^
      CRC[4 * 256 + (a >>> 24)] ^ CRC[3 * 256 + (b & 0xFF)] ^ CRC[2 * 256 + ((b >>> 8) & 0xFF)] ^
      CRC[256 + ((b >>> 16) & 0xFF)] ^ CRC[b >>> 24];
  }
  for (; i < n; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}
