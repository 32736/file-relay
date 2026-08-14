import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

const CHUNK_SIZE = 33554432
const LOCAL_ORIGIN = 'http://localhost'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function authHeaders(cookie: string, origin = LOCAL_ORIGIN): Record<string, string> {
  return { Cookie: cookie, Origin: origin }
}

async function createSession(
  env: ReturnType<typeof makeTestEnv>,
  cookie: string,
  name: string,
  size: number,
  type: string | null = 'text/plain',
): Promise<{
  response: Response
  uploadId: string
  body: { uploadId?: string; mode?: string; chunkSize?: number; totalParts?: number }
}> {
  const response = await app.request(
    '/api/uploads',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
      body: JSON.stringify({ name, size, type }),
    },
    env,
  )
  const body = (await response.json()) as { uploadId?: string }
  return { response, uploadId: body.uploadId ?? '', body }
}

async function putContent(
  env: ReturnType<typeof makeTestEnv>,
  cookie: string,
  uploadId: string,
  body: ReadableStream<Uint8Array>,
  origin: string | undefined = LOCAL_ORIGIN,
): Promise<Response> {
  const headers: Record<string, string> = { Cookie: cookie }
  if (origin !== undefined) headers.Origin = origin
  return app.request(
    `/api/uploads/${uploadId}/content`,
    { method: 'PUT', headers, body, duplex: 'half' } as RequestInit,
    env,
  )
}

describe('Phase 02 uploads', () => {
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

  it('rejects every upload route without authentication', async () => {
    const cases: [string, string][] = [
      ['POST', '/api/uploads'],
      ['GET', '/api/uploads/some-id'],
      ['PUT', '/api/uploads/some-id/content'],
      ['POST', '/api/uploads/some-id/complete'],
      ['DELETE', '/api/uploads/some-id'],
    ]
    for (const [method, path] of cases) {
      const response = await app.request(path, { method }, env)
      expect(response.status, `${method} ${path}`).toBe(401)
    }
  })

  it('validates the upload request body', async () => {
    const cases: { body: unknown; expected: number }[] = [
      { body: { size: 100 }, expected: 400 }, // missing name
      { body: { name: '', size: 100 }, expected: 400 },
      { body: { name: 'a.txt' }, expected: 400 }, // missing size
      { body: { name: 'a.txt', size: 0 }, expected: 400 },
      { body: { name: 'a.txt', size: -5 }, expected: 400 },
      { body: { name: 'a.txt', size: 100.5 }, expected: 400 },
      { body: { name: 'x'.repeat(300), size: 100 }, expected: 400 },
      { body: { name: '..\\..\\', size: 100 }, expected: 400 }, // empty basename
    ]
    for (const { body, expected } of cases) {
      const response = await app.request(
        '/api/uploads',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
          body: JSON.stringify(body),
        },
        env,
      )
      expect(response.status, JSON.stringify(body)).toBe(expected)
    }
    expect(db.rows('upload_sessions')).toHaveLength(0)
  })

  it('rejects sizes above the maximum file size', async () => {
    const { response } = await createSession(env, cookie, 'huge.bin', 3 * 1024 * 1024 * 1024)
    expect(response.status).toBe(413)
  })

  it('creates a single-mode session for files at or below the chunk size', async () => {
    const { body, uploadId } = await createSession(env, cookie, 'ok.txt', 31 * 1024 * 1024)
    expect(body).toEqual({
      uploadId,
      mode: 'single',
      chunkSize: CHUNK_SIZE,
      totalParts: 1,
    })

    const sessions = db.rows('upload_sessions')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].mode).toBe('single')
    expect(sessions[0].auth_kind).toBe('owner')
    expect(sessions[0].status).toBe('created')
    expect(sessions[0].original_name).toBe('ok.txt')
    expect(db.rows('files')).toHaveLength(0) // files row appears on completion
  })

  it('rejects files above the chunk size until multipart exists', async () => {
    const { response } = await createSession(env, cookie, 'big.bin', 33 * 1024 * 1024)
    expect(response.status).toBe(413)
    expect(db.rows('upload_sessions')).toHaveLength(0)
  })

  it('stores only the basename of a path-like filename', async () => {
    const { response } = await createSession(env, cookie, 'folder\\sub/dir/report.pdf', 1024)
    expect(response.status).toBe(200)
    expect(db.rows('upload_sessions')[0].original_name).toBe('report.pdf')
  })

  it('streams a single upload to R2 and completes the session', async () => {
    const { uploadId } = await createSession(env, cookie, 'notes.txt', 1024)
    const response = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(1024)))

    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; name: string; size: number; etag: string }
    expect(body.name).toBe('notes.txt')
    expect(body.size).toBe(1024)
    expect(body.etag).toBeTruthy()

    // R2 object under an objects/YYYY/MM/<fileId> key, never the filename
    const keys = bucket.keys()
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^objects\/\d{4}\/\d{2}\//)
    expect(keys[0]).not.toContain('notes.txt')
    expect(bucket.object(keys[0])?.contentType).toBe('text/plain')

    const files = db.rows('files')
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe(body.id)
    expect(files[0].size).toBe(1024)
    expect(files[0].source).toBe('owner')
    expect(files[0].etag).toBe(body.etag)
    // Default retention: 30 days from creation, stored as epoch seconds
    expect(files[0].expires_at).toBe((files[0].created_at as number) + 30 * 24 * 60 * 60)

    expect(db.rows('upload_sessions')[0].status).toBe('completed')
  })

  it('accepts 5 MiB and 31 MiB single uploads', async () => {
    for (const size of [5 * 1024 * 1024, 31 * 1024 * 1024]) {
      const { uploadId } = await createSession(env, cookie, `${size}.bin`, size)
      const response = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(size)))
      expect(response.status, `size ${size}`).toBe(200)
    }
    expect(db.rows('files')).toHaveLength(2)
  })

  it('rejects an upload whose body size mismatches the declaration', async () => {
    const { uploadId } = await createSession(env, cookie, 'short.txt', 2048)
    const response = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(1024)))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'SIZE_MISMATCH', message: 'Uploaded size does not match the declared size' },
    })
    expect(bucket.keys()).toHaveLength(0) // partial object removed
    expect(db.rows('upload_sessions')[0].status).toBe('created') // not completed
  })

  it('returns 404 for an unknown upload session', async () => {
    const response = await putContent(env, cookie, 'does-not-exist', streamOf(new Uint8Array(10)))
    expect(response.status).toBe(404)
  })

  it('rejects content upload to an already-completed session', async () => {
    const { uploadId } = await createSession(env, cookie, 'once.txt', 512)
    const first = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(512)))
    expect(first.status).toBe(200)

    const second = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(512)))
    expect(second.status).toBe(409)
  })

  it('rejects content upload to an expired session', async () => {
    const { uploadId } = await createSession(env, cookie, 'late.txt', 512)
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare('UPDATE upload_sessions SET expires_at = ? WHERE id = ?')
      .bind(now - 10, uploadId)
      .run()

    const response = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(512)))
    expect(response.status).toBe(409)
  })

  it('rejects cross-origin state changes', async () => {
    const { uploadId } = await createSession(env, cookie, 'evil.txt', 512)
    const response = await putContent(
      env,
      cookie,
      uploadId,
      streamOf(new Uint8Array(512)),
      'https://evil.example',
    )
    expect(response.status).toBe(403)
    expect(db.rows('upload_sessions')[0].status).toBe('created')
  })

  it('reports session state via GET', async () => {
    const { uploadId } = await createSession(env, cookie, 'state.txt', 1024)
    const response = await app.request(
      `/api/uploads/${uploadId}`,
      { headers: { Cookie: cookie } },
      env,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      status: 'created',
      mode: 'single',
      chunkSize: CHUNK_SIZE,
      totalParts: 1,
    })
  })

  it('complete is idempotent for a completed single upload', async () => {
    const { uploadId } = await createSession(env, cookie, 'done.txt', 256)
    await putContent(env, cookie, uploadId, streamOf(new Uint8Array(256)))

    const first = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(first.status).toBe(200)

    const second = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(second.status).toBe(200)
  })

  it('complete conflicts before the upload is done', async () => {
    const { uploadId } = await createSession(env, cookie, 'pending.txt', 256)
    const response = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('aborts a pending session and is idempotent', async () => {
    const { uploadId } = await createSession(env, cookie, 'abort.txt', 256)
    const first = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(first.status).toBe(204)
    expect(db.rows('upload_sessions')[0].status).toBe('aborted')

    const second = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(second.status).toBe(204)
  })

  it('refuses to abort a completed upload', async () => {
    const { uploadId } = await createSession(env, cookie, 'final.txt', 256)
    await putContent(env, cookie, uploadId, streamOf(new Uint8Array(256)))

    const response = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('rejects state changes without an Origin header', async () => {
    const create = await app.request(
      '/api/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ name: 'x.txt', size: 100 }),
      },
      env,
    )
    expect(create.status).toBe(403)

    const { uploadId } = await createSession(env, cookie, 'no-origin.txt', 100)
    const put = await app.request(
      `/api/uploads/${uploadId}/content`,
      {
        method: 'PUT',
        headers: { Cookie: cookie },
        body: streamOf(new Uint8Array(100)),
        duplex: 'half',
      } as RequestInit,
      env,
    )
    expect(put.status).toBe(403)

    const del = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    )
    expect(del.status).toBe(403)
    expect(db.rows('upload_sessions')[0].status).toBe('created')
  })

  it('returns 404 for an unknown session via GET', async () => {
    const response = await app.request(
      '/api/uploads/does-not-exist',
      { headers: { Cookie: cookie } },
      env,
    )
    expect(response.status).toBe(404)
  })

  it('complete conflicts for an aborted session', async () => {
    const { uploadId } = await createSession(env, cookie, 'aborted-complete.txt', 256)
    await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )

    const response = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('accepts a null mime type', async () => {
    const { response, uploadId } = await createSession(env, cookie, 'no-type.bin', 128, null)
    expect(response.status).toBe(200)
    expect(db.rows('upload_sessions')[0].mime_type).toBeNull()

    const put = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(128)))
    expect(put.status).toBe(200)
    expect(bucket.keys()[0] ? bucket.object(bucket.keys()[0])?.contentType : null).toBe(
      'application/octet-stream',
    )
  })

  it('treats a file exactly at the chunk size as a single upload', async () => {
    const { body } = await createSession(env, cookie, 'exact.bin', CHUNK_SIZE)
    expect(body).toMatchObject({ mode: 'single', chunkSize: CHUNK_SIZE, totalParts: 1 })

    const uploadId = body.uploadId ?? ''
    const put = await putContent(env, cookie, uploadId, streamOf(new Uint8Array(CHUNK_SIZE)))
    expect(put.status).toBe(200)
  })

  it('rejects a non-JSON request body', async () => {
    const response = await app.request(
      '/api/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
        body: 'not-json',
      },
      env,
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid upload request' },
    })
    expect(db.rows('upload_sessions')).toHaveLength(0)
  })
})
