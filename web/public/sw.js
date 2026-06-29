// Service Worker：导航/SPA 路由网络优先，静态资源缓存优先。
// SPA 路由走 networkFirst，确保用户始终加载最新 index.html 和 JS 包引用。
// 静态资源（/assets/*.js.css）走 cacheFirst（hash-versioned，不可变）。
const CACHE = 'moto-v2';
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
  const path = url.pathname;

  // API/动态路由走网络优先
  if (path.startsWith('/api/') || path.startsWith('/chat/') || path.startsWith('/auth/')) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // 静态资源（hash-versioned）走缓存优先
  if (path.startsWith('/assets/') || path.startsWith('/icon-')) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // SPA 导航路由、根路径等 → 网络优先（确保最新 index.html + JS 引用）
  // 回退到缓存用于离线支持
  e.respondWith(networkFirst(e.request));
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
