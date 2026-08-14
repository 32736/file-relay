import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { apiError } from '../lib/errors'
import { retentionSeconds } from '../lib/r2'
import { requireUploadToken } from '../middleware/upload-token'

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'
const MIN_PART_SIZE = 5 * 1024 * 1024

export const publicUploadRoutes = new Hono<AppEnv>()
  .put('/:id/content', requireUploadToken, async (c) => {
    const session = c.var.uploadSession!
    if (session.status !== 'created' || session.mode !== 'single') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not ready for content')
    }

    const object = await c.env.BUCKET.put(session.object_key, c.req.raw.body, {
      httpMetadata: { contentType: session.mime_type ?? DEFAULT_CONTENT_TYPE },
    })
    if (object.size !== session.total_size) {
      await c.env.BUCKET.delete(session.object_key)
      return apiError(c, 400, 'SIZE_MISMATCH', 'Uploaded size does not match the declared size')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      insertIncomingFileStatement(c.env, session, object.size, object.etag, now),
      c.env.DB.prepare(
        'UPDATE upload_sessions SET status = ?, completed_at = ? WHERE id = ?',
      ).bind('completed', now, session.id),
    ])

    return c.json({
      id: session.file_id,
      name: session.original_name,
      size: object.size,
      etag: object.etag,
    })
  })
  .put('/:id/parts/:partNumber', requireUploadToken, async (c) => {
    const session = c.var.uploadSession!
    if (session.mode !== 'multipart') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not a multipart upload')
    }
    if (session.status !== 'created' && session.status !== 'uploading') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not accepting parts')
    }
    if (!session.r2_upload_id) {
      return apiError(c, 409, 'CONFLICT', 'Multipart upload is not initialized')
    }

    const partNumber = Number(c.req.param('partNumber'))
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.total_parts) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid part number')
    }

    const rawBody = c.req.raw.body
    if (!rawBody) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Part body is required')
    }
    const contentLength = Number(c.req.header('content-length'))
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Part must declare a Content-Length')
    }
    if (contentLength > session.chunk_size) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Part exceeds the chunk size')
    }
    const isLast = partNumber === session.total_parts
    if (!isLast && contentLength < MIN_PART_SIZE) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Non-final parts must be at least 5 MiB')
    }

    const multipart = c.env.BUCKET.resumeMultipartUpload(
      session.object_key,
      session.r2_upload_id,
    )
    const part = await multipart.uploadPart(partNumber, rawBody)

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR REPLACE INTO upload_parts
         (upload_session_id, part_number, etag, size, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(session.id, partNumber, part.etag, contentLength, now),
      c.env.DB.prepare('UPDATE upload_sessions SET status = ? WHERE id = ? AND status = ?').bind(
        'uploading',
        session.id,
        'created',
      ),
    ])

    return c.json({ partNumber, etag: part.etag })
  })
  .post('/:id/complete', requireUploadToken, async (c) => {
    const session = c.var.uploadSession!

    if (session.mode === 'single') {
      if (session.status !== 'completed') {
        return apiError(c, 409, 'CONFLICT', 'Upload session is not completed')
      }
      const file = await findFileRecord(c.env, session.file_id)
      if (!file) {
        return apiError(c, 409, 'CONFLICT', 'File record is missing')
      }
      return c.json({ id: file.id, name: file.original_name, size: file.size, etag: file.etag })
    }

    if (session.status === 'completed') {
      const existing = await findFileRecord(c.env, session.file_id)
      if (existing) {
        return c.json({ id: existing.id, name: existing.original_name, size: existing.size, etag: existing.etag })
      }
      const object = await c.env.BUCKET.head(session.object_key)
      if (object) {
        const now = Math.floor(Date.now() / 1000)
        await insertIncomingFileStatement(c.env, session, object.size, object.etag, now).run()
        return c.json({ id: session.file_id, name: session.original_name, size: object.size, etag: object.etag })
      }
      return apiError(c, 409, 'CONFLICT', 'Completed upload has no file record')
    }

    if (session.status !== 'uploading' || !session.r2_upload_id) {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not ready to complete')
    }

    const parts = await listUploadedParts(c.env, session.id)
    if (parts.length !== session.total_parts) {
      return apiError(c, 409, 'CONFLICT', 'Not all parts have been uploaded')
    }
    const seen = new Set(parts.map((part) => part.part_number))
    for (let number = 1; number <= session.total_parts; number++) {
      if (!seen.has(number)) {
        return apiError(c, 409, 'CONFLICT', 'Not all parts have been uploaded')
      }
    }

    const multipart = c.env.BUCKET.resumeMultipartUpload(
      session.object_key,
      session.r2_upload_id,
    )
    const object = await multipart.complete(
      parts.map((part) => ({ partNumber: part.part_number, etag: part.etag })),
    )
    if (object.size !== session.total_size) {
      await c.env.BUCKET.delete(session.object_key)
      return apiError(c, 400, 'SIZE_MISMATCH', 'Assembled file size does not match the declared size')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      insertIncomingFileStatement(c.env, session, object.size, object.etag, now),
      c.env.DB.prepare(
        'UPDATE upload_sessions SET status = ?, completed_at = ? WHERE id = ?',
      ).bind('completed', now, session.id),
    ])

    return c.json({ id: session.file_id, name: session.original_name, size: object.size, etag: object.etag })
  })
  .delete('/:id', requireUploadToken, async (c) => {
    const session = c.var.uploadSession!
    if (session.status === 'completed') {
      return apiError(c, 409, 'CONFLICT', 'A completed upload cannot be aborted')
    }
    if (session.status === 'aborted') {
      return c.body(null, 204)
    }
    if (session.mode === 'multipart' && session.r2_upload_id) {
      try {
        const multipart = c.env.BUCKET.resumeMultipartUpload(
          session.object_key,
          session.r2_upload_id,
        )
        await multipart.abort()
      } catch {
        // best-effort
      }
    }
    await c.env.DB.prepare('UPDATE upload_sessions SET status = ? WHERE id = ?')
      .bind('aborted', session.id)
      .run()
    return c.body(null, 204)
  })

interface FileRecord {
  id: string
  original_name: string
  size: number
  etag: string | null
}

async function findFileRecord(
  env: AppEnv['Bindings'],
  fileId: string,
): Promise<FileRecord | null> {
  return (
    (await env.DB.prepare('SELECT id, original_name, size, etag FROM files WHERE id = ?')
      .bind(fileId)
      .first<FileRecord>()) ?? null
  )
}

function insertIncomingFileStatement(
  env: AppEnv['Bindings'],
  session: {
    file_id: string
    object_key: string
    original_name: string
    mime_type: string | null
  },
  size: number,
  etag: string,
  now: number,
) {
  return env.DB.prepare(
    `INSERT INTO files
     (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    session.file_id,
    session.object_key,
    session.original_name,
    session.mime_type,
    size,
    etag,
    'incoming',
    now,
    now + retentionSeconds(env.DEFAULT_RETENTION_DAYS),
  )
}

async function listUploadedParts(
  env: AppEnv['Bindings'],
  sessionId: string,
): Promise<{ part_number: number; etag: string }[]> {
  const result = await env.DB.prepare(
    `SELECT part_number, etag FROM upload_parts
     WHERE upload_session_id = ? ORDER BY part_number ASC`,
  )
    .bind(sessionId)
    .all<{ part_number: number; etag: string }>()
  return result.results
}
