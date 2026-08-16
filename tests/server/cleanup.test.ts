import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runCleanup } from '../../server/services/cleanup'
import { D1Fake } from '../helpers/d1-fake'
import { R2Fake } from '../helpers/r2-fake'
import { makeTestEnv } from '../helpers/test-env'

const HOUR = 3600
const DAY = 24 * HOUR

describe('Phase 06 cleanup', () => {
  let db: D1Fake
  let bucket: R2Fake
  let env: ReturnType<typeof makeTestEnv>

  beforeEach(() => {
    db = new D1Fake()
    bucket = new R2Fake()
    env = makeTestEnv(db, bucket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function seedSession(id: string, expiresAt: number): Promise<void> {
    await db
      .prepare(
        'INSERT INTO sessions (id, token_hash, github_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(id, `hash-${id}`, '123456', expiresAt - 100, expiresAt)
      .run()
  }

  async function seedFile(
    id: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<string> {
    const objectKey = `objects/2026/08/${id}`
    await db
      .prepare(
        'INSERT INTO files (id, object_key, original_name, mime_type, size, etag, created_at, expires_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        id,
        objectKey,
        `${id}.txt`,
        'text/plain',
        100,
        'etag',
        0,
        overrides.expires_at ?? null,
        overrides.deleted_at ?? null,
      )
      .run()
    await bucket.put(objectKey, new Uint8Array(100))
    return objectKey
  }

  async function seedUploadSession(
    id: string,
    overrides: Partial<Record<string, unknown>> = {},
  ): Promise<void> {
    await db
      .prepare(
        `INSERT INTO upload_sessions
         (id, file_id, object_key, original_name, mime_type, total_size, chunk_size,
          total_parts, mode, r2_upload_id, status, created_at, expires_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        `file-${id}`,
        `objects/2026/08/file-${id}`,
        `${id}.bin`,
        'application/octet-stream',
        100,
        32,
        1,
        overrides.mode ?? 'single',
        overrides.r2_upload_id ?? null,
        overrides.status ?? 'created',
        0,
        overrides.expires_at ?? 0,
        null,
      )
      .run()
  }

  it('deletes expired sessions and keeps live ones', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedSession('expired', now - 100)
    await seedSession('live', now + DAY)

    await runCleanup(env)

    const remaining = db.rows('sessions').map((row) => row.id)
    expect(remaining).toEqual(['live'])
  })

  it('cleans stale upload sessions, aborting multiparts and removing parts', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedUploadSession('stale', { expires_at: now - 100 })
    await db
      .prepare(
        'INSERT INTO upload_parts (upload_session_id, part_number, etag, size, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind('stale', 1, 'etag-1', 10, now)
      .run()
    await seedUploadSession('stale-multipart', {
      expires_at: now - 100,
      mode: 'multipart',
      r2_upload_id: 'fake-mpu-1',
    })
    await bucket.createMultipartUpload('objects/2026/08/file-stale-multipart', {
      httpMetadata: { contentType: 'application/octet-stream' },
    })
    await seedUploadSession('live', { expires_at: now + DAY })

    await runCleanup(env)

    const remaining = db.rows('upload_sessions').map((row) => row.id)
    expect(remaining).toEqual(['live'])
    expect(db.rows('upload_parts')).toHaveLength(0)
    // The stale multipart was aborted (removed from the fake's multipart map).
    expect(bucket.multipartState('objects/2026/08/file-stale-multipart')).toBeUndefined()
  })

  it('logs out burn-after-reading files only after the safety window', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedFile('burn-old')
    await seedFile('burn-fresh')
    await seedFile('not-exhausted')

    // Old enough: exhausted, last download long ago
    await db
      .prepare(
        `INSERT INTO shares (id, file_id, token_hash, expires_at, max_downloads,
          download_count, last_download_at, delete_file_after_exhausted, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('s-old', 'burn-old', 'h-old', null, 1, 1, now - 2 * HOUR, 1, now, null)
      .run()
    // Too fresh: inside the safety window
    await db
      .prepare(
        `INSERT INTO shares (id, file_id, token_hash, expires_at, max_downloads,
          download_count, last_download_at, delete_file_after_exhausted, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('s-fresh', 'burn-fresh', 'h-fresh', null, 1, 1, now - 10, 1, now, null)
      .run()
    // Not exhausted
    await db
      .prepare(
        `INSERT INTO shares (id, file_id, token_hash, expires_at, max_downloads,
          download_count, last_download_at, delete_file_after_exhausted, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind('s-not', 'not-exhausted', 'h-not', null, 1, 0, now, 1, now, null)
      .run()

    await runCleanup(env)

    const files = db.rows('files')
    expect(files.find((row) => row.id === 'burn-old')?.deleted_at).not.toBeNull()
    expect(files.find((row) => row.id === 'burn-fresh')?.deleted_at ?? null).toBeNull()
    expect(files.find((row) => row.id === 'not-exhausted')?.deleted_at ?? null).toBeNull()
  })

  it('logically deletes expired files', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedFile('expired', { expires_at: now - 100 })
    await seedFile('live', { expires_at: now + DAY })
    await seedFile('never', { expires_at: null })

    await runCleanup(env)

    const files = db.rows('files')
    expect(files.find((row) => row.id === 'expired')?.deleted_at).not.toBeNull()
    expect(files.find((row) => row.id === 'live')?.deleted_at ?? null).toBeNull()
    expect(files.find((row) => row.id === 'never')?.deleted_at ?? null).toBeNull()
  })

  it('physically removes logically deleted files', async () => {
    const now = Math.floor(Date.now() / 1000)
    const objectKey = await seedFile('deleted', { deleted_at: now - 100 })
    await seedFile('live')

    await runCleanup(env)

    const remaining = db.rows('files').map((row) => row.id)
    expect(remaining).toEqual(['live'])
    expect(bucket.object(objectKey)).toBeNull()
    expect(bucket.keys()).toHaveLength(1)
  })

  it('deletes revoked and expired share rows', async () => {
    const now = Math.floor(Date.now() / 1000)
    for (const [id, tokenHash, revokedAt, expiresAt] of [
      ['revoked', 'h-rev', now - 100, null],
      ['expired-share', 'h-exp', null, now - 100],
      ['live-share', 'h-live', null, now + DAY],
    ] as [string, string, number | null, number | null][]) {
      await db
        .prepare(
          `INSERT INTO shares (id, file_id, token_hash, expires_at, max_downloads,
            download_count, last_download_at, delete_file_after_exhausted, created_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, `file-${id}`, tokenHash, expiresAt, null, 0, null, 0, now, revokedAt)
        .run()
    }

    await runCleanup(env)

    const remaining = db.rows('shares').map((row) => row.id)
    expect(remaining).toEqual(['live-share'])
  })

  it('removes consumed and expired Magic Link tokens while keeping active tokens', async () => {
    const now = Math.floor(Date.now() / 1000)
    for (const [id, tokenHash, expiresAt, consumedAt] of [
      ['expired-link', 'magic-expired', now - 1, null],
      ['consumed-link', 'magic-consumed', now + DAY, now - 1],
      ['active-link', 'magic-active', now + DAY, null],
    ] as [string, string, number, number | null][]) {
      await db
        .prepare(
          `INSERT INTO magic_link_tokens
           (id, token_hash, github_user_id, created_at, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, tokenHash, '123456', now, expiresAt, consumedAt)
        .run()
    }

    await runCleanup(env)

    expect(db.rows('magic_link_tokens').map((row) => row.id)).toEqual(['active-link'])
  })

  it('respects the batch bound per run and drains on the next run', async () => {
    const now = Math.floor(Date.now() / 1000)
    // 60 expired sessions; the batch bound (50) must cap the first run.
    for (let index = 0; index < 60; index++) {
      await seedSession(`expired-${index}`, now - 100)
    }

    await runCleanup(env)
    expect(db.rows('sessions')).toHaveLength(10)

    await runCleanup(env)
    expect(db.rows('sessions')).toHaveLength(0)
  })

  it('is idempotent on a second pass', async () => {
    const now = Math.floor(Date.now() / 1000)
    await seedSession('expired', now - 100)
    await seedFile('deleted', { deleted_at: now - 100 })

    await runCleanup(env)
    await runCleanup(env)

    expect(db.rows('sessions')).toHaveLength(0)
    expect(db.rows('files')).toHaveLength(0)
    expect(bucket.keys()).toHaveLength(0)
  })


})
