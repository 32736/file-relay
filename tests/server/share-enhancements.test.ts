import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
import { hmacSha256Hex } from '../../server/lib/crypto'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

const LOCAL_ORIGIN = 'http://localhost'

describe('Phase 07 share enhancements', () => {
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
    mime: string | null = 'text/plain',
    size = 1024,
  ): Promise<string> {
    const fileId = crypto.randomUUID()
    const objectKey = `objects/2026/08/${fileId}`
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare(
        'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(fileId, objectKey, name, mime, size, 'etag-x', 'owner', now, now + 2592000, null)
      .run()
    await bucket.put(objectKey, new Uint8Array(size))
    return fileId
  }

  async function createShare(
    fileId: string,
    body: Record<string, unknown> = {},
  ): Promise<{ token: string; shareId: string; body: Record<string, unknown> }> {
    const response = await app.request(
      `/api/files/${fileId}/shares`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify(body),
      },
      env,
    )
    expect(response.status).toBe(200)
    const result = (await response.json()) as Record<string, unknown> & { url: string }
    const token = result.url.split('/s/')[1]
    return { token, shareId: String(result.id), body: result }
  }

  async function unlock(token: string, password: string): Promise<Response> {
    return await app.request(
      `/api/public/shares/${token}/unlock`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      },
      env,
    )
  }

  async function download(token: string, cookieValue?: string): Promise<Response> {
    const headers: Record<string, string> = {}
    if (cookieValue !== undefined) headers.Cookie = cookieValue
    return await app.request(`/api/public/shares/${token}/download`, { headers }, env)
  }

  it('stores an HMAC password MAC and reports passwordRequired', async () => {
    const fileId = await seedFile('secret.txt')
    const { token, shareId } = await createShare(fileId, { password: 's3cret' })

    const rows = db.rows('shares')
    const expectedMac = await hmacSha256Hex(env.TOKEN_HMAC_SECRET, `${shareId}\0s3cret`)
    expect(rows[0].password_mac).toBe(expectedMac)
    expect(rows[0].password_mac).not.toBe('s3cret')

    const metadata = await app.request(`/api/public/shares/${token}`, {}, env)
    const body = (await metadata.json()) as { passwordRequired: boolean }
    expect(body.passwordRequired).toBe(true)
  })

  it('unlock sets an HttpOnly cookie equal to the MAC', async () => {
    const fileId = await seedFile('secret.txt')
    const { token, shareId } = await createShare(fileId, { password: 's3cret' })

    const response = await unlock(token, 's3cret')
    expect(response.status).toBe(200)
    const setCookies = response.headers.getSetCookie()
    const unlockCookie = setCookies.find((c) => c.startsWith(`share_unlock_${shareId}=`))
    expect(unlockCookie).toBeDefined()
    expect(unlockCookie).toContain('HttpOnly')
    const value = unlockCookie!.split(';')[0].split('=')[1]
    const mac = await hmacSha256Hex(env.TOKEN_HMAC_SECRET, `${shareId}\0s3cret`)
    expect(value).toBe(mac)
  })

  it('rejects a wrong password without a cookie', async () => {
    const fileId = await seedFile('secret.txt')
    const { token } = await createShare(fileId, { password: 's3cret' })
    const response = await unlock(token, 'wrong')
    expect(response.status).toBe(403)
    expect(response.headers.getSetCookie()).toHaveLength(0)
  })

  it('gates downloads on the unlock cookie without wasting a claim', async () => {
    const fileId = await seedFile('secret.txt')
    const { token, shareId } = await createShare(fileId, { password: 's3cret', maxDownloads: 1 })

    // No cookie → 403, and the claim is NOT consumed.
    const denied = await download(token)
    expect(denied.status).toBe(403)
    expect(db.rows('shares')[0].download_count).toBe(0)

    // Wrong cookie value → 403, still no claim.
    const deniedWrong = await download(token, `share_unlock_${shareId}=not-the-mac`)
    expect(deniedWrong.status).toBe(403)
    expect(db.rows('shares')[0].download_count).toBe(0)

    // Correct cookie → 200 and the claim is consumed.
    const mac = await hmacSha256Hex(env.TOKEN_HMAC_SECRET, `${shareId}\0s3cret`)
    const allowed = await download(token, `share_unlock_${shareId}=${mac}`)
    expect(allowed.status).toBe(200)
    expect(db.rows('shares')[0].download_count).toBe(1)

    // Exhausted now, even with the cookie.
    const exhausted = await download(token, `share_unlock_${shareId}=${mac}`)
    expect(exhausted.status).toBe(403)
  })

  it('unprotected shares download without an unlock cookie', async () => {
    const fileId = await seedFile('open.txt')
    const { token } = await createShare(fileId)
    const response = await download(token)
    expect(response.status).toBe(200)
  })

  it('serves whitelisted preview types inline and others as attachment', async () => {
    for (const [mime, expected] of [
      ['image/png', 'inline'],
      ['image/jpeg', 'inline'],
      ['image/webp', 'inline'],
      ['image/gif', 'inline'],
      ['application/pdf', 'inline'],
      ['text/html', 'attachment'],
      ['image/svg+xml', 'attachment'],
      ['application/xhtml+xml', 'attachment'],
      ['application/zip', 'attachment'],
      [null, 'attachment'],
    ] as [string | null, string][]) {
      const fileId = await seedFile(`type-${mime ?? 'none'}.bin`, mime)
      const response = await app.request(
        `/api/files/${fileId}/download`,
        { headers: { Cookie: cookie } },
        env,
      )
      expect(response.status).toBe(200)
      const disposition = response.headers.get('content-disposition') ?? ''
      expect(disposition.startsWith(expected), `${mime} -> ${disposition}`).toBe(true)
    }
  })

  it('applies the preview whitelist to public downloads too', async () => {
    const fileId = await seedFile('pic.png', 'image/png')
    const { token } = await createShare(fileId)
    const response = await download(token)
    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition.startsWith('inline')).toBe(true)
  })

  it('reports storage statistics for non-deleted files only', async () => {
    await seedFile('a.bin', 'application/octet-stream', 1000)
    await seedFile('b.bin', 'application/octet-stream', 2000)
    const fileId = await seedFile('c.bin', 'application/octet-stream', 3000)
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
      .bind(now, fileId)
      .run()

    const response = await app.request('/api/stats', { headers: { Cookie: cookie } }, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ fileCount: 2, totalBytes: 3000 })
  })

  it('returns zero stats for an empty table', async () => {
    const response = await app.request('/api/stats', { headers: { Cookie: cookie } }, env)
    await expect(response.json()).resolves.toEqual({ fileCount: 0, totalBytes: 0 })
  })

  it('batch-deletes multiple files logically and reports the count', async () => {
    const first = await seedFile('one.txt')
    const second = await seedFile('two.txt')
    const third = await seedFile('three.txt')
    const now = Math.floor(Date.now() / 1000)
    await db
      .prepare('UPDATE files SET deleted_at = ? WHERE id = ?')
      .bind(now, third)
      .run()

    const response = await app.request(
      '/api/files/batch-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: [first, second, third] }),
      },
      env,
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ deleted: 2 })

    const list = await app.request('/api/files', { headers: { Cookie: cookie } }, env)
    const body = (await list.json()) as { files: unknown[] }
    expect(body.files).toHaveLength(0)
  })

  it('rejects invalid batch-delete bodies', async () => {
    for (const body of [
      { ids: [] },
      { ids: Array.from({ length: 101 }, () => crypto.randomUUID()) },
      { ids: ['not-a-uuid'] },
      {},
    ]) {
      const response = await app.request(
        '/api/files/batch-delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
          body: JSON.stringify(body),
        },
        env,
      )
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
  })

  it('searches filenames case-insensitively with literal wildcards', async () => {
    await seedFile('Project-Report.pdf')
    await seedFile('project_notes.txt')
    await seedFile('Other.zip')

    const search = async (q: string): Promise<string[]> => {
      const response = await app.request(
        `/api/files?q=${encodeURIComponent(q)}`,
        { headers: { Cookie: cookie } },
        env,
      )
      const body = (await response.json()) as { files: { name: string }[] }
      // Same-second uploads share created_at; order is by random id, so
      // compare sets rather than order.
      return body.files.map((file) => file.name).sort()
    }

    expect(await search('project')).toEqual(['Project-Report.pdf', 'project_notes.txt'].sort())
    expect(await search('PROJECT')).toEqual(['Project-Report.pdf', 'project_notes.txt'].sort())
    expect(await search('notes')).toEqual(['project_notes.txt'])
    // `%` is literal, not a wildcard.
    expect(await search('100%')).toEqual([])
    expect(await search('')).toEqual(['Other.zip', 'project_notes.txt', 'Project-Report.pdf'].sort())
  })
})
