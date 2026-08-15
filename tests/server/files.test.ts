import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from '../../server/index'
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

interface UploadResult {
  fileId: string
  uploadId: string
}

async function uploadFile(
  env: ReturnType<typeof makeTestEnv>,
  cookie: string,
  name: string,
  size: number,
): Promise<UploadResult> {
  const create = await app.request(
    '/api/uploads',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
      body: JSON.stringify({ name, size, type: 'application/octet-stream' }),
    },
    env,
  )
  const { uploadId } = (await create.json()) as { uploadId: string }

  const put = await app.request(
    `/api/uploads/${uploadId}/content`,
    {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: LOCAL_ORIGIN },
      body: streamOf(new Uint8Array(size)),
      duplex: 'half',
    } as RequestInit,
    env,
  )
  const file = (await put.json()) as { id: string }
  return { fileId: file.id, uploadId }
}

async function seedFile(
  db: D1Fake,
  overrides: Partial<Record<string, unknown>> & { id: string; created_at: number },
): Promise<void> {
  const row = {
    ...overrides,
    id: overrides.id,
    object_key: `objects/2026/08/${overrides.id}`,
    original_name: `${overrides.id}.txt`,
    mime_type: 'text/plain',
    size: 100,
    etag: `etag-${overrides.id}`,
    source: 'owner',
    created_at: overrides.created_at,
    expires_at: overrides.created_at + 2592000,
    deleted_at: null,
  }
  await db
    .prepare(
      'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      row.id,
      row.object_key,
      row.original_name,
      row.mime_type,
      row.size,
      row.etag,
      row.source,
      row.created_at,
      row.expires_at,
      row.deleted_at,
    )
    .run()
}

describe('Phase 02 files', () => {
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

  it('rejects list, detail and delete without authentication', async () => {
    for (const [method, path] of [
      ['GET', '/api/files'],
      ['GET', '/api/files/some-id'],
      ['DELETE', '/api/files/some-id'],
    ] as [string, string][]) {
      const response = await app.request(path, { method }, env)
      expect(response.status, `${method} ${path}`).toBe(401)
    }
  })

  it('lists only completed, non-deleted files without internal fields', async () => {
    await uploadFile(env, cookie, 'first.txt', 1024)
    await uploadFile(env, cookie, 'second.txt', 2048)

    const response = await app.request('/api/files', { headers: { Cookie: cookie } }, env)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      files: { id: string; name: string; size: number; mimeType: string; createdAt: number }[]
      nextCursor: string | null
    }
    expect(body.files).toHaveLength(2)
    expect(body.nextCursor).toBeNull()
    expect(body.files.map((f) => f.name).sort()).toEqual(['first.txt', 'second.txt'])
    for (const file of body.files) {
      expect(file.id).toBeTruthy()
      expect(file.size).toBeGreaterThan(0)
      expect(file.mimeType).toBe('application/octet-stream')
      expect(file.createdAt).toBeGreaterThan(0)
      expect(Object.keys(file).sort()).toEqual(['createdAt', 'id', 'mimeType', 'name', 'size'])
    }
  })

  it('paginates with limit and cursor', async () => {
    seedFile(db, { id: 'f1', created_at: 100 })
    seedFile(db, { id: 'f2', created_at: 200 })
    seedFile(db, { id: 'f3', created_at: 300 })

    const first = await app.request(
      '/api/files?limit=2',
      { headers: { Cookie: cookie } },
      env,
    )
    const firstBody = (await first.json()) as {
      files: { id: string; createdAt: number }[]
      nextCursor: string | null
    }
    expect(firstBody.files).toHaveLength(2)
    expect(firstBody.files.map((f) => f.id)).toEqual(['f3', 'f2']) // newest first
    expect(firstBody.nextCursor).toBe('2')

    const second = await app.request(
      `/api/files?limit=2&cursor=${firstBody.nextCursor}`,
      { headers: { Cookie: cookie } },
      env,
    )
    const secondBody = (await second.json()) as {
      files: { id: string; createdAt: number }[]
      nextCursor: string | null
    }
    expect(secondBody.files.map((f) => f.id)).toEqual(['f1'])
    expect(secondBody.nextCursor).toBeNull()
  })

  it('filters logically deleted files out of the listing', async () => {
    await uploadFile(env, cookie, 'keep.txt', 512)
    const removed = await uploadFile(env, cookie, 'remove.txt', 512)

    const del = await app.request(
      `/api/files/${removed.fileId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(del.status).toBe(204)

    const list = await app.request('/api/files', { headers: { Cookie: cookie } }, env)
    const body = (await list.json()) as { files: { name: string }[] }
    expect(body.files.map((f) => f.name)).toEqual(['keep.txt'])
  })

  it('returns a file detail and 404 after logical deletion', async () => {
    const { fileId } = await uploadFile(env, cookie, 'detail.txt', 256)

    const detail = await app.request(
      `/api/files/${fileId}`,
      { headers: { Cookie: cookie } },
      env,
    )
    expect(detail.status).toBe(200)
    await expect(detail.json()).resolves.toMatchObject({ id: fileId, name: 'detail.txt' })

    await app.request(
      `/api/files/${fileId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    const gone = await app.request(
      `/api/files/${fileId}`,
      { headers: { Cookie: cookie } },
      env,
    )
    expect(gone.status).toBe(404)
  })

  it('deletes logically and idempotently; unknown ids are 404', async () => {
    const { fileId } = await uploadFile(env, cookie, 'trash.txt', 128)

    const first = await app.request(
      `/api/files/${fileId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(first.status).toBe(204)
    const deletedAt = db.rows('files')[0].deleted_at
    expect(deletedAt).toBeGreaterThan(0)

    const repeat = await app.request(
      `/api/files/${fileId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(repeat.status).toBe(204)

    const missing = await app.request(
      '/api/files/does-not-exist',
      { method: 'DELETE', headers: { Cookie: cookie, Origin: LOCAL_ORIGIN } },
      env,
    )
    expect(missing.status).toBe(404)
  })

  it('rejects cross-origin deletion', async () => {
    const { fileId } = await uploadFile(env, cookie, 'safe.txt', 128)
    const response = await app.request(
      `/api/files/${fileId}`,
      { method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://evil.example' } },
      env,
    )
    expect(response.status).toBe(403)
    expect(db.rows('files')[0].deleted_at ?? null).toBeNull()
  })
})

describe('batch-restore (UI undo for logical delete)', () => {
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

  it('requires authentication and same-origin', async () => {
    const unauth = await app.request(
      '/api/files/batch-restore',
      { method: 'POST', body: JSON.stringify({ ids: [] }) },
      env,
    )
    expect(unauth.status).toBe(401)

    const crossOrigin = await app.request(
      '/api/files/batch-restore',
      {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://evil.example' },
        body: JSON.stringify({ ids: [] }),
      },
      env,
    )
    expect(crossOrigin.status).toBe(403)
  })

  it('validates the body', async () => {
    const response = await app.request(
      '/api/files/batch-restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: ['not-a-uuid'] }),
      },
      env,
    )
    expect(response.status).toBe(400)
  })

  it('restores logically deleted files and reports the count', async () => {
    const first = await uploadFile(env, cookie, 'first.txt', 10)
    const second = await uploadFile(env, cookie, 'second.txt', 20)

    // Logically delete both.
    const del = await app.request(
      '/api/files/batch-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: [first.fileId, second.fileId] }),
      },
      env,
    )
    expect(del.status).toBe(200)
    expect((await del.json()) as { deleted: number }).toEqual({ deleted: 2 })
    expect((await app.request(`/api/files/${first.fileId}`, { headers: { Cookie: cookie } }, env)).status).toBe(404)

    // Restore both; the detail endpoints become reachable again.
    const restore = await app.request(
      '/api/files/batch-restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: [first.fileId, second.fileId] }),
      },
      env,
    )
    expect(restore.status).toBe(200)
    expect((await restore.json()) as { restored: number }).toEqual({ restored: 2 })
    expect((await app.request(`/api/files/${first.fileId}`, { headers: { Cookie: cookie } }, env)).status).toBe(200)
    expect((await app.request(`/api/files/${second.fileId}`, { headers: { Cookie: cookie } }, env)).status).toBe(200)
  })

  it('restores only rows that are actually deleted', async () => {
    const live = await uploadFile(env, cookie, 'live.txt', 10)
    const deleted = await uploadFile(env, cookie, 'deleted.txt', 10)
    await app.request(
      '/api/files/batch-delete',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: [deleted.fileId] }),
      },
      env,
    )

    const restore = await app.request(
      '/api/files/batch-restore',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: LOCAL_ORIGIN },
        body: JSON.stringify({ ids: [live.fileId, deleted.fileId] }),
      },
      env,
    )
    expect((await restore.json()) as { restored: number }).toEqual({ restored: 1 })
  })
})
