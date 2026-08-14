import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearSharePayload,
  readSharePayload,
  saveSharePayload,
} from '../../src/lib/share-target'

/** Minimal IndexedDB fake (jsdom has none) supporting the object-store API. */
function installFakeIndexedDb(): Map<string, unknown> {
  const data = new Map<string, unknown>()

  const fakeDb = {
    transaction: (): {
      objectStore: () => {
        get: (key: string) => { onsuccess: (() => void) | null; result: unknown }
        put: (value: unknown, key: string) => { result: undefined }
        delete: (key: string) => { result: undefined }
      }
      oncomplete: (() => void) | null
      onerror: (() => void) | null
    } => {
      const tx = {
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string) => {
            const request = { result: data.get(key), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }
            queueMicrotask(() => request.onsuccess?.())
            return request
          },
          put: (value: unknown, key: string) => {
            data.set(key, value)
            queueMicrotask(() => tx.oncomplete?.())
            return { result: undefined }
          },
          delete: (key: string) => {
            data.delete(key)
            queueMicrotask(() => tx.oncomplete?.())
            return { result: undefined }
          },
        }),
      }
      return tx
    },
    close: () => undefined,
  }

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        result: fakeDb,
        onupgradeneeded: null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
      }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  })

  return data
}

describe('share-target lib', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores, reads, and clears a share payload', async () => {
    const data = installFakeIndexedDb()
    const file = new File([new Uint8Array(4)], 'photo.png', { type: 'image/png' })

    await saveSharePayload({ files: [file], title: '来自分享', text: 'hello' })
    expect(data.size).toBe(1)

    const payload = await readSharePayload()
    expect(payload).not.toBeNull()
    expect(payload?.files).toHaveLength(1)
    expect(payload?.files[0].name).toBe('photo.png')
    expect(payload?.title).toBe('来自分享')

    await clearSharePayload()
    expect(data.size).toBe(0)
    expect(await readSharePayload()).toBeNull()
  })
})
