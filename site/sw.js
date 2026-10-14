// Offline support: the handful of files the page is made of, cached on install. The version
// below must match VERSION in js/app/main.js; a test checks that. Old caches go on activate.

const VERSION = '1.0.0';
const CACHE = `qr-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'favicon.svg',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'js/app/main.js',
  'js/app/ui.js',
  'js/app/actions.js',
  'js/app/logo.js',
  'js/app/state.js',
  'js/app/scannability.js',
  'js/qr/encode.js',
  'js/qr/tables.js',
  'js/qr/reed-solomon.js',
  'js/qr/segments.js',
  'js/qr/kanji.js',
  'js/qr/matrix.js',
  'js/qr/mask.js',
  'js/render/svg.js',
  'js/render/canvas.js',
  'js/render/text.js',
  'js/payload/escape.js',
  'js/payload/builders.js',
  'js/payload/inspect.js',
  'js/io/crc32.js',
  'js/io/png.js',
  'js/io/zip.js',
  'js/io/download.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Only the files listed above are served from the cache, and each is refreshed from the network
// for next time. Anything else goes straight to the network.
self.addEventListener('fetch', event => {
  const scope = self.registration.scope;
  const url = event.request.url.split(/[?#]/)[0];
  if (event.request.method !== 'GET' || !url.startsWith(scope))
    return;
  const path = url.slice(scope.length) || './';
  if (!FILES.includes(path))
    return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(path);
      const refresh = fetch(path, { cache: 'no-cache' }).then(response => {
        if (response.ok)
          event.waitUntil(cache.put(path, response.clone()));
        return response;
      }).catch(() => cached);
      return cached ?? refresh;
    }),
  );
});
