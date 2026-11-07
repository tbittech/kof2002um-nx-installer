// LZX decoder: a JavaScript port of the LZX path of libmspack's lzxd.c
// (C) 2003-2013 Stuart Caie, licensed under the GNU LGPL 2.1 (see LICENSE-LGPL in this folder).
// Only plain LZX is implemented (no LZX DELTA, no reset interval): one independent stream per call,
// as the Xbox 360 XCTD files store it (the frames' compressed bytes concatenated).

const FRAME = 32768;
const MIN_MATCH = 2;
const NUM_CHARS = 256;
const PRETREE_SYMS = 20;
const ALIGNED_SYMS = 8;
const LENGTH_SYMS = 249;
const SLOTS = [30, 32, 34, 36, 38, 42, 50];

const EXTRA = new Uint8Array(290);
const BASE = new Uint32Array(290);
for (let i = 0, base = 0; i < 290; i++) {
  EXTRA[i] = i < 4 ? 0 : Math.min(17, (i >> 1) - 1);
  BASE[i] = base;
  base += 1 << EXTRA[i];
}

// Canonical Huffman lookup on a full 16-bit peek: table[peek] = symbol, lens[symbol] = bits to drop.
// Returns false for an over-subscribed or incomplete code; an all-zero code gives an empty table.
function buildTable(lens, n, table) {
  let total = 0, any = false;
  for (let i = 0; i < n; i++) if (lens[i]) { total += 0x10000 >>> lens[i]; any = true; }
  if (!any) return 'empty';
  if (total !== 0x10000) return false;
  let pos = 0;
  for (let len = 1; len <= 16; len++) {
    const span = 0x10000 >>> len;
    for (let s = 0; s < n; s++) {
      if (lens[s] !== len) continue;
      table.fill(s, pos, pos + span);
      pos += span;
    }
  }
  return true;
}

export function lzxDecompress(input, windowBits, outLen) {
  if (windowBits < 15 || windowBits > 21) throw new Error(`LZX window ${windowBits} not supported`);
  const wsize = 1 << windowBits;
  const window = new Uint8Array(wsize);
  const out = new Uint8Array(outLen);
  const numMain = NUM_CHARS + (SLOTS[windowBits - 15] << 3);
  const inLen = input.length;

  const preLen = new Uint8Array(PRETREE_SYMS), preTab = new Uint16Array(0x10000);
  const mainLen = new Uint8Array(numMain), mainTab = new Uint16Array(0x10000);
  const lenLen = new Uint8Array(LENGTH_SYMS), lenTab = new Uint16Array(0x10000);
  const alLen = new Uint8Array(ALIGNED_SYMS), alTab = new Uint16Array(0x10000);
  let lengthEmpty = false;

  // Bit reader: 16-bit little-endian words fed MSB first; `buf` holds `left` bits left-aligned in 32 bits.
  let pos = 0, buf = 0, left = 0;
  const word = () => {
    const w = (pos < inLen ? input[pos] : 0) | ((pos + 1 < inLen ? input[pos + 1] : 0) << 8);
    pos += 2;
    return w;
  };
  const need = (n) => { while (left < n) { buf = (buf | (word() << (16 - left))) >>> 0; left += 16; } };
  const bits = (n) => {
    if (n === 0) return 0;
    need(n);
    const v = buf >>> (32 - n);
    buf = (buf << n) >>> 0; left -= n;
    return v;
  };
  const huff = (tab, lens) => {
    need(16);
    const s = tab[buf >>> 16];
    const l = lens[s];
    buf = (buf << l) >>> 0; left -= l;
    return s;
  };
  const consumed = () => pos * 8 - left;
  const seekBits = (bitPos) => { pos = bitPos >>> 3; buf = 0; left = 0; };

  const readLengths = (lens, first, last) => {
    for (let x = 0; x < PRETREE_SYMS; x++) preLen[x] = bits(4);
    if (buildTable(preLen, PRETREE_SYMS, preTab) !== true) throw new Error('LZX: bad pretree');
    for (let x = first; x < last;) {
      let z = huff(preTab, preLen);
      if (z === 17) { let y = bits(4) + 4; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 18) { let y = bits(5) + 20; while (y-- && x < last) lens[x++] = 0; }
      else if (z === 19) {
        let y = bits(1) + 4;
        z = huff(preTab, preLen);
        z = lens[x] - z; if (z < 0) z += 17;
        while (y-- && x < last) lens[x++] = z;
      } else { z = lens[x] - z; if (z < 0) z += 17; lens[x++] = z; }
    }
  };

  let R0 = 1, R1 = 1, R2 = 1;
  let blockType = 0, blockLen = 0, blockRem = 0;
  let intelStarted = false;
  let intelSize = 0;
  {
    let hi = 0, lo = 0;
    if (bits(1)) { hi = bits(16); lo = bits(16); }
    intelSize = ((hi << 16) | lo) | 0;
  }

  let wpos = 0, offset = 0, frame = 0;
  while (offset < outLen) {
    const frameSize = Math.min(FRAME, outLen - offset);
    const framePos = wpos;
    let todo = framePos + frameSize - wpos;
    while (todo > 0) {
      if (blockRem === 0) {
        if (blockType === 3 && (blockLen & 1)) pos++;
        blockType = bits(3);
        const hi = bits(16), lo = bits(8);
        blockRem = blockLen = (hi << 8) | lo;
        if (blockType === 2) {
          for (let i = 0; i < 8; i++) alLen[i] = bits(3);
          if (buildTable(alLen, ALIGNED_SYMS, alTab) !== true) throw new Error('LZX: bad aligned tree');
        }
        if (blockType === 1 || blockType === 2) {
          readLengths(mainLen, 0, 256);
          readLengths(mainLen, 256, numMain);
          if (buildTable(mainLen, numMain, mainTab) !== true) throw new Error('LZX: bad main tree');
          if (mainLen[0xE8]) intelStarted = true;
          readLengths(lenLen, 0, LENGTH_SYMS);
          const r = buildTable(lenLen, LENGTH_SYMS, lenTab);
          if (r === false) throw new Error('LZX: bad length tree');
          lengthEmpty = r === 'empty';
        } else if (blockType === 3) {
          intelStarted = true;
          // 1-16 bits of padding up to the next 16-bit boundary, then raw bytes.
          const c = consumed();
          seekBits((Math.floor(c / 16) + 1) * 16);
          if (pos + 12 > inLen) throw new Error('LZX: truncated stream');
          const rd = (o) => (input[o] | (input[o + 1] << 8) | (input[o + 2] << 16) | (input[o + 3] << 24)) >>> 0;
          R0 = rd(pos); R1 = rd(pos + 4); R2 = rd(pos + 8);
          pos += 12;
        } else throw new Error(`LZX: bad block type ${blockType}`);
      }

      let run = blockRem < todo ? blockRem : todo;
      todo -= run; blockRem -= run;

      if (blockType === 3) {
        if (pos + run > inLen) throw new Error('LZX: truncated stream');
        window.set(input.subarray(pos, pos + run), wpos);
        pos += run; wpos += run;
        continue;
      }
      const aligned = blockType === 2;
      while (run > 0) {
        const main = huff(mainTab, mainLen);
        if (main < NUM_CHARS) { window[wpos++] = main; run--; continue; }
        const m = main - NUM_CHARS;
        let mlen = m & 7;
        if (mlen === 7) {
          if (lengthEmpty) throw new Error('LZX: length tree used but empty');
          mlen += huff(lenTab, lenLen);
        }
        mlen += MIN_MATCH;
        let moff = m >>> 3;
        if (moff > 2) {
          if (!aligned) {
            if (moff !== 3) moff = BASE[moff] - 2 + bits(EXTRA[moff]);
            else moff = 1;
          } else {
            let extra = EXTRA[moff];
            let o = BASE[moff] - 2;
            if (extra > 3) { o += bits(extra - 3) << 3; o += huff(alTab, alLen); }
            else if (extra === 3) o += huff(alTab, alLen);
            else if (extra > 0) o += bits(extra);
            else o = 1;
            moff = o;
          }
          R2 = R1; R1 = R0; R0 = moff;
        } else if (moff === 0) moff = R0;
        else if (moff === 1) { moff = R1; R1 = R0; R0 = moff; }
        else { moff = R2; R2 = R0; R0 = moff; }

        if (wpos + mlen > wsize) throw new Error('LZX: match ran over the window');
        let dst = wpos;
        let i = mlen;
        if (moff > wpos) {
          let j = moff - wpos;
          if (j > wsize) throw new Error('LZX: match offset beyond the window');
          let src = wsize - j;
          if (j < i) { i -= j; while (j-- > 0) window[dst++] = window[src++]; src = 0; }
          while (i-- > 0) window[dst++] = window[src++];
        } else {
          let src = dst - moff;
          while (i-- > 0) window[dst++] = window[src++];
        }
        run -= mlen;
        wpos += mlen;
      }
      if (run < 0) {
        if (-run > blockRem) throw new Error('LZX: match overran the block');
        blockRem -= -run;
      }
    }

    if (wpos - framePos !== frameSize) throw new Error('LZX: decoded beyond the frame');
    // Realign the input to 16 bits at the end of every frame.
    if (left > 0) seekBits(Math.ceil(consumed() / 16) * 16);

    const chunk = out.subarray(offset, offset + frameSize);
    chunk.set(window.subarray(framePos, framePos + frameSize));
    if (intelStarted && intelSize && frame < 32768 && frameSize > 10) {
      let curpos = offset;
      const end = frameSize - 10;
      for (let d = 0; d < end;) {
        if (chunk[d++] !== 0xE8) { curpos++; continue; }
        const abs = chunk[d] | (chunk[d + 1] << 8) | (chunk[d + 2] << 16) | (chunk[d + 3] << 24);
        if (abs >= -curpos && abs < intelSize) {
          const rel = abs >= 0 ? abs - curpos : abs + intelSize;
          chunk[d] = rel; chunk[d + 1] = rel >>> 8; chunk[d + 2] = rel >>> 16; chunk[d + 3] = rel >>> 24;
        }
        d += 4;
        curpos += 5;
      }
    }
    offset += frameSize;
    frame++;
    if (wpos === wsize) wpos = 0;
  }
  return out;
}
