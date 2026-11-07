// STFS (Xbox 360 LIVE/PIRS/CON package) reader that locates every data block by its SHA-1, like
// tools/kof_stfs_extract.py of the port: a package with a missing physical block (the one this port was
// made from lacks data block 19917) has every later block one position early, and the standard arithmetic
// would read the wrong data. Blocks whose data is not in the package read as zeros and are reported.
import { sha1Hex } from './hash.js';

const BLOCK = 0x1000;
const PER_TABLE = 0xAA;
const LEVEL_BASE = [PER_TABLE, PER_TABLE ** 2, PER_TABLE ** 3];
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u24be = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// `src.read(offset, length)` -> Promise<Uint8Array>; `src.size` in bytes.
export class Stfs {
  static async open(src, progress = () => {}) {
    const s = new Stfs();
    s.src = src;
    const hdr = await src.read(0, 0xA000);
    const magic = String.fromCharCode(...hdr.subarray(0, 4));
    if (!['LIVE', 'PIRS', 'CON '].includes(magic)) throw new Error('not an Xbox 360 package (STFS)');
    if (hdr[0x3A9] !== 0) throw new Error('the package volume is SVOD, not STFS');
    s.titleId = be32(hdr, 0x360).toString(16).toUpperCase().padStart(8, '0');
    s.contentType = be32(hdr, 0x344).toString(16).toUpperCase().padStart(8, '0');
    let name = '';
    for (let o = 0x411; o < 0x411 + 0x80; o += 2) {
      const c = (hdr[o] << 8) | hdr[o + 1];
      if (!c) break;
      name += String.fromCharCode(c);
    }
    s.displayName = name;
    const headerSize = be32(hdr, 0x340);
    const vd = 0x379;
    s.tablesPerLevel = hdr[vd + 2] & 1 ? 1 : 2;
    s.ftBlocks = hdr[vd + 3] | (hdr[vd + 4] << 8);
    s.ftStart = u24le(hdr, vd + 5);
    s.allocBlocks = be32(hdr, vd + 0x1C);
    s.dataBase = Math.ceil(headerSize / BLOCK) * BLOCK;
    s.nphys = Math.floor((src.size - s.dataBase) / BLOCK);

    // SHA-1 of every physical block -> physical indices.
    s.byHash = new Map();
    const CHUNK = 256;
    for (let ph = 0; ph < s.nphys; ph += CHUNK) {
      const n = Math.min(CHUNK, s.nphys - ph);
      const d = await src.read(s.dataBase + ph * BLOCK, n * BLOCK);
      for (let i = 0; i < n; i++) {
        const h = sha1Hex(d, i * BLOCK, BLOCK);
        const list = s.byHash.get(h);
        if (list) list.push(ph + i); else s.byHash.set(h, [ph + i]);
      }
      progress((ph + n) / s.nphys);
    }
    s.physOf = new Int32Array(s.allocBlocks).fill(-1);
    s.nextOf = new Int32Array(s.allocBlocks);
    s.missing = [];
    await s.mapBlocks();
    return s;
  }

  async raw(ph) {
    return this.src.read(this.dataBase + ph * BLOCK, BLOCK);
  }

  // Standard STFS data block -> physical block (Xenia's BlockToOffsetSTFS).
  expected(block) {
    let out = block;
    for (const base of LEVEL_BASE) {
      out += Math.floor((block + base) / base) * this.tablesPerLevel;
      if (block < base) break;
    }
    return out;
  }

  hex(d, o) {
    let s = '';
    for (let i = 0; i < 20; i++) s += d[o + i].toString(16).padStart(2, '0');
    return s;
  }

  async mapBlocks() {
    const groups = Math.ceil(this.allocBlocks / PER_TABLE);
    for (let g = 0; g < groups; g++) {
      const first = g * PER_TABLE;
      const n = Math.min(PER_TABLE, this.allocBlocks - first);
      // The level-0 table sits right before the group's first data block; try the standard position and
      // the ones shifted by missing blocks.
      let best = null;
      for (let shift = 0; shift > -4; shift--) {
        const tpos = this.expected(first) - this.tablesPerLevel + shift;
        if (tpos < 0) continue;
        const table = await this.raw(tpos);
        let hits = 0;
        for (let i = 0; i < n; i++) if (this.byHash.has(this.hex(table, i * 0x18))) hits++;
        if (best === null || hits > best.hits) best = { hits, table };
      }
      const table = best.table;
      for (let i = 0; i < n; i++) {
        const b = first + i;
        this.nextOf[b] = u24be(table, i * 0x18 + 0x15);
        const cands = this.byHash.get(this.hex(table, i * 0x18));
        if (!cands) { this.missing.push(b); continue; }
        const exp = this.expected(b);
        let pick = cands[0];
        for (const c of cands) if (Math.abs(c - exp) < Math.abs(pick - exp)) pick = c;
        this.physOf[b] = pick;
      }
    }
    // Blocks found away from the standard position (informative).
    let shifted = 0;
    for (let b = 0; b < this.allocBlocks; b++) if (this.physOf[b] >= 0 && this.physOf[b] !== this.expected(b)) shifted++;
    this.shifted = shifted;
  }

  *chain(start, count, consecutive) {
    let block = start;
    for (let i = 0; i < count; i++) {
      yield block;
      block = consecutive ? block + 1 : this.nextOf[block];
    }
  }

  // Reads the blocks in order, merging physically consecutive ones into one read.
  async readBlocks(blocks, size) {
    const out = new Uint8Array(size);
    let lost = [];
    let i = 0, op = 0;
    while (i < blocks.length && op < size) {
      const b = blocks[i];
      const ph = b >= 0 && b < this.allocBlocks ? this.physOf[b] : -1;
      if (ph < 0) { lost.push(b); op += BLOCK; i++; continue; }
      let j = i + 1;
      while (j < blocks.length && j - i < 2048) {
        const pb = blocks[j];
        if (pb < 0 || pb >= this.allocBlocks || this.physOf[pb] !== ph + (j - i)) break;
        j++;
      }
      const want = Math.min((j - i) * BLOCK, size - op);
      out.set(await this.src.read(this.dataBase + ph * BLOCK, want), op);
      op += want;
      i = j;
    }
    return { data: out, lost };
  }

  async entries() {
    const blocks = [...this.chain(this.ftStart, this.ftBlocks, false)];
    const { data: raw } = await this.readBlocks(blocks, blocks.length * BLOCK);
    const out = [];
    for (let i = 0; i < raw.length; i += 0x40) {
      const nlen = raw[i + 0x28] & 0x3F;
      if (!nlen) continue;
      out.push({
        index: i / 0x40,
        name: String.fromCharCode(...raw.subarray(i, i + nlen)),
        dir: !!(raw[i + 0x28] & 0x80),
        consecutive: !!(raw[i + 0x28] & 0x40),
        blocks: u24le(raw, i + 0x29),
        start: u24le(raw, i + 0x2F),
        parent: (raw[i + 0x32] << 24 >> 16) | raw[i + 0x33],
        size: be32(raw, i + 0x34),
      });
    }
    const byIndex = new Map(out.map((e) => [e.index, e]));
    for (const e of out) {
      const parts = [e.name];
      let p = e;
      while (p.parent !== -1) {
        p = byIndex.get(p.parent);
        if (!p) throw new Error('broken STFS directory');
        parts.push(p.name);
      }
      e.path = parts.reverse().join('/');
    }
    return out;
  }

  async readFile(e) {
    const blocks = [...this.chain(e.start, e.blocks, e.consecutive)];
    return this.readBlocks(blocks, e.size);
  }
}
