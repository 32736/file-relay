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
      ['PUT', '/api/uploads/some-id/parts/1'],
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

  it('creates a multipart session for files above the chunk size', async () => {
    const { response, body } = await createSession(env, cookie, 'big.bin', 33 * 1024 * 1024)
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ mode: 'multipart', totalParts: 2 })
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

describe('Phase 03 multipart', () => {
  const CHUNK = 5 * 1024 * 1024
  const FILE_SIZE = 13 * 1024 * 1024 // 5 + 5 + 3 MiB across three parts
  const PART_SIZES = [5 * 1024 * 1024, 5 * 1024 * 1024, 3 * 1024 * 1024]

  let db: D1Fake
  let bucket: R2Fake
  let env: ReturnType<typeof makeTestEnv>
  let cookie: string

  beforeEach(async () => {
    db = new D1Fake()
    bucket = new R2Fake()
    env = makeTestEnv(db, bucket, { UPLOAD_CHUNK_SIZE: String(CHUNK) })
    cookie = await seedOwnerSession(db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function createMultipart(name = 'movie.mp4'): Promise<string> {
    const response = await app.request(
      '/api/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
        body: JSON.stringify({ name, size: FILE_SIZE, type: 'video/mp4' }),
      },
      env,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { uploadId: string }
    return body.uploadId
  }

  async function uploadPart(
    uploadId: string,
    partNumber: number,
    size: number,
    origin: string | undefined = LOCAL_ORIGIN,
  ): Promise<Response> {
    const headers: Record<string, string> = { Cookie: cookie, 'Content-Length': String(size) }
    if (origin !== undefined) headers.Origin = origin
    return app.request(
      `/api/uploads/${uploadId}/parts/${partNumber}`,
      { method: 'PUT', headers, body: streamOf(new Uint8Array(size)), duplex: 'half' } as RequestInit,
      env,
    )
  }

  async function uploadAllParts(uploadId: string): Promise<void> {
    for (let index = 0; index < PART_SIZES.length; index++) {
      const response = await uploadPart(uploadId, index + 1, PART_SIZES[index])
      expect(response.status).toBe(200)
    }
  }

  it('creates a multipart session above the chunk size', async () => {
    const uploadId = await createMultipart()
    const sessions = db.rows('upload_sessions')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].mode).toBe('multipart')
    expect(sessions[0].total_parts).toBe(3)
    expect(sessions[0].r2_upload_id).toMatch(/^fake-mpu-/)
    expect(bucket.multipartState(String(sessions[0].object_key))).toBeDefined()

    const response = await app.request(
      `/api/uploads/${uploadId}`,
      { headers: { Cookie: cookie } },
      env,
    )
    await expect(response.json()).resolves.toMatchObject({
      status: 'created',
      mode: 'multipart',
      chunkSize: CHUNK,
      totalParts: 3,
      completedParts: [],
    })
  })

  it('uploads all parts and records them', async () => {
    const uploadId = await createMultipart()
    await uploadAllParts(uploadId)

    const parts = db.rows('upload_parts')
    expect(parts).toHaveLength(3)
    expect(parts.map((part) => part.part_number)).toEqual([1, 2, 3])
    expect(parts.map((part) => part.size)).toEqual(PART_SIZES)
    expect(db.rows('upload_sessions')[0].status).toBe('uploading')

    const response = await app.request(
      `/api/uploads/${uploadId}`,
      { headers: { Cookie: cookie } },
      env,
    )
    const body = (await response.json()) as { completedParts: { partNumber: number; etag: string }[] }
    expect(body.completedParts.map((part) => part.partNumber)).toEqual([1, 2, 3])
    expect(body.completedParts[0].etag).toBe(parts[0].etag)
  })

  it('re-uploading a part is an idempotent UPSERT', async () => {
    const uploadId = await createMultipart()
    const first = await uploadPart(uploadId, 2, PART_SIZES[1])
    const firstBody = (await first.json()) as { etag: string }

    const second = await uploadPart(uploadId, 2, PART_SIZES[1])
    const secondBody = (await second.json()) as { etag: string }

    expect(second.status).toBe(200)
    expect(secondBody.etag).not.toBe(firstBody.etag)

    const parts = db.rows('upload_parts')
    expect(parts.filter((part) => part.part_number === 2)).toHaveLength(1)
    expect(parts.find((part) => part.part_number === 2)?.etag).toBe(secondBody.etag)
  })

  it('rejects invalid part numbers', async () => {
    const uploadId = await createMultipart()
    for (const partNumber of [0, 4]) {
      const response = await uploadPart(uploadId, partNumber, PART_SIZES[0])
      expect(response.status, `part ${partNumber}`).toBe(400)
    }
    expect(db.rows('upload_parts')).toHaveLength(0)
  })

  it('rejects a part exceeding the chunk size', async () => {
    const uploadId = await createMultipart()
    const response = await uploadPart(uploadId, 1, 6 * 1024 * 1024)
    expect(response.status).toBe(400)
    expect(db.rows('upload_parts')).toHaveLength(0)
  })

  it('rejects a non-final part below the 5 MiB R2 floor', async () => {
    const uploadId = await createMultipart()
    const response = await uploadPart(uploadId, 1, 4 * 1024 * 1024)
    expect(response.status).toBe(400)
    expect(db.rows('upload_parts')).toHaveLength(0)
  })

  it('rejects parts for a single-mode session', async () => {
    const create = await app.request(
      '/api/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
        body: JSON.stringify({ name: 'small.txt', size: 1024 }),
      },
      env,
    )
    const { uploadId } = (await create.json()) as { uploadId: string }
    const response = await uploadPart(uploadId, 1, 1024)
    expect(response.status).toBe(409)
  })

  it('rejects parts for an expired session', async () => {
    const uploadId = await createMultipart()
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare('UPDATE upload_sessions SET expires_at = ? WHERE id = ?')
      .bind(now - 10, uploadId)
      .run()

    const response = await uploadPart(uploadId, 1, PART_SIZES[0])
    expect(response.status).toBe(409)
  })

  it('rejects cross-origin and missing-Origin part uploads', async () => {
    const uploadId = await createMultipart()

    const crossOrigin = await uploadPart(uploadId, 1, PART_SIZES[0], 'https://evil.example')
    expect(crossOrigin.status).toBe(403)

    const missingOrigin = await app.request(
      `/api/uploads/${uploadId}/parts/1`,
      {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Length': String(PART_SIZES[0]) },
        body: streamOf(new Uint8Array(PART_SIZES[0])),
        duplex: 'half',
      } as RequestInit,
      env,
    )
    expect(missingOrigin.status).toBe(403)
    expect(db.rows('upload_parts')).toHaveLength(0)
  })

  it('complete rejects a partial multipart upload', async () => {
    const uploadId = await createMultipart()
    await uploadPart(uploadId, 1, PART_SIZES[0])
    await uploadPart(uploadId, 2, PART_SIZES[1])

    const response = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('completes a full multipart upload into one file record', async () => {
    const uploadId = await createMultipart('movie.mp4')
    await uploadAllParts(uploadId)

    const response = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      id: string
      name: string
      size: number
      etag: string
    }
    expect(body.name).toBe('movie.mp4')
    expect(body.size).toBe(FILE_SIZE)
    expect(body.etag).toMatch(/^fake-object-etag-/)
    expect(bucket.keys()).toHaveLength(1)

    const files = db.rows('files')
    expect(files).toHaveLength(1)
    expect(files[0].size).toBe(FILE_SIZE)
    expect(files[0].etag).toBe(body.etag)
    expect(db.rows('upload_sessions')[0].status).toBe('completed')
  })

  it('complete is idempotent after completion', async () => {
    const uploadId = await createMultipart()
    await uploadAllParts(uploadId)

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
    expect(db.rows('files')).toHaveLength(1) // no duplicate file row
  })

  it('repairs D1 when R2 completion already happened (crash recovery)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const objectKey = 'objects/2026/08/file-crash'
    await db
      .prepare(
        `INSERT INTO upload_sessions
         (id, file_id, object_key, original_name, mime_type, total_size, chunk_size,
          total_parts, mode, r2_upload_id, auth_kind, access_token_hash, status,
          created_at, expires_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'sess-crash',
        'file-crash',
        objectKey,
        'crash.bin',
        'application/octet-stream',
        FILE_SIZE,
        CHUNK,
        3,
        'multipart',
        'fake-mpu-1',
        'owner',
        null,
        'completed',
        now - 100,
        now + 100,
        now,
      )
      .run()
    await bucket.put(objectKey, new Uint8Array(FILE_SIZE))

    const response = await app.request(
      '/api/uploads/sess-crash/complete',
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { id: string; size: number }
    expect(body.id).toBe('file-crash')
    expect(body.size).toBe(FILE_SIZE)

    const files = db.rows('files')
    expect(files).toHaveLength(1)
    expect(files[0].id).toBe('file-crash')
  })

  it('aborts a multipart upload and is idempotent', async () => {
    const uploadId = await createMultipart()
    await uploadPart(uploadId, 1, PART_SIZES[0])

    const first = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(first.status).toBe(204)
    expect(db.rows('upload_sessions')[0].status).toBe('aborted')
    const objectKey = String(db.rows('upload_sessions')[0].object_key)
    expect(bucket.multipartState(objectKey)).toBeUndefined() // aborted multipart removed

    const second = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(second.status).toBe(204)
  })

  it('refuses to abort a completed multipart upload', async () => {
    const uploadId = await createMultipart()
    await uploadAllParts(uploadId)
    await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )

    const response = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('rejects cross-origin complete and abort', async () => {
    const uploadId = await createMultipart()
    await uploadPart(uploadId, 1, PART_SIZES[0])

    const complete = await app.request(
      `/api/uploads/${uploadId}/complete`,
      { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } },
      env,
    )
    expect(complete.status).toBe(403)
    expect(db.rows('upload_sessions')[0].status).toBe('uploading')

    const abort = await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://evil.example' } },
      env,
    )
    expect(abort.status).toBe(403)
    expect(db.rows('upload_sessions')[0].status).toBe('uploading')
  })

  it('rejects parts for an aborted session', async () => {
    const uploadId = await createMultipart()
    await uploadPart(uploadId, 1, PART_SIZES[0])
    await app.request(
      `/api/uploads/${uploadId}`,
      { method: 'DELETE', headers: authHeaders(cookie) },
      env,
    )

    const response = await uploadPart(uploadId, 2, PART_SIZES[1])
    expect(response.status).toBe(409)
  })

  it('complete conflicts for an aborted multipart session', async () => {
    const uploadId = await createMultipart()
    await uploadPart(uploadId, 1, PART_SIZES[0])
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

  it('complete returns 409 when the R2 object is missing after completion', async () => {
    const now = Math.floor(Date.now() / 1000)
    const objectKey = 'objects/2026/08/file-no-object'
    await db
      .prepare(
        `INSERT INTO upload_sessions
         (id, file_id, object_key, original_name, mime_type, total_size, chunk_size,
          total_parts, mode, r2_upload_id, auth_kind, access_token_hash, status,
          created_at, expires_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'sess-no-object',
        'file-no-object',
        objectKey,
        'ghost.bin',
        'application/octet-stream',
        FILE_SIZE,
        CHUNK,
        3,
        'multipart',
        'fake-mpu-1',
        'owner',
        null,
        'completed',
        now - 100,
        now + 100,
        now,
      )
      .run()
    // No files row and no R2 object: the completed marker cannot be repaired.

    const response = await app.request(
      '/api/uploads/sess-no-object/complete',
      { method: 'POST', headers: authHeaders(cookie) },
      env,
    )
    expect(response.status).toBe(409)
  })

  it('rejects uploads requiring more than 10,000 parts', async () => {
    const smallChunkEnv = makeTestEnv(db, bucket, { UPLOAD_CHUNK_SIZE: '1024' })
    const response = await app.request(
      '/api/uploads',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(cookie) },
        body: JSON.stringify({ name: 'many.bin', size: 1024 * 10001 }),
      },
      smallChunkEnv,
    )
    expect(response.status).toBe(413)
    expect(db.rows('upload_sessions')).toHaveLength(0)
  })
})
