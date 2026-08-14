// Drop service worker: offline app shell with network-first strategy, plus the
// Web Share Target receiver (Chromium): a POST to "/" carries shared files as
// multipart form data; we stash them in IndexedDB and redirect to "/?shared=1"
// where the app feeds them into the upload queue.
// API requests (/api/*) are never cached.

const SHELL_CACHE = 'drop-shell-v1'
const SHARE_DB = 'drop-share'
const SHARE_STORE = 'payload'
const SHARE_KEY = 'pending'

function openShareDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARE_DB, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SHARE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function storeSharePayload(payload) {
  return openShareDb().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SHARE_STORE, 'readwrite')
      tx.objectStore(SHARE_STORE).put(payload, SHARE_KEY)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    })
  })
}

async function handleShareTarget(request) {
  const form = await request.formData()
  const files = form.getAll('files').filter((entry) => entry instanceof File)
  if (files.length === 0) {
    return new Response('No files shared', { status: 400 })
  }
  await storeSharePayload({
    files,
    title: form.get('title') || undefined,
    text: form.get('text') || undefined,
    url: form.get('url') || undefined,
  })
  return Response.redirect('/?shared=1', 303)
}

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

  // Web Share Target: POST to the manifest action ("/").
  if (request.method === 'POST' && url.pathname === '/') {
    event.respondWith(handleShareTarget(request))
    return
  }

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
