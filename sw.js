// Streams the zip the worker builds to a normal browser download, so a 1 GB file never has to fit in
// memory. The page registers { id, name, size, port }; a request to ./dl/<id>/<name> is answered with a
// stream that asks the worker for one piece per pull.
const streams = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.type === 'ping') { e.source && e.source.postMessage({ type: 'pong' }); return; }
  if (!m || m.type !== 'stream') return;
  streams.set(m.id, { name: m.name, size: m.size, port: e.ports[0] });
  e.source && e.source.postMessage({ type: 'registered', id: m.id });
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const at = url.pathname.indexOf('/dl/');
  if (at < 0) return;
  const id = url.pathname.slice(at + 4).split('/')[0];
  const s = streams.get(id);
  if (!s) return;
  streams.delete(id);
  const { port } = s;
  let wake = null;
  let controller = null;
  port.onmessage = ({ data }) => {
    if (data.chunk) controller.enqueue(data.chunk);
    if (data.done) controller.close();
    if (data.error) controller.error(new Error(data.error));
    if (wake) { const w = wake; wake = null; w(); }
  };
  const body = new ReadableStream({
    start(c) { controller = c; },
    pull() { return new Promise((resolve) => { wake = resolve; port.postMessage('pull'); }); },
    cancel() { port.postMessage('cancel'); },
  }, { highWaterMark: 1 });
  e.respondWith(new Response(body, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(s.size),
      'Content-Disposition': `attachment; filename="${s.name}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  }));
});
