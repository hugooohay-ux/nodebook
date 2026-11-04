// Service worker: makes Nodebook work offline and installable.
// The app's own files are cached on install. Every request is answered from the cache straight away and
// refreshed from the network in the background, so a new version shows up on the next open.
// Notes themselves live in IndexedDB, not here.
const CACHE = 'nodebook-v1';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'theme.js',
  'dialog.js',
  'example-vault.js',
  'storage.js',
  'inline-edit.js',
  'graph.js',
  'home.js',
  'renderer.js',
  'pwa.js',
  'vendor/marked.umd.js',
  'vendor/jszip.min.js',
  'vendor/editor.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Opening the app (any page load) is served by index.html — routes live in the #hash
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh); // refresh in the background
        return cached;
      }
      return fresh;
    })
  );
});
