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

// Same-origin files come from the cache, with the network copy refreshing it for next time.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin)
    return;
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      const refresh = fetch(event.request).then(response => {
        if (response.ok)
          cache.put(event.request, response.clone());
        return response;
      }).catch(() => cached);
      return cached ?? refresh;
    }),
  );
});
