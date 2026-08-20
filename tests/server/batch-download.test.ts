import { beforeEach, describe, expect, it } from 'vitest'

import { app } from '../../server/index'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv, seedOwnerSession } from '../helpers/test-env'

const ORIGIN = 'http://localhost'

describe('batch ZIP downloads', () => {
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

  async function seedFile(id: string, name: string, content: string): Promise<void> {
    const key = `objects/2026/08/${id}`
    const now = Math.floor(Date.now() / 1000)
    const bytes = new TextEncoder().encode(content)
    await db
      .prepare(
        'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(id, key, name, 'text/plain', bytes.byteLength, `etag-${id}`, now, now + 3600, null)
      .run()
    await bucket.put(key, bytes)
  }

  it('streams a ZIP containing selected files with safe unique names', async () => {
    const first = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    await seedFile(first, '报告.txt', 'one')
    await seedFile(second, '报告.txt', 'two')

    const response = await app.request(
      '/api/files/batch-download',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [first, second, first] }),
      },
      env,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toContain('drop-files-')

    const archive = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))
    expect(archive).toContain('报告.txt')
    expect(archive).toContain('报告 (2).txt')
    expect(archive).toContain('one')
    expect(archive).toContain('two')
    expect(archive.slice(-22, -18)).toBe('PK\x05\x06')
    expect(db.rows('audit_logs').some((row) => row.action === 'file.batch_downloaded')).toBe(true)
  })

  it('rejects the batch route without same-origin authentication', async () => {
    const id = '00000000-0000-4000-8000-000000000003'
    await seedFile(id, 'a.txt', 'a')
    const response = await app.request(
      '/api/files/batch-download',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      },
      env,
    )
    expect(response.status).toBe(403)
  })
})
