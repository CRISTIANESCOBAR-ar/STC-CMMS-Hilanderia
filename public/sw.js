const CACHE_NAME = 'cmms-cache-v14';

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
    // NO se usa client.navigate() — es bloqueado por COOP policy.
    // El usuario verá la versión nueva en la próxima carga normal.
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // NUNCA cachear el HTML (navegación) - siempre ir a la red.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cached = await caches.match('/index.html');
        return cached || new Response('Sin conexión', { status: 503 });
      })
    );
    return;
  }

  // Assets con hash inmutables (/assets/xxx-HASH.js) → Cache First
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
          return resp;
        });
      })
    );
    return;
  }

  // Todo lo demás: Network First
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone)).catch(() => {});
        return resp;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        return cached || new Response('Sin conexión', { status: 503 });
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
