// Offline support for the installed web app (GitHub Pages).
// Network first, so a new version shows up as soon as it is online; the cache is the fallback when offline.
const CACHE = 'dlab-v8';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './lib/three.module.min.js',
  './js/main.js', './js/world.js', './js/physics.js', './js/terrain.js', './js/fx.js', './js/audio.js', './js/textures.js', './js/weapons.js', './js/sfx.js', './js/duel.js', './js/crew.js'];
// cache: 'reload' skips the browser's HTTP cache, so the new version is not filled with old files
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // (a navigation request can't be re-fetched with options, so it goes by URL)
  const net = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(net.then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then(r => r || caches.match('./index.html'))));
});
