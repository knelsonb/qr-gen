// Offline support. Every file the page is made of is fetched once at install, under a cache
// named for the version, and served from there. A new version is a new sw.js, which the
// browser fetches fresh on each visit; its install replaces the whole set at once, so a visitor
// never gets new HTML with old scripts. The version must match VERSION in js/app/main.js; a
// test checks that, and the deploy script stamps both with the commit being served.

const VERSION = '1.2.0';
const CACHE = `qr-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'favicon.svg',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'fonts/BrewsterTechnical-Regular.woff2',
  'fonts/BrewsterTechnicalMono-Regular.woff2',
  'js/app/main.js',
  'js/app/counter.js',
  'js/app/ui.js',
  'js/app/actions.js',
  'js/app/export.js',
  'js/app/model.js',
  'js/app/dom.js',
  'js/app/logo.js',
  'js/app/icons.js',
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
  'js/render/logo.js',
  'js/render/canvas.js',
  'js/render/text.js',
  'js/payload/escape.js',
  'js/payload/builders.js',
  'js/payload/inspect.js',
  'js/payload/detect.js',
  'js/io/crc32.js',
  'js/io/png.js',
  'js/io/zip.js',
  'js/io/download.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(FILES.map(file => new Request(file, { cache: 'no-cache' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Only the files listed above are served from the cache; anything else goes to the network.
self.addEventListener('fetch', event => {
  const scope = self.registration.scope;
  const url = event.request.url.split(/[?#]/)[0];
  if (event.request.method !== 'GET' || !url.startsWith(scope))
    return;
  const path = url.slice(scope.length) || './';
  if (!FILES.includes(path))
    return;
  event.respondWith(caches.open(CACHE).then(cache => cache.match(path).then(cached => cached ?? fetch(event.request))));
});
