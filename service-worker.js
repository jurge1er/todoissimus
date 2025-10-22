const CACHE_NAME = 'todoissimus-cache-v11';
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

  // Never cache or intercept API calls; always go to network
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

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
    // Ensure updated app.js/styles.css are fetched when available (network-first)
    if (url.pathname === '/app.js' || url.pathname === '/styles.css') {
      event.respondWith(
        (async () => {
          // Normalize to pathname (ignore any ?v= cache-busters)
          const normalized = new Request(url.pathname, { headers: req.headers, mode: req.mode, credentials: 'same-origin' });
          try {
            const res = await fetch(normalized);
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(normalized, resClone)).catch(() => {});
            return res;
          } catch (e) {
            const cached = await caches.match(normalized);
            return cached || Promise.reject(e);
          }
        })()
      );
      return;
    }

    // Default: try exact request first, then normalized without query
    event.respondWith((async () => {
      const exact = await caches.match(req);
      if (exact) return exact;
      const noQ = await caches.match(new Request(url.pathname));
      return noQ || fetch(req);
    })());
  }
});

// Allow clients to tell this worker to activate immediately
self.addEventListener('message', (event) => {
  const data = event && event.data;
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
