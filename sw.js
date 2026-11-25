// Cachea solo la app (HTML, JS, íconos). Los DXF y los cálculos nunca se guardan.
const CACHE = 'nesting-v3';
const ASSETS = [
  './',
  './index.html',
  './js/app.js',
  './js/dxf.js',
  './js/nester.js',
  './manifest.webmanifest',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // CDN de jsPDF: red normal
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
