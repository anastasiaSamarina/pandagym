// Service worker: делает приложение рабочим без сети.
// Стратегия: сначала пробуем сеть (всегда свежая версия), а если сети нет или она тормозит больше 4 секунд — отдаём из кэша.
// Запросы к GitHub API не кэшируем — данные хранятся в IndexedDB (см. js/store.js).
const CACHE = 'gym-v3'; // поменяй версию, если хочешь принудительно сбросить кэш у всех
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/jszip.min.js',
  'js/main.js', 'js/util.js', 'js/model.js', 'js/store.js', 'js/sync.js', 'js/xlsx-lite.js', 'js/excel-io.js',
  'js/charts.js', 'js/share.js', 'js/timer.js', 'js/view-main.js', 'js/view-workout.js', 'js/view-settings.js', 'js/media-ui.js', 'js/rest.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, { cache: 'no-cache', signal: ctrl.signal }); // no-cache: обойти HTTP-кэш браузера
      clearTimeout(timer);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: true });
      return cached || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }
  })());
});
