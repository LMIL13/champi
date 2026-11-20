// Service worker : appli disponible hors réseau + cache des fonds de carte et photos déjà vus.
const APP = 'cueillette-app-v1', TILES = 'cueillette-tuiles-v1', MAX_TILES = 3000;
const LOCAL = ['./', 'index.html', 'app.js', 'especes.js', 'lieux.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'leaflet/leaflet.js', 'leaflet/leaflet.css', 'leaflet/images/layers.png', 'leaflet/images/layers-2x.png'];
const CDN = [];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(APP);
    await c.addAll(LOCAL);
    for (const u of CDN) { try { await c.add(new Request(u, {mode: 'cors'})); } catch (x) {} }
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![APP, TILES].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = u => u.hostname === 'data.geopf.fr' || u.hostname.endsWith('tile.openstreetmap.org') || u.hostname === 'upload.wikimedia.org';
async function trim() { const c = await caches.open(TILES), k = await c.keys(); for (let i = 0; i < k.length - MAX_TILES; i++) await c.delete(k[i]); }

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isTile(u)) {
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(req.url);
      if (hit) return hit;
      try {
        // requête CORS pour obtenir une réponse lisible (les réponses opaques gonflent le quota de stockage)
        const r = await fetch(req.url, {mode: 'cors', credentials: 'omit'});
        if (r.ok) { c.put(req.url, r.clone()).then(trim); }
        return r;
      } catch (x) {
        try { return await fetch(req); } catch (y) { return new Response('', {status: 504}); }
      }
    })());
    return;
  }
  if (u.hostname.endsWith('wikipedia.org')) { // fiches espèces : réseau d'abord
    e.respondWith(fetch(req).then(r => { const cl = r.clone(); caches.open(TILES).then(c => c.put(req, cl)); return r; }).catch(() => caches.match(req)));
    return;
  }
  if (u.origin === location.origin || u.hostname.endsWith('googleapis.com') || u.hostname.endsWith('gstatic.com')) {
    e.respondWith((async () => {
      const c = await caches.open(APP), hit = await c.match(req, {ignoreSearch: u.origin === location.origin});
      const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
});
