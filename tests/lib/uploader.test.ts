import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AbortUploadError,
  HttpError,
  isRetryable,
  uploadFileCore,
  withRetry,
  type UploadSessionInfo,
} from '../../src/lib/uploader'

class MockXhr {
  static instances: MockXhr[] = []
  static nextStatus = 200
  static autoRespond = true

  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn(() => {
    if (MockXhr.autoRespond) this.fireLoad(MockXhr.nextStatus)
  })
  upload: { onprogress: ((event: { loaded: number; lengthComputable: boolean }) => void) | null } = {
    onprogress: null,
  }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 200
  responseText = ''

  constructor() {
    MockXhr.instances.push(this)
  }

  abort(): void {
    this.onabort?.()
  }

  fireProgress(loaded: number): void {
    this.upload.onprogress?.({ loaded, lengthComputable: true })
  }

  fireLoad(status: number, text = ''): void {
    this.status = status
    this.responseText = text
    this.onload?.()
  }
}

function stubXhr(status = 200): typeof MockXhr {
  MockXhr.instances = []
  MockXhr.nextStatus = status
  MockXhr.autoRespond = true
  vi.stubGlobal('XMLHttpRequest', MockXhr)
  return MockXhr
}

function blobOf(size: number): Blob & { name: string } {
  return Object.assign(new Blob([new Uint8Array(size)]), { name: 'file.bin' })
}

describe('uploader lib', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('classifies retryable statuses per plan §39', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isRetryable(status)).toBe(true)
    }
    for (const status of [400, 401, 403, 404, 413]) {
      expect(isRetryable(status)).toBe(false)
    }
  })

  it('withRetry retries transient failures and then succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw new HttpError(500, 'boom')
        return 'ok'
      },
      { retries: 3, delayMs: 0 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('withRetry does not retry non-retryable errors', async () => {
    await expect(
      withRetry(
        async () => {
          throw new HttpError(400, 'bad request')
        },
        { retries: 3, delayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(HttpError)
  })

  it('withRetry aborts immediately on AbortUploadError', async () => {
    await expect(
      withRetry(
        async () => {
          throw new AbortUploadError()
        },
        { retries: 3, delayMs: 0 },
      ),
    ).rejects.toBeInstanceOf(AbortUploadError)
  })

  it('uploads single-mode files through the content endpoint', async () => {
    stubXhr(200)
    MockXhr.autoRespond = false
    const file = blobOf(1024)
    const session: UploadSessionInfo = { uploadId: 's1', mode: 'single', chunkSize: 33554432, totalParts: 1 }
    const progress: number[] = []

    const promise = uploadFileCore({ file, session, onProgress: (n) => progress.push(n) })
    const xhr = MockXhr.instances[0]
    expect(xhr.open).toHaveBeenCalledWith('PUT', '/api/uploads/s1/content')
    expect(xhr.send).toHaveBeenCalled()
    xhr.fireProgress(512)
    xhr.fireLoad(200)
    await promise

    expect(progress).toContain(512)
  })

  it('uploads multipart parts in order with progress', async () => {
    stubXhr(200)
    const file = blobOf(100)
    const session: UploadSessionInfo = { uploadId: 's2', mode: 'multipart', chunkSize: 40, totalParts: 3 }
    const progress: number[] = []

    await uploadFileCore({ file, session, onProgress: (n) => progress.push(n) })

    expect(MockXhr.instances).toHaveLength(3)
    expect(MockXhr.instances[0].open).toHaveBeenCalledWith('PUT', '/api/uploads/s2/parts/1')
    expect(MockXhr.instances[1].open).toHaveBeenCalledWith('PUT', '/api/uploads/s2/parts/2')
    expect(MockXhr.instances[2].open).toHaveBeenCalledWith('PUT', '/api/uploads/s2/parts/3')
    expect(progress[progress.length - 1]).toBe(100)
  })

  it('skips already-completed parts on resume', async () => {
    stubXhr(200)
    const file = blobOf(100)
    const session: UploadSessionInfo = { uploadId: 's3', mode: 'multipart', chunkSize: 40, totalParts: 3 }

    await uploadFileCore({ file, session, skipParts: new Set([1, 2]) })

    expect(MockXhr.instances).toHaveLength(1)
    expect(MockXhr.instances[0].open).toHaveBeenCalledWith('PUT', '/api/uploads/s3/parts/3')
  })

  it('throws HttpError on a 4xx part response without retry', async () => {
    stubXhr(400)
    const file = blobOf(100)
    const session: UploadSessionInfo = { uploadId: 's4', mode: 'multipart', chunkSize: 100, totalParts: 1 }

    await expect(uploadFileCore({ file, session })).rejects.toBeInstanceOf(HttpError)
    expect(MockXhr.instances).toHaveLength(1) // no retry for 400
  })
})
