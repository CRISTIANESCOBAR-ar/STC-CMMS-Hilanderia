const CACHE_NAME = 'cmms-cache-v2';

self.addEventListener('install', event => {
  // Comentado intencionalmente: NO usar self.skipWaiting() aquí.
  // Esto permite que el Service Worker pase al estado "waiting", 
  // lo cual detona el evento en LoginView para mostrar el cartel verde de "Actualización Disponible".
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
    // Tomar control inmediato de las pestañas existentes para servir la nueva versión
    if (self.clients && self.clients.claim) {
      await self.clients.claim();
    }
  })());
});

self.addEventListener('fetch', event => {
  // Estrategia: Network First para index.html y assets
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
