// Service worker: делает приложение рабочим без сети.
// Стратегия: файлы приложения отдаём из кэша сразу, а в фоне обновляем (при следующем открытии будет свежая версия).
// Запросы к GitHub API не кэшируем — данные хранятся в IndexedDB (см. js/store.js).
const CACHE = 'gym-v1'; // поменяй версию, если хочешь принудительно сбросить кэш у всех
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'vendor/jszip.min.js',
  'js/main.js', 'js/util.js', 'js/model.js', 'js/store.js', 'js/sync.js', 'js/xlsx-lite.js', 'js/excel-io.js',
  'js/charts.js', 'js/share.js', 'js/timer.js', 'js/view-main.js', 'js/view-workout.js', 'js/view-settings.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }));
});
