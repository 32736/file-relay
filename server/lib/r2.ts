const DEFAULT_CHUNK_SIZE = 32 * 1024 * 1024
const DEFAULT_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024
const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60

/** Chunk size in bytes; uploads at or below this are single, above need multipart. */
export function chunkSize(raw: string | undefined): number {
  return Number(raw) || DEFAULT_CHUNK_SIZE
}

export function maxFileSize(raw: string | undefined): number {
  return Number(raw) || DEFAULT_MAX_FILE_SIZE
}

export function retentionSeconds(raw: string | undefined): number {
  return Number(raw) * 24 * 60 * 60 || DEFAULT_RETENTION_SECONDS
}

/**
 * R2 object key for a file. The original filename is metadata only and never
 * appears in object keys (implementation plan §16).
 */
export function objectKeyFor(fileId: string, now: Date): string {
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `objects/${year}/${month}/${fileId}`
}
