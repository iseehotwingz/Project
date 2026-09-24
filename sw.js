/* ---------------------------------------------------------------------------
   Offline support. The journal is a fixed set of static files, so the whole
   shell is cached on install and served cache-first: once the page has been
   opened, it works with no connection at all.

   Your trades are NOT here — they live in localStorage, which this service
   worker never touches. Clearing the cache costs you nothing but a re-download.
--------------------------------------------------------------------------- */
const CACHE = 'trading-journal-v1';
const SHELL = [
  './', './index.html', './styles.css',
  './js/util.js', './js/store.js', './js/calc.js', './js/charts.js',
  './js/csv.js', './js/demo.js', './js/app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  // addAll fails the whole install if any file 404s, so tolerate misses.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      // Keep the cache warm for same-origin assets fetched later.
      if (res && res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
