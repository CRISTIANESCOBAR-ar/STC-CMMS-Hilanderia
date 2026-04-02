const CACHE_NAME = 'cmms-cache-v7';

self.addEventListener('install', event => {
  // Activa el nuevo SW inmediatamente sin esperar que se cierren las pestañas.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Eliminar todos los caches de versiones anteriores
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    // Tomar control inmediato de todas las pestañas abiertas
    await self.clients.claim();
    // Recargar todos los clientes para que carguen la versión nueva
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => client.navigate(client.url));
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // NUNCA cachear el HTML (navegación) - siempre ir a la red.
  // Esto evita que el SW sirva una versión vieja de la app.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/index.html') || new Response('Sin conexión', { status: 503 }))
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
      .catch(() => caches.match(event.request).then(c => c || new Response('Sin conexión', { status: 503 })))
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
