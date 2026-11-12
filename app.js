const $ = (id) => document.getElementById(id);
const worker = new Worker('./worker.js', { type: 'module' });
const LANG_KEY = 'kof2002um-nx.lang';

const ES = {
  lead: 'Arma el paquete de Nintendo Switch de The King of Fighters 2002 Unlimited Match a partir de tu propia copia de Xbox 360. Todo corre en este navegador.',
  s1: 'Elegí tu copia',
  package: 'Paquete XBLA',
  packageHint: 'El archivo dentro de Content/0000000000000000/584109AD/000D0000/ (un nombre hexadecimal largo).',
  folder: 'Carpeta extraída',
  folderHint: 'La carpeta con default.xex y data/, ya extraída del paquete.',
  own: '<b>Necesitás tu propia copia del juego.</b> El instalador la lee para armar game.nxpack y game.nxidx; no aporta ningún dato del juego.',
  nothing: 'Todavía no elegiste nada.',
  s2: 'Creá el paquete',
  fullText: 'Para la primera instalación, creá el paquete completo (los datos del juego se leen dos veces: una para comprobarlos y otra para escribirlos):',
  create: 'Crear kof2002um-nx.zip',
  updateText: 'Si el juego ya está instalado y solo querés el .nro y el .toml nuevos:',
  update: 'Crear kof2002um-nx-update.zip',
  s3: 'Copialo a la Switch',
  step1: 'Descomprimí el .zip descargado y copiá la carpeta kof2002um-nx en sdmc:/switch/ (queda sdmc:/switch/kof2002um-nx/).',
  step2: 'Abrí kof2002um-nx.nro desde el Homebrew Menu en modo título (mantené R al abrir un juego instalado) o con un forwarder. En modo applet (Álbum) el juego no tiene memoria suficiente.',
  source: 'Código fuente',
  legal: 'The King of Fighters es una marca de SNK Corporation. kof2002um-nx es un proyecto de fans no oficial, sin relación con SNK, Nintendo ni Microsoft. Este sitio no aloja datos ni ejecutables del juego: tu paquete o carpeta se lee solo dentro de tu navegador, nunca se sube, y sus archivos van directo al .zip que se guarda en tu computadora.',
};
const MSG = {
  en: {
    scan: 'Reading the package', check: 'Checking the game data', write: 'Writing the zip',
    opened: (n, name) => `${name}: ${n} files found.`, folderOpened: (n) => `Folder: ${n} files.`,
    missing: (b) => `The package is missing ${b} data block(s); the affected files are zero-filled where needed (see the log).`,
    ready: (size) => `Ready. The download (${size}) starts now; keep this tab open until it finishes.`,
    done: 'Done. The zip is in your downloads.', noNro: 'Note: this site does not have the .nro yet, so the zip only carries the game data and the .toml. Get kof2002um-nx.nro from the releases page and put it in the same folder.',
    noSw: 'Your browser cannot stream the download, so the zip is built in memory (it needs about as much free RAM as the zip size).',
    chooseWarn: 'Choose the package file or the extracted folder.',
  },
  es: {
    scan: 'Leyendo el paquete', check: 'Comprobando los datos del juego', write: 'Escribiendo el zip',
    opened: (n, name) => `${name}: ${n} archivos encontrados.`, folderOpened: (n) => `Carpeta: ${n} archivos.`,
    missing: (b) => `Al paquete le faltan ${b} bloque(s) de datos; los archivos afectados se rellenan con ceros donde hace falta (ver el registro).`,
    ready: (size) => `Listo. La descarga (${size}) empieza ahora; dejá esta pestaña abierta hasta que termine.`,
    done: 'Terminado. El zip está en tus descargas.', noNro: 'Ojo: este sitio todavía no tiene el .nro, así que el zip solo trae los datos del juego y el .toml. Bajá kof2002um-nx.nro de la página de releases y ponelo en la misma carpeta.',
    noSw: 'Tu navegador no puede hacer la descarga por streaming, así que el zip se arma en memoria (hace falta tanta RAM libre como pesa el zip).',
    chooseWarn: 'Elegí el archivo del paquete o la carpeta extraída.',
  },
};

const EN = {};
document.querySelectorAll('[data-t]').forEach((el) => { EN[el.dataset.t] = el.innerHTML; });
let lang = 'en';
try { lang = localStorage.getItem(LANG_KEY) || (navigator.language.startsWith('es') ? 'es' : 'en'); } catch { /* no storage */ }
let chosenText = null;
function setLang(l) {
  lang = l === 'es' ? 'es' : 'en';
  document.documentElement.lang = lang;
  const dict = lang === 'es' ? ES : EN;
  document.querySelectorAll('[data-t]').forEach((el) => { if (dict[el.dataset.t]) el.innerHTML = dict[el.dataset.t]; });
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  if (chosenText) $('chosen').textContent = chosenText();
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* no storage */ }
}
const msg = () => MSG[lang];
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
setLang(lang);

const fmt = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GB` : `${(n / 2 ** 20).toFixed(1)} MB`);
const log = (line) => { const box = $('log'); box.hidden = false; box.textContent += `${line}\n`; box.scrollTop = box.scrollHeight; };
let busy = false;
const setBusy = (b) => { busy = b; $('create').disabled = b || !ready; $('update').disabled = b; $('pickPackage').disabled = b; $('pickFolder').disabled = b; };
let ready = false;
let startedAt = 0;

function progress(stage, value, name) {
  $('progressBox').hidden = false;
  $('bar').style.width = `${Math.round(value * 1000) / 10}%`;
  const eta = value > 0.02 && startedAt ? Math.round(((Date.now() - startedAt) / value) * (1 - value) / 1000) : null;
  $('progressText').textContent = `${msg()[stage]}… ${Math.floor(value * 100)} %${eta !== null ? ` · ~${eta} s` : ''}${name ? ` · ${name}` : ''}`;
}

// Service worker for the streamed download.
let swReady = null;
if ('serviceWorker' in navigator && window.isSecureContext) {
  swReady = navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).catch(() => null);
}
// Chrome stops an idle service worker after ~30 s (and caps one event at 5 min); the zip data reaches it
// through a MessageChannel, which does not count as activity, so a long write got cut short. A message
// event every 10 s keeps it alive for the whole download (same trick as StreamSaver.js).
let keepAlive = null;
function startKeepAlive() {
  stopKeepAlive();
  keepAlive = setInterval(() => { const c = navigator.serviceWorker.controller; if (c) c.postMessage({ type: 'ping' }); }, 10000);
}
function stopKeepAlive() { if (keepAlive) { clearInterval(keepAlive); keepAlive = null; } }
async function streamTarget(name, size) {
  const reg = swReady && (await swReady);
  if (!reg || !navigator.serviceWorker.controller) return null;
  const id = crypto.getRandomValues(new Uint32Array(2)).join('');
  const ch = new MessageChannel();
  const registered = new Promise((resolve) => {
    const on = (e) => { if (e.data && e.data.type === 'registered' && e.data.id === id) { navigator.serviceWorker.removeEventListener('message', on); resolve(); } };
    navigator.serviceWorker.addEventListener('message', on);
  });
  navigator.serviceWorker.controller.postMessage({ type: 'stream', id, name, size }, [ch.port1]);
  await registered;
  return { port: ch.port2, url: new URL(`./dl/${id}/${encodeURIComponent(name)}`, location.href).href };
}

// Fallback: pull the whole zip into a Blob.
function memoryTarget(name) {
  const ch = new MessageChannel();
  const parts = [];
  ch.port1.onmessage = ({ data }) => {
    if (data.chunk) parts.push(data.chunk);
    if (data.error) return;
    if (data.done) {
      if (location.hash === '#selftest') {
        log(`selftest (memory): ${parts.reduce((s, p) => s + p.length, 0)} bytes`);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type: 'application/zip' }));
      a.download = name;
      a.click();
      return;
    }
    ch.port1.postMessage('pull');
  };
  return { port: ch.port2, start: () => ch.port1.postMessage('pull') };
}

let pendingName = null;
async function build(mode) {
  if (busy) return;
  setBusy(true);
  pendingName = mode === 'update' ? 'kof2002um-nx-update.zip' : 'kof2002um-nx.zip';
  startedAt = Date.now();
  worker.postMessage({ type: 'plan', mode });
}

worker.onmessage = async ({ data: m }) => {
  if (m.type === 'progress') { progress(m.stage, m.value, m.name); return; }
  if (m.type === 'error') {
    stopKeepAlive();
    setBusy(false);
    $('progressText').textContent = `Error: ${m.message}`;
    log(`Error: ${m.message}`);
    return;
  }
  if (m.type === 'opened') {
    setBusy(false);
    ready = true;
    $('create').disabled = false;
    const i = m.info;
    chosenText = () => (i.titleId ? msg().opened(m.count, i.name || i.titleId) : msg().folderOpened(m.count));
    $('chosen').textContent = chosenText();
    $('progressBox').hidden = true;
    if (i.missing && i.missing.length) log(msg().missing(i.missing.length));
    return;
  }
  if (m.type === 'planned') {
    for (const line of m.report) log(line);
    if (m.missingNro && m.mode !== 'update') log(msg().noNro);
    startedAt = Date.now();
    let target = await streamTarget(pendingName, m.size);
    if (target) {
      startKeepAlive();
      worker.postMessage({ type: 'write', port: target.port }, [target.port]);
      if (location.hash === '#selftest') {
        // Reads the streamed zip without saving it (for testing the page).
        const r = await fetch(target.url);
        const reader = r.body.getReader();
        let n = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; }
        log(`selftest: ${n} bytes streamed, Content-Length ${r.headers.get('Content-Length')}`);
        return;
      }
      const frame = document.createElement('iframe');
      frame.hidden = true;
      frame.src = target.url;
      document.body.appendChild(frame);
    } else {
      log(msg().noSw);
      target = memoryTarget(pendingName);
      worker.postMessage({ type: 'write', port: target.port }, [target.port]);
      target.start();
    }
    $('progressText').textContent = msg().ready(fmt(m.size));
    return;
  }
  if (m.type === 'done') {
    stopKeepAlive();
    setBusy(false);
    $('bar').style.width = '100%';
    $('progressText').textContent = msg().done;
  }
};

$('pickPackage').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  ready = false; setBusy(true); $('log').textContent = ''; $('log').hidden = true;
  chosenText = () => file.name;
  $('chosen').textContent = file.name;
  startedAt = Date.now();
  worker.postMessage({ type: 'open', file });
});
$('pickFolder').addEventListener('change', (e) => {
  const list = [...e.target.files];
  if (!list.length) return;
  // Paths relative to the folder that holds default.xex.
  const xex = list.find((f) => /(^|\/)default\.xex$/i.test(f.webkitRelativePath));
  const root = xex ? xex.webkitRelativePath.slice(0, -'default.xex'.length) : '';
  const files = list.filter((f) => f.webkitRelativePath.startsWith(root))
    .map((f) => ({ path: f.webkitRelativePath.slice(root.length), file: f }));
  ready = false; setBusy(true); $('log').textContent = ''; $('log').hidden = true;
  worker.postMessage({ type: 'open-folder', files });
});
$('create').addEventListener('click', () => build('full'));
$('update').addEventListener('click', () => build('update'));

fetch('./release/manifest.json', { cache: 'no-cache' }).then((r) => r.json()).then((mf) => {
  $('updateBox').hidden = !mf.files.some((f) => f.name.endsWith('.nro'));
}).catch(() => {});
