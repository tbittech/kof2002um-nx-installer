// Runs the build off the page's thread. Messages in: { type: 'open', file } | { type: 'open-folder', files },
// { type: 'plan', mode }, { type: 'write', port }. Messages out: progress, opened, planned, error, done.
import { TITLE_ID, openPackage, openFolder, planPack, packData, packIndex, zipSize, zipStream } from './lib/build.js';

const FOLDER = 'kof2002um-nx';
let source = null;
let plan = null;
let entries = null;
let release = null;

const post = (m) => self.postMessage(m);
const fail = (e) => post({ type: 'error', message: e && e.message ? e.message : String(e) });

function fileSource(file) {
  return { size: file.size, async read(o, n) { return new Uint8Array(await file.slice(o, o + n).arrayBuffer()); } };
}

async function loadRelease() {
  if (release) return release;
  const manifest = await (await fetch('./release/manifest.json', { cache: 'no-cache' })).json();
  const files = [];
  for (const f of manifest.files) {
    const r = await fetch(`./release/${f.name}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`release/${f.name}: HTTP ${r.status}`);
    const data = new Uint8Array(await r.arrayBuffer());
    if (data.length !== f.size) throw new Error(`release/${f.name}: ${data.length} bytes, ${f.size} expected`);
    files.push({ name: `${FOLDER}/${f.name}`, size: data.length, data });
  }
  release = { manifest, files };
  return release;
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'open' || m.type === 'open-folder') {
      plan = null;
      if (m.type === 'open') {
        post({ type: 'progress', stage: 'scan', value: 0 });
        source = await openPackage(fileSource(m.file), (v) => post({ type: 'progress', stage: 'scan', value: v }));
        if (source.info.titleId !== TITLE_ID) {
          throw new Error(`this package is title ${source.info.titleId} (${source.info.name || 'no name'}), not KOF 2002 UM (${TITLE_ID})`);
        }
      } else {
        source = openFolder(m.files.map((f) => ({
          path: f.path, size: f.file.size, read: async () => new Uint8Array(await f.file.arrayBuffer()),
        })));
      }
      const paths = new Set(source.files.map((f) => f.path));
      if (!paths.has('default.xex')) throw new Error('default.xex is not in it: this is not the game\'s package or folder');
      post({ type: 'opened', info: source.info, count: source.files.length });
    } else if (m.type === 'plan') {
      const rel = await loadRelease();
      if (m.mode === 'update') {
        entries = rel.files;
      } else {
        if (!source) throw new Error('choose the game first');
        if (!plan) plan = await planPack(source, (v, name) => post({ type: 'progress', stage: 'check', value: v, name }));
        const index = packIndex(plan);
        entries = [
          ...rel.files,
          { name: `${FOLDER}/game.nxidx`, size: index.length, data: index },
          { name: `${FOLDER}/game.nxpack`, size: plan.packSize, pack: true },
        ];
      }
      post({
        type: 'planned', mode: m.mode, size: zipSize(entries), version: rel.manifest.version,
        report: plan && m.mode !== 'update' ? plan.report : [], files: plan && m.mode !== 'update' ? plan.items.length : 0,
        missingNro: !rel.manifest.files.some((f) => f.name.endsWith('.nro')),
      });
    } else if (m.type === 'write') {
      await write(m.port);
    }
  } catch (e) {
    fail(e);
  }
};

// Feeds the zip to the download, one piece per 'pull' from the service worker (or the page's fallback).
async function write(port) {
  const list = entries.map((e) => (e.pack
    ? { ...e, data: packData(source, plan, (v, name) => post({ type: 'progress', stage: 'write', value: v, name })) }
    : e));
  const it = zipStream(list);
  const WANT = 4 << 20;
  let pending = [];
  let pendingSize = 0;
  let finished = false;
  const next = async () => {
    while (!finished && pendingSize < WANT) {
      const r = await it.next();
      if (r.done) { finished = true; break; }
      pending.push(r.value); pendingSize += r.value.length;
    }
    const out = new Uint8Array(pendingSize);
    let o = 0;
    for (const p of pending) { out.set(p, o); o += p.length; }
    pending = []; pendingSize = 0;
    return out;
  };
  port.onmessage = async ({ data }) => {
    if (data === 'cancel') { port.close(); post({ type: 'error', message: 'the download was cancelled' }); return; }
    if (finished && !pendingSize) return;
    try {
      const chunk = await next();
      if (chunk.length) port.postMessage({ chunk }, [chunk.buffer]);
      if (finished) { port.postMessage({ done: true }); post({ type: 'done' }); }
    } catch (e) {
      port.postMessage({ error: e.message });
      fail(e);
    }
  };
}
