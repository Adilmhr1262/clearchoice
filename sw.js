/* ClearChoice service worker — cache-first for the app shell, so the app opens offline. */
var CACHE = 'clearchoice-v1';
/* './' is scope-relative: on GitHub Pages the app lives under /clearchoice/,
   where the domain root '/' would 404 and fail installation. */
var FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(FILES); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  /* Navigation (including the directory URL /clearchoice/ on GitHub Pages):
     try the network, fall back to the cached app shell when offline. */
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match('index.html');
        });
      })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).catch(function () {
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});
