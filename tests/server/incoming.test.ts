import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
import { sha256Hex } from '../../server/lib/crypto'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

const LOCAL_ORIGIN = 'http://localhost'

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('Phase 08 incoming upload', () => {
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

  function stubTurnstile(success: boolean): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('challenges.cloudflare.com/turnstile')) {
          return new Response(JSON.stringify({ success }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response('not found', { status: 404 })
      }),
    )
  }

  async function createIncoming(
    body: Record<string, unknown> = {},
  ): Promise<{ token: string; id: string }> {
    const response = await app.request(
      '/api/incoming-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({
          expiresIn: 3600,
          maxFiles: 5,
          ...body,
        }),
      },
      env,
    )
    expect(response.status).toBe(200)
    const result = (await response.json()) as { id: string; url: string }
    const token = result.url.split('/u/')[1]
    return { token, id: result.id }
  }

  async function openIncoming(
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<Response> {
    return await app.request(
      `/api/public/incoming/${token}/uploads`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turnstileToken: 'dummy',
          name: 'incoming.bin',
          size: 1024,
          type: 'application/octet-stream',
          ...body,
        }),
      },
      env,
    )
  }

  it('protects owner incoming routes', async () => {
    const unauth = await app.request('/api/incoming-requests', {}, env)
    expect(unauth.status).toBe(401)

    const crossOrigin = await app.request(
      '/api/incoming-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
        body: JSON.stringify({ expiresIn: 3600, maxFiles: 1 }),
      },
      env,
    )
    expect(crossOrigin.status).toBe(403)
  })

  it('creates an incoming request storing only the token hash', async () => {
    const { token } = await createIncoming({ title: '给我文件', maxFileSize: 5 * 1024 * 1024 })

    const rows = db.rows('incoming_requests')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).toBe(await sha256Hex(token))
    expect(rows[0].token_hash).not.toBe(token)
    expect(rows[0].max_files).toBe(5)
    expect(rows[0].max_file_size).toBe(5 * 1024 * 1024)
    expect(rows[0].title).toBe('给我文件')
  })

  it('exposes public metadata with the site key and hides internals', async () => {
    const { token } = await createIncoming({ title: 'T' })
    const response = await app.request(`/api/public/incoming/${token}`, {}, env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body.siteKey).toBe('test-turnstile-site')
    expect(Object.keys(body).sort()).toEqual([
      'expiresAt',
      'maxFileSize',
      'maxFiles',
      'siteKey',
      'title',
      'uploadedCount',
    ])
  })

  it('returns 404 for unknown, revoked, and expired incoming requests', async () => {
    const { token, id } = await createIncoming()
    const now = Math.floor(Date.now() / 1000)

    expect((await app.request('/api/public/incoming/no-such-token', {}, env)).status).toBe(404)

    await app.request(
      `/api/incoming-requests/${id}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect((await app.request(`/api/public/incoming/${token}`, {}, env)).status).toBe(404)

    const { token: expiredToken } = await createIncoming()
    await db
      .prepare('UPDATE incoming_requests SET expires_at = ? WHERE token_hash = ?')
      .bind(now - 10, await sha256Hex(expiredToken))
      .run()
    expect((await app.request(`/api/public/incoming/${expiredToken}`, {}, env)).status).toBe(404)
  })

  it('rejects Turnstile failures without creating a session', async () => {
    stubTurnstile(false)
    const { token } = await createIncoming()

    const response = await openIncoming(token)
    expect(response.status).toBe(403)
    expect(db.rows('upload_sessions')).toHaveLength(0)
    expect(db.rows('incoming_requests')[0].uploaded_count).toBe(0)
  })

  it('creates an incoming upload session after Turnstile success', async () => {
    stubTurnstile(true)
    const { token } = await createIncoming()

    const response = await openIncoming(token)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      uploadId: string
      mode: string
      uploadToken: string
    }
    expect(body.mode).toBe('single')
    expect(body.uploadToken).toBeTruthy()

    const sessions = db.rows('upload_sessions')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].auth_kind).toBe('incoming')
    expect(sessions[0].access_token_hash).toBe(await sha256Hex(body.uploadToken))
    expect(db.rows('incoming_requests')[0].uploaded_count).toBe(1)
  })

  it('never oversubscribes the file quota under concurrency', async () => {
    stubTurnstile(true)
    const { token } = await createIncoming({ maxFiles: 1 })

    const results = await Promise.all(Array.from({ length: 4 }, () => openIncoming(token)))
    const statuses = results.map((response) => response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 403)).toHaveLength(3)
    expect(db.rows('incoming_requests')[0].uploaded_count).toBe(1)
  })

  it('rejects oversized files before consuming the quota', async () => {
    stubTurnstile(true)
    const { token } = await createIncoming({ maxFileSize: 1024 })

    const response = await openIncoming(token, { size: 2048 })
    expect(response.status).toBe(413)
    expect(db.rows('incoming_requests')[0].uploaded_count).toBe(0)
    expect(db.rows('upload_sessions')).toHaveLength(0)
  })

  it('uploads single content with the bearer token as source incoming', async () => {
    stubTurnstile(true)
    const { token } = await createIncoming()
    const session = (await (
      await openIncoming(token, { size: 2048 })
    ).json()) as { uploadId: string; uploadToken: string }

    const put = await app.request(
      `/api/public/uploads/${session.uploadId}/content`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${session.uploadToken}`,
          Origin: LOCAL_ORIGIN,
          'Content-Length': '2048',
        },
        body: streamOf(new Uint8Array(2048)),
        duplex: 'half',
      } as RequestInit,
      env,
    )
    expect(put.status).toBe(200)

    const complete = await app.request(
      `/api/public/uploads/${session.uploadId}/complete`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.uploadToken}` } },
      env,
    )
    expect(complete.status).toBe(200)

    const files = db.rows('files')
    expect(files).toHaveLength(1)
    expect(files[0].source).toBe('incoming')
    expect(files[0].size).toBe(2048)
  })

  it('requires a valid bearer token on public upload endpoints', async () => {
    stubTurnstile(true)
    const { token } = await createIncoming()
    const session = (await (await openIncoming(token)).json()) as { uploadId: string }

    const missing = await app.request(
      `/api/public/uploads/${session.uploadId}/content`,
      { method: 'PUT' },
      env,
    )
    expect(missing.status).toBe(401)

    const wrong = await app.request(
      `/api/public/uploads/${session.uploadId}/content`,
      { method: 'PUT', headers: { Authorization: 'Bearer not-a-token' } },
      env,
    )
    expect(wrong.status).toBe(401)
  })

  it('supports multipart upload through the public endpoints', async () => {
    stubTurnstile(true)
    const chunkEnv = makeTestEnv(db, bucket, { UPLOAD_CHUNK_SIZE: String(5 * 1024 * 1024) })
    const createResponse = await app.request(
      '/api/incoming-requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ expiresIn: 3600, maxFiles: 1 }),
      },
      chunkEnv,
    )
    const created = (await createResponse.json()) as { url: string }
    const requestToken = created.url.split('/u/')[1]

    const open = await app.request(
      `/api/public/incoming/${requestToken}/uploads`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turnstileToken: 'dummy',
          name: 'big.bin',
          size: 13 * 1024 * 1024,
        }),
      },
      chunkEnv,
    )
    const session = (await open.json()) as {
      uploadId: string
      mode: string
      totalParts: number
      uploadToken: string
    }
    expect(session.mode).toBe('multipart')
    expect(session.totalParts).toBe(3)

    // 5 + 5 + 3 MiB: non-final parts meet the 5 MiB R2 floor and the chunk
    // size; the tail part has no floor.
    const partSizes = [5 * 1024 * 1024, 5 * 1024 * 1024, 3 * 1024 * 1024]
    for (let index = 0; index < partSizes.length; index++) {
      const part = await app.request(
        `/api/public/uploads/${session.uploadId}/parts/${index + 1}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${session.uploadToken}`,
            'Content-Length': String(partSizes[index]),
          },
          body: streamOf(new Uint8Array(partSizes[index])),
          duplex: 'half',
        } as RequestInit,
        chunkEnv,
      )
      expect(part.status, `part ${index + 1}`).toBe(200)
    }

    const complete = await app.request(
      `/api/public/uploads/${session.uploadId}/complete`,
      { method: 'POST', headers: { Authorization: `Bearer ${session.uploadToken}` } },
      chunkEnv,
    )
    expect(complete.status).toBe(200)
    expect(db.rows('files')).toHaveLength(1)
  })

  it('revokes incoming requests idempotently', async () => {
    const { id } = await createIncoming()
    const first = await app.request(
      `/api/incoming-requests/${id}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(first.status).toBe(204)
    const second = await app.request(
      `/api/incoming-requests/${id}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(second.status).toBe(204)
    const missing = await app.request(
      '/api/incoming-requests/does-not-exist',
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(missing.status).toBe(404)
  })

  it('lists incoming requests without raw tokens', async () => {
    await createIncoming({ title: 'list me' })
    const response = await app.request('/api/incoming-requests', { headers: { Cookie: cookie } }, env)
    const body = (await response.json()) as { requests: Record<string, unknown>[] }
    expect(body.requests).toHaveLength(1)
    expect(JSON.stringify(body)).not.toMatch(/\/u\//)
  })
})
