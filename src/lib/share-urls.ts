/**
 * Local cache of created share URLs (owner convenience). The raw share token
 * appears only once in the creation response (the server stores its hash), so
 * the URL cannot be rebuilt from the list API — this cache is the only way to
 * recover a link on this device. Stored in localStorage; cleared with site
 * data and never sent anywhere.
 */

const STORAGE_KEY = 'drop-share-urls'

export function saveShareUrl(id: string, url: string): void {
  try {
    const cache = loadShareUrls()
    cache[id] = url
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // storage unavailable — the link simply won't be recoverable later
  }
}

/** id → share URL, for the share list's copy button. */
export function loadShareUrls(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}
