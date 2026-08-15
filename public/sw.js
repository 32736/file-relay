// Drop service worker: offline app shell with network-first strategy, plus the
// Web Share Target receiver (Chromium): a POST to "/" carries shared files as
// multipart form data; we stash them in IndexedDB and redirect to "/?shared=1"
// where the app feeds them into the upload queue.
// API requests (/api/*) are never cached.

const SHELL_CACHE = 'drop-shell-v2'
const STATIC_ASSET_PATHS = new Set(['/logo.svg', '/manifest.webmanifest'])
const PRECACHE_URLS = ['/', '/logo.svg', '/manifest.webmanifest']
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
    return new Response('没有可分享的文件', { status: 400 })
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
  // Cache the minimal shell before taking control so offline startup does not
  // need a second network round trip for the brand and PWA metadata.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE_URLS)
      await self.skipWaiting()
    })(),
  )
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

  const isStaticAsset = url.pathname.startsWith('/assets/') || STATIC_ASSET_PATHS.has(url.pathname)
  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE)
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) await cache.put(request, response.clone())
        return response
      })(),
    )
    return
  }

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
        return new Response('当前处于离线状态', { status: 503, statusText: '当前处于离线状态' })
      }
    })(),
  )
})
