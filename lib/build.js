// The whole job, independent of the browser: game source -> files of the game folder (XCTD decompressed)
// -> game.nxpack + game.nxidx (the SDK's PackDevice format, version 2, as tools/build_asset_pack.py writes it)
// -> a stored zip streamed in chunks.
import { Stfs } from './stfs.js';
import { isXctd, xctdDecompress } from './xctd.js';
import { Fnv64, crc32 } from './hash.js';

export const TITLE_ID = '584109AD';
const enc = new TextEncoder();

// A game source gives the list of files ({ path, size }) and their bytes.
export async function openPackage(src, progress) {
  const stfs = await Stfs.open(src, progress);
  const files = (await stfs.entries()).filter((e) => !e.dir);
  return {
    kind: 'package', stfs,
    info: { titleId: stfs.titleId, name: stfs.displayName, missing: stfs.missing, shifted: stfs.shifted },
    files: files.map((e) => ({ path: e.path, entry: e })),
    async read(f) { return stfs.readFile(f.entry); },
  };
}

// A folder already extracted from the package: [{ path, read(): Promise<Uint8Array> }].
export function openFolder(list) {
  return {
    kind: 'folder', info: {},
    files: list.map((f) => ({ path: f.path, src: f })),
    async read(f) { return { data: await f.src.read(), lost: [] }; },
  };
}

// File bytes as the game reads them on the 360: XCTD decompressed, the rest as is.
export async function gameFile(source, f, report) {
  const { data, lost } = await source.read(f);
  if (lost.length) report.push(`${f.path}: data blocks ${lost.join(', ')} missing from the package (zero-filled)`);
  if (!isXctd(data)) return data;
  try {
    const r = xctdDecompress(data);
    if (r.damaged.length) report.push(`${f.path}: XCTD blocks ${r.damaged.join(', ')} did not decompress (zero-filled)`);
    return r.data;
  } catch (e) {
    report.push(`${f.path}: XCTD container not readable (${e.message}), copied as is`);
    return data;
  }
}

function validPath(p) {
  if (!p || p.startsWith('/') || p.endsWith('/')) return false;
  return p.split('/').every((s) => s && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes(':'));
}

const cmpBytes = (a, b) => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
};

// Pass 1: decompress everything once to learn the sizes and the data checksum the pack header needs.
export async function planPack(source, progress = () => {}) {
  const report = [];
  const items = source.files.map((f) => ({ f, rel: enc.encode(f.path), size: 0, offset: 0 }));
  for (const it of items) if (!validPath(it.f.path)) throw new Error(`invalid path for the pack: ${it.f.path}`);
  items.sort((a, b) => cmpBytes(a.rel, b.rel));
  const data = new Fnv64();
  let done = 0;
  for (const it of items) {
    const bytes = await gameFile(source, it.f, report);
    it.size = bytes.length;
    data.update(bytes);
    progress(++done / items.length, it.f.path);
  }
  let packSize = 40, pathsSize = 0;
  const id = new Fnv64();
  for (const it of items) {
    packSize = Math.ceil(packSize / 16) * 16;
    it.offset = packSize;
    packSize += it.size;
    pathsSize += it.rel.length + 1;
    id.update(it.rel);
    id.update(u64(it.size));
  }
  if (packSize >= 4 * 2 ** 30) throw new Error('the pack would be over the FAT32 4 GB file limit');
  id.update(crypto.getRandomValues(new Uint8Array(8)));
  if (id.isZero()) id.lo = 1;
  return { items, packSize, pathsSize, packId: id.bytes(), dataChecksum: data.bytes(), report };
}

function u64(n) {
  const b = new Uint8Array(8);
  const v = new DataView(b.buffer);
  v.setUint32(0, n % 2 ** 32, true); v.setUint32(4, Math.floor(n / 2 ** 32), true);
  return b;
}
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export function packHeader(plan) {
  return cat(enc.encode('SSNXPAK1'), u32(2), u32(0), plan.packId, u64(plan.packSize), plan.dataChecksum);
}

export function packIndex(plan) {
  const entries = [], paths = [];
  let po = 0;
  for (const it of plan.items) {
    entries.push(u64(it.offset), u64(it.size), u32(po), u32(it.rel.length));
    paths.push(it.rel, new Uint8Array(1));
    po += it.rel.length + 1;
  }
  const e = cat(...entries), p = cat(...paths);
  const checksum = new Fnv64().update(e).update(p).bytes();
  return cat(enc.encode('SSNXIDX1'), u32(2), u32(plan.items.length), plan.packId, u64(plan.packSize),
    u64(plan.pathsSize), checksum, plan.dataChecksum, e, p);
}

// Pass 2: the pack's bytes, in pieces. Checks that the data matches pass 1.
export async function* packData(source, plan, progress = () => {}) {
  yield packHeader(plan);
  let pos = 40, done = 0;
  const check = new Fnv64();
  for (const it of plan.items) {
    if (it.offset > pos) { yield new Uint8Array(it.offset - pos); pos = it.offset; }
    const bytes = await gameFile(source, it.f, []);
    if (bytes.length !== it.size) throw new Error(`${it.f.path} changed size between the two passes`);
    check.update(bytes);
    yield bytes;
    pos += bytes.length;
    progress(++done / plan.items.length, it.f.path);
  }
  const want = plan.dataChecksum;
  const got = check.bytes();
  if (want.some((b, i) => b !== got[i])) throw new Error('the game data read differently in the second pass');
}

// --- Stored zip (no compression), with data descriptors for the CRC ------------------------------------
const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;

export function zipSize(entries) {
  // entries: [{ name, size }]
  let n = 0;
  for (const e of entries) n += 30 + enc.encode(e.name).length + e.size + 16 + 46 + enc.encode(e.name).length;
  return n + 22;
}

// entries: [{ name, size, data: AsyncIterable<Uint8Array> | Uint8Array }]
export async function* zipStream(entries) {
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const local = cat(u32(0x04034b50), u16(20), u16(0x0808), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(0), u32(e.size), u32(e.size), u16(name.length), u16(0), name);
    yield local;
    let crc = 0, written = 0;
    const parts = e.data instanceof Uint8Array ? [e.data] : e.data;
    for await (const piece of parts) {
      crc = crc32(piece, crc);
      written += piece.length;
      yield piece;
    }
    if (written !== e.size) throw new Error(`${e.name}: ${written} bytes written, ${e.size} expected`);
    yield cat(u32(0x08074b50), u32(crc), u32(e.size), u32(e.size));
    central.push(cat(u32(0x02014b50), u16(20), u16(20), u16(0x0808), u16(0), u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(e.size), u32(e.size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name));
    offset += local.length + e.size + 16;
  }
  const cd = cat(...central);
  if (offset + cd.length > 0xFFFFFFFF) throw new Error('the zip would be over 4 GB');
  yield cd;
  yield cat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(cd.length), u32(offset), u16(0));
}
function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
