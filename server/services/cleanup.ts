import type { Bindings } from '../env'

const BATCH_SIZE = 50
const BURN_SAFETY_WINDOW_SECONDS = 60 * 60

/**
 * Scheduled cleanup pass (plan §35). Each task is bounded so no task scans the
 * whole database; the hourly cron drains backlog over successive runs. Task
 * order matters: upstream tasks produce the rows downstream tasks consume.
 */
export async function runCleanup(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  await cleanupExpiredSessions(env, now)
  await cleanupStaleUploadSessions(env, now)
  await cleanupBurnAfterReadingFiles(env, now)
  await cleanupExpiredFiles(env, now)
  await cleanupDeletedFiles(env)
  await cleanupShares(env, now)
}

async function cleanupExpiredSessions(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ? LIMIT ?')
    .bind(now, BATCH_SIZE)
    .run()
}

async function cleanupStaleUploadSessions(env: Bindings, now: number): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, object_key, mode, r2_upload_id FROM upload_sessions
     WHERE status IN ('created', 'uploading') AND expires_at <= ?
     LIMIT ?`,
  )
    .bind(now, BATCH_SIZE)
    .all<{ id: string; object_key: string; mode: string; r2_upload_id: string | null }>()

  for (const row of rows.results) {
    // Best-effort: an already-aborted multipart throws; rows are removed anyway
    // and any orphaned R2 multipart is reclaimed by R2's own lifecycle.
    if (row.mode === 'multipart' && row.r2_upload_id) {
      try {
        const multipart = env.BUCKET.resumeMultipartUpload(row.object_key, row.r2_upload_id)
        await multipart.abort()
      } catch {
        // ignore
      }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM upload_parts WHERE upload_session_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM upload_sessions WHERE id = ?').bind(row.id),
    ])
  }
}

async function cleanupBurnAfterReadingFiles(env: Bindings, now: number): Promise<void> {
  // Safety window (plan §34): only logically delete after the last download is
  // old enough that the final stream cannot race the deletion.
  const cutoff = now - BURN_SAFETY_WINDOW_SECONDS
  const rows = await env.DB.prepare(
    `SELECT file_id FROM shares
     WHERE delete_file_after_exhausted = 1
       AND max_downloads IS NOT NULL
       AND download_count >= max_downloads
       AND last_download_at IS NOT NULL AND last_download_at <= ?
       AND revoked_at IS NULL
     LIMIT ?`,
  )
    .bind(cutoff, BATCH_SIZE)
    .all<{ file_id: string }>()

  for (const row of rows.results) {
    await env.DB.prepare('UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .bind(now, row.file_id)
      .run()
  }
}

async function cleanupExpiredFiles(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE files SET deleted_at = ?
     WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     LIMIT ?`,
  )
    .bind(now, now, BATCH_SIZE)
    .run()
}

async function cleanupDeletedFiles(env: Bindings): Promise<void> {
  const rows = await env.DB.prepare(
    'SELECT id, object_key FROM files WHERE deleted_at IS NOT NULL LIMIT ?',
  )
    .bind(BATCH_SIZE)
    .all<{ id: string; object_key: string }>()

  for (const row of rows.results) {
    // Two-phase deletion: if the R2 delete fails, the row keeps deleted_at and
    // the next run retries (R2 delete is idempotent).
    try {
      await env.BUCKET.delete(row.object_key)
    } catch {
      continue
    }
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(row.id).run()
  }
}

async function cleanupShares(env: Bindings, now: number): Promise<void> {
  await env.DB.prepare('DELETE FROM shares WHERE revoked_at IS NOT NULL LIMIT ?')
    .bind(BATCH_SIZE)
    .run()
  await env.DB.prepare(
    `DELETE FROM shares
     WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     LIMIT ?`,
  )
    .bind(now, BATCH_SIZE)
    .run()
}

