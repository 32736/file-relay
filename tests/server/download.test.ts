import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
import { buildDownloadResponse, contentDisposition, parseRange } from '../../server/lib/download'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

describe('Phase 04 downloads', () => {
  let db: D1Fake
  let bucket: R2Fake
  let env: ReturnType<typeof makeTestEnv>
  let cookie: string

  beforeEach(async () => {
    db = new D1Fake()
    bucket = new R2Fake()
    env = makeTestEnv(db, bucket)
    cookie = await seedOwnerSession(db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function seedFile(
    name: string,
    size: number,
    mime = 'text/plain',
    content?: Uint8Array,
  ): Promise<{ fileId: string; objectKey: string }> {
    const fileId = crypto.randomUUID()
    const objectKey = `objects/2026/08/${fileId}`
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare(
        'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(fileId, objectKey, name, mime, size, 'etag-x', 'owner', now, now + 2592000, null)
      .run()
    const bytes =
      content ??
      Uint8Array.from({ length: size }, (_, index) => index % 256)
    await bucket.put(objectKey, bytes)
    return { fileId, objectKey }
  }

  async function request(fileId: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = { Cookie: cookie }
    if (range !== undefined) headers.Range = range
    return await app.request(`/api/files/${fileId}/download`, { headers }, env)
  }

  it('rejects downloads without authentication', async () => {
    const response = await app.request('/api/files/some-id/download', {}, env)
    expect(response.status).toBe(401)
  })

  it('returns 404 for missing and logically deleted files', async () => {
    const missing = await request('does-not-exist')
    expect(missing.status).toBe(404)

    const { fileId } = await seedFile('gone.txt', 100)
    await db
      .prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), fileId)
      .run()
    const deleted = await request(fileId)
    expect(deleted.status).toBe(404)
  })

  it('streams a full download with safe headers', async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const { fileId } = await seedFile('hello.bin', content.length, 'application/octet-stream', content)

    const response = await request(fileId)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('8')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-type')).toBe('application/octet-stream')
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="hello.bin"',
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content)
  })

  it('serves a closed range with 206', async () => {
    const { fileId } = await seedFile('slice.bin', 1000)
    const response = await request(fileId, 'bytes=0-99')

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000')
    expect(response.headers.get('content-length')).toBe('100')
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body).toHaveLength(100)
    expect(body[0]).toBe(0)
    expect(body[99]).toBe(99)
  })

  it('serves an open-ended range for resume', async () => {
    const { fileId } = await seedFile('resume.bin', 1000)
    const response = await request(fileId, 'bytes=100-')

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 100-999/1000')
    expect(response.headers.get('content-length')).toBe('900')
    const body = new Uint8Array(await response.arrayBuffer())
    expect(body).toHaveLength(900)
    expect(body[0]).toBe(100)
  })

  it('serves a suffix range', async () => {
    const { fileId } = await seedFile('tail.bin', 1000)
    const response = await request(fileId, 'bytes=-500')

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 500-999/1000')
    expect(response.headers.get('content-length')).toBe('500')
    const body = new Uint8Array(await response.arrayBuffer())
    // Stored content is index % 256, so byte 500 is 244 and byte 999 is 231.
    expect(body[0]).toBe(500 % 256)
    expect(body[499]).toBe(999 % 256)
  })

  it('answers unsatisfiable ranges with 416', async () => {
    const { fileId } = await seedFile('small.bin', 100)
    for (const range of ['bytes=100-', 'bytes=200-300', 'bytes=0-1,3-4', 'bytes=-0', 'chunks=0-1', 'garbage']) {
      const response = await request(fileId, range)
      expect(response.status, range).toBe(416)
      expect(response.headers.get('content-range'), range).toBe('bytes */100')
    }
  })

  it('neutralizes CR/LF header injection in filenames', async () => {
    const { fileId } = await seedFile('evil\r\nX-Injected: 1.txt', 10)
    const response = await request(fileId)

    expect(response.status).toBe(200)
    const disposition = response.headers.get('content-disposition') ?? ''
    // The CR/LF pair must not survive to create an extra header line.
    expect(disposition).not.toMatch(/[\r\n]/)
    expect(disposition).toContain('attachment;')
  })

  it('escapes quotes in the ASCII fallback filename', async () => {
    const { fileId } = await seedFile('a"b.txt', 10)
    const response = await request(fileId)

    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('filename="a\\"b.txt"')
  })

  it('encodes non-ASCII filenames via RFC 5987 filename*', async () => {
    const { fileId } = await seedFile('测试 文件.zip', 10)
    const response = await request(fileId)

    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain("filename*=UTF-8''")
    const encoded = disposition.split("filename*=UTF-8''")[1]
    expect(encoded).toMatch(/^[\x20-\x7e]+$/) // no raw non-ASCII bytes in the header
    expect(decodeURIComponent(encoded)).toBe('测试 文件.zip')
  })

  it('buildDownloadResponse produces a consistent shared pipeline', () => {
    const body = new Uint8Array([9, 8, 7])
    const full = buildDownloadResponse(
      { size: 3, body },
      'shared.bin',
      'application/octet-stream',
      { kind: 'full' },
    )
    expect(full.status).toBe(200)
    expect(full.headers.get('content-disposition')).toContain('attachment;')
    expect(full.headers.get('accept-ranges')).toBe('bytes')

    const partial = buildDownloadResponse(
      { size: 3, range: { offset: 1, length: 2 }, body },
      'shared.bin',
      null,
      { kind: 'bytes', start: 1, end: 2 },
    )
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 1-2/3')
    expect(partial.headers.get('content-type')).toBe('application/octet-stream')
  })

  it('keeps the response body as a stream', async () => {
    const { fileId } = await seedFile('stream.bin', 64)
    const response = await request(fileId)
    expect(response.body).not.toBeNull()
  })

  it('parseRange edge cases', () => {
    expect(parseRange(null, 100)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=0-99', 100)).toEqual({ kind: 'bytes', start: 0, end: 99 })
    expect(parseRange('bytes=50-', 100)).toEqual({ kind: 'bytes', start: 50, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ kind: 'suffix', length: 10 })
    expect(parseRange('bytes=90-999', 100)).toEqual({ kind: 'bytes', start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100).kind).toBe('invalid')
    expect(parseRange('bytes=5-2', 100).kind).toBe('invalid')
    expect(parseRange('bytes=0-1,3-4', 100).kind).toBe('invalid')
    expect(parseRange('bytes=-0', 100).kind).toBe('invalid')
    expect(parseRange('garbage', 100).kind).toBe('invalid')
  })

  it('contentDisposition strips control characters', () => {
    const value = contentDisposition('a\tb\x01c.txt')
    // eslint-disable-next-line no-control-regex
    expect(value).not.toMatch(/[\x00-\x1f\x7f]/)
    expect(value).toContain('attachment;')
  })
})
