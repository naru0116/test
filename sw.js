// サービスワーカー: オフラインでも遊べるように、アプリのファイルを端末に保存する。
// オンラインのときは常にネットワークの最新版を使い（network-first）、取れないときだけ保存分を使う。
const CACHE = 'beppan-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css',
  'js/main.js', 'js/game.js', 'js/cpu.js', 'js/online.js', 'js/db.js', 'js/art.js', 'js/world-map.js',
  'js/routemap.js', 'js/camera.js', 'js/sfx.js', 'js/music.js', 'js/features.js', 'js/firebase-config.js',
  'assets/operations-atlas.webp', 'assets/operation-nightfall.webp',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部（フォントなど）はブラウザに任せる
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }
  })());
});
