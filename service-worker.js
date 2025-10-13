const CACHE_NAME = 'todoissimus-cache-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve(true)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Cache-first for same-origin navigations and static assets
  if (url.origin === location.origin) {
    // Ensure navigations (HTML) always get latest content (network-first)
    if (req.mode === 'navigate' || req.destination === 'document' || url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req))
      );
      return;
    }
    // Ensure updated app.js is fetched when available (network-first)
    if (url.pathname === '/app.js' || url.pathname === '/styles.css') {
      event.respondWith(
        fetch(req)
          .then((res) => {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req))
      );
      return;
    }

    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
  }
});

// Allow clients to tell this worker to activate immediately
self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
