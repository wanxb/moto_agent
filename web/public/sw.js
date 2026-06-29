// Service Worker：静态资源缓存优先，API 请求网络优先。
// 用户添加至主屏幕后，即使断网也能打开页面看到历史对话。
const CACHE = 'moto-v1';
const PRECACHE = ['/', '/chat', '/login', '/settings', '/dashboard'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API/动态路由走网络优先，静态资源走缓存优先
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/chat/') || url.pathname.startsWith('/auth/')) {
    e.respondWith(networkFirst(e.request));
  } else {
    e.respondWith(cacheFirst(e.request));
  }
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  return hit ?? fetch(req);
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    const ct = res.headers.get('content-type') || '';
    if (res.ok && (ct.includes('text') || ct.includes('json'))) {
      const cache = await caches.open(CACHE);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const fallback = await caches.match(req);
    return fallback ?? new Response('offline', { status: 503 });
  }
}
