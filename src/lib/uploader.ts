import { api } from './api'

export type UploadMode = 'single' | 'multipart'

export interface UploadSessionInfo {
  uploadId: string
  mode: UploadMode
  chunkSize: number
  totalParts: number
}

export interface UploadSessionState {
  status: string
  mode: UploadMode
  chunkSize: number
  totalParts: number
  completedParts?: { partNumber: number; etag: string }[]
}

/** Persisted record used to resume after a refresh (needs the same file again). */
export interface PendingUploadRecord {
  uploadId: string
  name: string
  size: number
  type: string
  lastModified: number
  mode: UploadMode
  chunkSize: number
  totalParts: number
  createdAt: number
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export class AbortUploadError extends Error {
  constructor() {
    super('upload aborted')
    this.name = 'AbortUploadError'
  }
}

// Plan §39: retry only transient failures; 4xx are never retried.
export const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export function isRetryable(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

export async function withRetry<T>(
  attempt: () => Promise<T>,
  options: { retries?: number; delayMs?: number; onRetry?: (attemptNumber: number, error: unknown) => void } = {},
): Promise<T> {
  const retries = options.retries ?? 3
  let delay = options.delayMs ?? 1000
  let lastError: unknown
  for (let attemptNumber = 0; attemptNumber <= retries; attemptNumber++) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      if (error instanceof AbortUploadError) throw error
      if (error instanceof HttpError && !isRetryable(error.status)) throw error
      if (attemptNumber === retries) break
      options.onRetry?.(attemptNumber + 1, error)
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay *= 2 // 1s, 2s, 4s
    }
  }
  throw lastError
}

export interface XhrResult {
  status: number
  text: string
}

/**
 * PUTs a Blob via XMLHttpRequest so we get upload progress and abort support
 * (fetch has neither). The browser sets Content-Length automatically.
 */
export function xhrPut(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<XhrResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortUploadError())
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value)
    }
    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    }
    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve({ status: xhr.status, text: xhr.responseText })
    }
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new Error('network error'))
    }
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort)
      reject(new AbortUploadError())
    }
    xhr.send(body)
  })
}

export function createUploadSession(file: { name: string; size: number; type: string }): Promise<UploadSessionInfo> {
  return api<UploadSessionInfo>('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
  })
}

export function fetchSessionState(uploadId: string): Promise<UploadSessionState> {
  return api<UploadSessionState>(`/api/uploads/${uploadId}`)
}

export function completeUpload(uploadId: string): Promise<unknown> {
  return api(`/api/uploads/${uploadId}/complete`, { method: 'POST' })
}

export function abortUpload(uploadId: string): Promise<unknown> {
  return api(`/api/uploads/${uploadId}`, { method: 'DELETE' })
}

function partSize(session: UploadSessionInfo, partNumber: number, fileSize: number): number {
  if (partNumber === session.totalParts) {
    return fileSize - (session.totalParts - 1) * session.chunkSize
  }
  return session.chunkSize
}

export interface UploadFileOptions {
  file: Blob & { name: string }
  session: UploadSessionInfo
  /** Parts already uploaded (resume); skipped without re-uploading. */
  skipParts?: Set<number>
  onProgress?: (transferred: number) => void
  signal?: AbortSignal
}

/**
 * Streams a file through the session protocol with per-request retry. For
 * multipart it uploads parts in order, skipping already-completed parts.
 */
export async function uploadFileCore(options: UploadFileOptions): Promise<void> {
  const { file, session, onProgress, signal } = options

  if (session.mode === 'single') {
    await withRetry(async () => {
      const result = await xhrPut(
        `/api/uploads/${session.uploadId}/content`,
        file,
        { 'Content-Type': file.type || 'application/octet-stream' },
        (loaded) => onProgress?.(loaded),
        signal,
      )
      if (result.status >= 400) throw new HttpError(result.status, result.text)
      return result
    })
    return
  }

  const completed = options.skipParts ?? new Set<number>()
  let transferred = 0
  for (let partNumber = 1; partNumber <= session.totalParts; partNumber++) {
    const thisPartSize = partSize(session, partNumber, file.size)
    if (completed.has(partNumber)) {
      transferred += thisPartSize
      onProgress?.(transferred)
      continue
    }
    const start = (partNumber - 1) * session.chunkSize
    const partBlob = file.slice(start, start + thisPartSize)
    await withRetry(async () => {
      const result = await xhrPut(
        `/api/uploads/${session.uploadId}/parts/${partNumber}`,
        partBlob,
        {},
        (loaded) => onProgress?.(transferred + loaded),
        signal,
      )
      if (result.status >= 400) throw new HttpError(result.status, result.text)
      return result
    })
    transferred += thisPartSize
    onProgress?.(transferred)
  }
}

const STORAGE_KEY = 'drop-pending-uploads'

export function loadPendingUploads(): PendingUploadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as PendingUploadRecord[]) : []
  } catch {
    return []
  }
}

export function savePendingUploads(records: PendingUploadRecord[]): void {
  try {
    if (records.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch {
    // storage unavailable (private mode) — resume simply won't persist
  }
}
