const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/** Parsed `Range` header. `bytes` ranges are closed intervals [start, end]. */
export type RangeSpec =
  | { kind: 'full' }
  | { kind: 'bytes'; start: number; end: number }
  | { kind: 'suffix'; length: number }
  | { kind: 'invalid' }

/**
 * Parses a single `Range` header against the object size. Only the
 * `bytes=start-end`, `bytes=start-` and `bytes=-suffix` forms are supported
 * (R2's range model); anything else (multi-range, malformed, unsatisfiable)
 * is `invalid` → 416.
 */
export function parseRange(header: string | null | undefined, size: number): RangeSpec {
  if (!header) return { kind: 'full' }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return { kind: 'invalid' }

  const [, startRaw, endRaw] = match
  if (startRaw === '' && endRaw === '') return { kind: 'invalid' }

  if (startRaw === '') {
    const length = Number(endRaw)
    if (!Number.isSafeInteger(length) || length <= 0) return { kind: 'invalid' }
    return { kind: 'suffix', length }
  }

  const start = Number(startRaw)
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { kind: 'invalid' }

  if (endRaw === '') {
    return { kind: 'bytes', start, end: size - 1 }
  }

  const end = Number(endRaw)
  if (!Number.isSafeInteger(end) || end < start) return { kind: 'invalid' }
  return { kind: 'bytes', start, end: Math.min(end, size - 1) }
}

/**
 * Builds a safe `Content-Disposition` header value. CR/LF and control
 * characters are stripped (header-injection guard); the ASCII `filename="..."`
 * fallback keeps only printable ASCII (non-ASCII becomes `_`) and escapes
 * quotes/backslashes so the header stays latin1-safe; non-ASCII names
 * additionally get an RFC 5987 `filename*=UTF-8''<percent-encoded>` value.
 */
export function contentDisposition(
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string {
  const clean = filename
    // eslint-disable-next-line no-control-regex
    .replace(/[\r\n\x00-\x1f\x7f]/g, ' ')
    .trim()
  const asciiSafe = clean.replace(/[^\x20-\x7e]/g, '_')
  const asciiFallback = asciiSafe.replace(/[\\"]/g, (char) => `\\${char}`)

  let value = `${disposition}; filename="${asciiFallback}"`
  if (/[^\x20-\x7e]/.test(clean)) {
    value += `; filename*=UTF-8''${encodeURIComponent(clean)}`
  }
  return value
}

export interface DownloadObject {
  size: number
  range?: { offset?: number; length?: number; suffix?: number }
  body: ReadableStream | Uint8Array | null
}

/**
 * The shared download pipeline used by owner downloads (Phase 04) and public
 * share downloads (Phase 05). Attaches content headers, size/range headers,
 * and streams the body. It deliberately contains no authorization or counting
 * logic — callers authorize and (Phase 05) claim a download before calling.
 */
export function buildDownloadResponse(
  object: DownloadObject,
  filename: string,
  mimeType: string | null,
  range: RangeSpec,
): Response {
  const headers = new Headers({
    'Content-Type': mimeType ?? DEFAULT_CONTENT_TYPE,
    'Content-Disposition': contentDisposition(filename),
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  })

  if (range.kind === 'bytes' || range.kind === 'suffix') {
    const start = object.range?.offset ?? 0
    const length = object.range?.length ?? object.size
    const end = start + length - 1
    headers.set('Content-Length', String(length))
    headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`)
    return new Response(object.body as BodyInit, { status: 206, headers })
  }

  headers.set('Content-Length', String(object.size))
  return new Response(object.body as BodyInit, { status: 200, headers })
}
