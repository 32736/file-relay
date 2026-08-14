/**
 * Registers the app-shell service worker in production only. Dev workerd/HMR
 * must not compete with a caching worker. The env is injectable for tests.
 */
export function registerServiceWorker(env: { PROD: boolean } = import.meta.env): void {
  if (!env.PROD) return
  if (!('serviceWorker' in navigator)) return
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Registration failure must never break the app.
  })
}
