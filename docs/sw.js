// Garde l'application disponible hors connexion. Les appels à Chess.com ne passent pas par le cache.
const CACHE = 'chess-analyzer-68e13e5c14';
const MAIA = 'chess-analyzer-maia-5m-v1'; // conservé d'une version à l'autre : 22 Mo à ne pas retélécharger
const FONTS = ['young-serif-400', 'instrument-sans-400', 'instrument-sans-500', 'instrument-sans-600', 'jetbrains-mono-400', 'jetbrains-mono-600'].map((f) => `fonts/${f}.woff2`);
const SF = ['sf/stockfish-19-lite-single.js', 'sf/stockfish-19-lite-single.wasm'];
const FILES = ['./', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', ...FONTS, ...SF];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// Le cache Maia ne garde que les gros fichiers figés (modèle, moteur ONNX) ; le code suit les versions.
const BIG = /\/maia\/(m\.onnx|ort-wasm[^/]*)$/;

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== MAIA).map((k) => caches.delete(k))))
    .then(() => caches.open(MAIA))
    .then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => !BIG.test(new URL(r.url).pathname)).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});

// Réseau d'abord pour la page, mais sans attendre plus de 3 s une connexion qui traîne.
function page(req) {
  const net = fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./', copy)); }
    return res;
  });
  const slow = new Promise((resolve) => { setTimeout(resolve, 3000); }).then(() => caches.match('./'));
  return Promise.race([net.catch(() => caches.match('./')), slow.then((hit) => hit || net)]);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/maia/')) {
    const name = BIG.test(url.pathname) ? MAIA : CACHE;
    e.respondWith(caches.open(name).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  if (e.request.mode === 'navigate') {
    e.respondWith(page(e.request));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
