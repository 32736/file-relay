/**
 * IndexedDB payload store for the Web Share Target flow: the service worker
 * receives a share-target POST, stashes the files here, and redirects to
 * `/?shared=1`; the app then reads the payload and feeds it to the upload
 * queue.
 */

const DB_NAME = 'drop-share'
const DB_VERSION = 1
const STORE_NAME = 'payload'
const KEY = 'pending'

export interface SharePayload {
  files: File[]
  title?: string
  text?: string
  url?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveSharePayload(payload: SharePayload): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(payload, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function readSharePayload(): Promise<SharePayload | null> {
  const db = await openDb()
  const value = await new Promise<SharePayload | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(KEY)
    request.onsuccess = () => resolve(request.result as SharePayload | undefined)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value ?? null
}

export async function clearSharePayload(): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
