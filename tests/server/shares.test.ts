import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
import { randomToken, sha256Hex } from '../../server/lib/crypto'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

const LOCAL_ORIGIN = 'http://localhost'

describe('Phase 05 sharing', () => {
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

  async function seedFile(name = 'shareme.txt', size = 1024): Promise<string> {
    const fileId = crypto.randomUUID()
    const objectKey = `objects/2026/08/${fileId}`
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare(
        'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(fileId, objectKey, name, 'text/plain', size, 'etag-x', 'owner', now, now + 2592000, null)
      .run()
    await bucket.put(
      objectKey,
      Uint8Array.from({ length: size }, (_, index) => index % 256),
    )
    return fileId
  }

  async function createShare(
    fileId: string,
    body: Record<string, unknown> = {},
  ): Promise<Response> {
    return await app.request(
      `/api/files/${fileId}/shares`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify(body),
      },
      env,
    )
  }

  async function createShareOk(
    fileId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ shareId: string; token: string }> {
    const response = await createShare(fileId, body)
    expect(response.status).toBe(200)
    const result = (await response.json()) as { id: string; url: string }
    const token = result.url.split('/s/')[1]
    return { shareId: result.id, token }
  }

  async function publicMetadata(token: string): Promise<Response> {
    return await app.request(`/api/public/shares/${token}`, {}, env)
  }

  async function publicDownload(token: string, range?: string): Promise<Response> {
    const headers: Record<string, string> = {}
    if (range !== undefined) headers.Range = range
    return await app.request(`/api/public/shares/${token}/download`, { headers }, env)
  }

  it('rejects unauthenticated owner share routes and cross-origin writes', async () => {
    const fileId = await seedFile()
    const unauth = await app.request('/api/shares', {}, env)
    expect(unauth.status).toBe(401)

    const crossOrigin = await app.request(
      `/api/files/${fileId}/shares`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
        body: '{}',
      },
      env,
    )
    expect(crossOrigin.status).toBe(403)
  })

  it('creates a share storing only the token hash', async () => {
    const fileId = await seedFile()
    const response = await createShare(fileId, { expiresIn: 3600, maxDownloads: 5 })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      id: string
      url: string
      expiresAt: number | null
      maxDownloads: number | null
    }
    expect(body.url).toMatch(/^https:\/\/drop\.28207\.cc\/s\/[A-Za-z0-9_-]{43}$/)
    expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(body.maxDownloads).toBe(5)

    const token = body.url.split('/s/')[1]
    const rows = db.rows('shares')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toBe(token)
    expect(rows[0].token_hash).toBe(await sha256Hex(token))
  })

  it('rejects shares for missing or deleted files', async () => {
    const missing = await createShare('does-not-exist')
    expect(missing.status).toBe(404)

    const fileId = await seedFile()
    await db
      .prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), fileId)
      .run()
    const deleted = await createShare(fileId)
    expect(deleted.status).toBe(404)
  })

  it('exposes public metadata without internal fields', async () => {
    const fileId = await seedFile('shareme.txt', 2048)
    const { token } = await createShareOk(fileId, { maxDownloads: 3 })

    const response = await publicMetadata(token)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toEqual({
      name: 'shareme.txt',
      size: 2048,
      mimeType: 'text/plain',
      expiresAt: null,
      remainingDownloads: 3,
    })
    expect(Object.keys(body).sort()).toEqual([
      'expiresAt',
      'mimeType',
      'name',
      'remainingDownloads',
      'size',
    ])
  })

  it('returns 404 for unknown, revoked, expired, and deleted-file shares', async () => {
    expect((await publicMetadata('no-such-token')).status).toBe(404)

    const fileId = await seedFile()
    const { token, shareId } = await createShareOk(fileId, { expiresIn: 3600 })

    // Revoked
    await app.request(
      `/api/shares/${shareId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect((await publicMetadata(token)).status).toBe(404)

    // Expired (created in the past)
    const fileId2 = await seedFile()
    const { token: token2 } = await createShareOk(fileId2)
    const now = Math.floor(Date.now() / 1000)
    await db.prepare('UPDATE shares SET expires_at = ? WHERE token_hash = ?').bind(now - 10, await sha256Hex(token2)).run()
    expect((await publicMetadata(token2)).status).toBe(404)

    // File deleted after sharing
    const fileId3 = await seedFile()
    const { token: token3 } = await createShareOk(fileId3)
    await db
      .prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
      .bind(now, fileId3)
      .run()
    expect((await publicMetadata(token3)).status).toBe(404)
  })

  it('allows exactly one winner under concurrent maxDownloads=1 downloads', async () => {
    const fileId = await seedFile('once.txt', 512)
    const { token } = await createShareOk(fileId, { maxDownloads: 1 })

    const results = await Promise.all(
      Array.from({ length: 5 }, () => publicDownload(token)),
    )
    const statuses = results.map((response) => response.status)
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    expect(statuses.filter((status) => status === 403)).toHaveLength(4)

    const share = db.rows('shares')[0]
    expect(share.download_count).toBe(1)
  })

  it('exhausts a maxDownloads=3 share on the fourth download', async () => {
    const fileId = await seedFile('three.txt', 256)
    const { token } = await createShareOk(fileId, { maxDownloads: 3 })

    for (let index = 0; index < 3; index++) {
      expect((await publicDownload(token)).status).toBe(200)
    }
    expect((await publicDownload(token)).status).toBe(403)
    expect(db.rows('shares')[0].download_count).toBe(3)
  })

  it('supports unlimited shares', async () => {
    const fileId = await seedFile('unlimited.txt', 128)
    const { token } = await createShareOk(fileId)
    for (let index = 0; index < 5; index++) {
      expect((await publicDownload(token)).status).toBe(200)
    }
  })

  it('streams share downloads with safe disposition and ranges', async () => {
    const fileId = await seedFile('中文 文件.bin', 1000)
    const { token } = await createShareOk(fileId)

    const full = await publicDownload(token)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe('1000')
    const disposition = full.headers.get('content-disposition') ?? ''
    expect(disposition).toContain("filename*=UTF-8''")
    expect(full.headers.get('x-content-type-options')).toBe('nosniff')
    const body = new Uint8Array(await full.arrayBuffer())
    expect(body).toHaveLength(1000)

    const partial = await publicDownload(token, 'bytes=0-99')
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe('bytes 0-99/1000')

    const bad = await publicDownload(token, 'bytes=9999-')
    expect(bad.status).toBe(416)
    expect(bad.headers.get('content-range')).toBe('bytes */1000')
  })

  it('burn-after-reading: second download is 403 and the file stays intact', async () => {
    const fileId = await seedFile('burn.txt', 256)
    const { token } = await createShareOk(fileId, {
      maxDownloads: 1,
      deleteFileAfterExhausted: true,
    })

    expect((await publicDownload(token)).status).toBe(200)
    expect((await publicDownload(token)).status).toBe(403)

    // Physical deletion is Phase 06 cron's job — file and object remain.
    expect(db.rows('files')[0].deleted_at ?? null).toBeNull()
    expect(bucket.keys()).toHaveLength(1)
  })

  it('lists shares without raw tokens and paginates', async () => {
    const fileId = await seedFile()
    const { shareId } = await createShareOk(fileId, { maxDownloads: 2 })

    const response = await app.request('/api/shares', { headers: { Cookie: cookie } }, env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      shares: Record<string, unknown>[]
      nextCursor: string | null
    }
    expect(body.shares).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
    expect(body.shares[0].id).toBe(shareId)
    expect(body.shares[0].fileName).toBe('shareme.txt')
    expect(JSON.stringify(body)).not.toMatch(/\/s\//)
  })

  it('revokes shares idempotently', async () => {
    const fileId = await seedFile()
    const { shareId, token } = await createShareOk(fileId)

    const first = await app.request(
      `/api/shares/${shareId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(first.status).toBe(204)
    expect(db.rows('shares')[0].revoked_at).not.toBeNull()

    const second = await app.request(
      `/api/shares/${shareId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(second.status).toBe(204)

    const missing = await app.request(
      '/api/shares/does-not-exist',
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(missing.status).toBe(404)

    expect((await publicDownload(token)).status).toBe(404)
  })

  it('share token hashing uses Web Crypto randomness', async () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(32)))
    expect(tokens.size).toBe(50)
  })
})
