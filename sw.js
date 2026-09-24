/* ---------------------------------------------------------------------------
   Offline support. The journal is a fixed set of static files, so the whole
   shell is cached on install and served cache-first: once the page has been
   opened, it works with no connection at all.

   Your trades are NOT here — they live in localStorage, which this service
   worker never touches. Clearing the cache costs you nothing but a re-download.
--------------------------------------------------------------------------- */
const CACHE = 'trading-journal-v2';
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

/*
 * Stale-while-revalidate: answer instantly from cache (so the app opens with
 * no connection), but always re-fetch in the background and store the result,
 * so the next open picks up a new version. Pure cache-first would pin a phone
 * to whatever it downloaded first, which is how a PWA gets stuck on a stale
 * build forever.
 */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;

  e.respondWith(caches.open(CACHE).then(cache =>
    cache.match(e.request).then(hit => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
        return res;
      }).catch(() => hit || cache.match('./index.html'));
      return hit || network;
    })
  ));
});
