// Cachea la app como respaldo offline. Intenta siempre la red primero para que las
// actualizaciones lleguen. Los DXF y los cálculos nunca se guardan.
const CACHE = 'nesting-v7';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/dxf.js',
  './js/nester.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // jsPDF desde CDN: red normal
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
