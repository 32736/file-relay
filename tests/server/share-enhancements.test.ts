import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
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
