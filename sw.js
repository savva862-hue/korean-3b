/* Korean 3B service worker */
const CACHE = 'k3b-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './audiogen.js',
  './data.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/logo.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}).then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  const url = new URL(req.url);
  // audio: cache-first, then network, cache the result
  if(url.pathname.includes('/audio/')){
    e.respondWith(
      caches.match(req).then(hit=> hit || fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
        return res;
      }).catch(()=>hit))
    );
    return;
  }
  // app shell: cache-first with network fallback
  e.respondWith(
    caches.match(req).then(hit=> hit || fetch(req).then(res=>{
      if(res && res.status===200 && url.origin===location.origin){
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});
      }
      return res;
    }).catch(()=>caches.match('./index.html')))
  );
});
