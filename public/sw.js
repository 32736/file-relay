// Drop service worker: offline app shell with network-first strategy.
// API requests (/api/*) are never cached; everything else falls back to the
// cached navigation shell when offline.

const SHELL_CACHE = 'drop-shell-v1'

self.addEventListener('install', (event) => {
  // Take over as soon as possible so the shell is ready for the next load.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // Same-origin only; never touch API or devtool endpoints.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (request.method !== 'GET') return

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (response.ok && url.pathname === '/') {
          const cache = await caches.open(SHELL_CACHE)
          await cache.put(request, response.clone())
        }
        return response
      } catch {
        // Offline: serve the cached shell for navigation; other assets rely
        // on being reachable once the shell is up.
        const cache = await caches.open(SHELL_CACHE)
        const cached = await cache.match('/')
        if (cached) return cached
        return new Response('Offline', { status: 503, statusText: 'Offline' })
      }
    })(),
  )
})
