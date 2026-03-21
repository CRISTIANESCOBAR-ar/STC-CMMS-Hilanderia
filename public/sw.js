const CACHE_NAME = 'cmms-cache-v2';

self.addEventListener('install', event => {
  // Comentado intencionalmente: NO usar self.skipWaiting() aquí.
  // Esto permite que el Service Worker pase al estado "waiting", 
  // lo cual detona el evento en LoginView para mostrar el cartel verde de "Actualización Disponible".
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(['/', '/index.html']).catch(() => {
      // En entornos con red inestable no queremos abortar la instalacion del SW.
    });
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    // Tomar control inmediato de las pestañas existentes para servir la nueva versión
    if (self.clients && self.clients.claim) {
      await self.clients.claim();
    }
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Estrategia: Network First con fallback robusto.
  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, networkResponse.clone()).catch(() => {});
      return networkResponse;
    } catch (error) {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;

      if (event.request.mode === 'navigate') {
        const appShell = await caches.match('/index.html');
        if (appShell) return appShell;
      }

      return new Response('Sin conexion', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
