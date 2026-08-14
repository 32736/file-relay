import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { apiError } from '../lib/errors'
import { chunkSize, maxFileSize, objectKeyFor, retentionSeconds } from '../lib/r2'
import { createUploadSchema } from '../lib/validate'
import { requireAuth, requireSameOrigin } from '../middleware/auth'

const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

interface UploadSessionRow {
  id: string
  file_id: string
  object_key: string
  original_name: string
  mime_type: string | null
  total_size: number
  chunk_size: number
  total_parts: number
  mode: string
  auth_kind: string
  status: string
  expires_at: number
}

async function findSession(
  env: AppEnv['Bindings'],
  sessionId: string,
): Promise<UploadSessionRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, file_id, object_key, original_name, mime_type, total_size,
              chunk_size, total_parts, mode, auth_kind, status, expires_at
       FROM upload_sessions WHERE id = ?`,
    )
      .bind(sessionId)
      .first<UploadSessionRow>()) ?? null
  )
}

export const uploadRoutes = new Hono<AppEnv>()
  .post('/', requireAuth, requireSameOrigin, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createUploadSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid upload request')
    }
    const { name, size, type } = parsed.data

    const maxSize = maxFileSize(c.env.MAX_FILE_SIZE)
    if (size > maxSize) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'File exceeds the maximum allowed size')
    }

    const chunk = chunkSize(c.env.UPLOAD_CHUNK_SIZE)
    if (size > chunk) {
      return apiError(
        c,
        413,
        'PAYLOAD_TOO_LARGE',
        'Files above the chunk size need multipart upload, which is not available yet',
      )
    }

    const fileId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const objectKey = objectKeyFor(fileId, new Date())

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO upload_sessions
         (id, file_id, object_key, original_name, mime_type, total_size, chunk_size,
          total_parts, mode, auth_kind, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        sessionId,
        fileId,
        objectKey,
        name,
        type ?? null,
        size,
        chunk,
        1,
        'single',
        'owner',
        'created',
        now,
        now + UPLOAD_SESSION_TTL_SECONDS,
      ),
    ])

    return c.json({ uploadId: sessionId, mode: 'single', chunkSize: chunk, totalParts: 1 })
  })
  .get('/:id', requireAuth, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session || session.auth_kind !== 'owner') {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }
    return c.json({
      status: session.status,
      mode: session.mode,
      chunkSize: session.chunk_size,
      totalParts: session.total_parts,
    })
  })
  .put('/:id/content', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session || session.auth_kind !== 'owner') {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }
    if (session.status !== 'created' || session.mode !== 'single') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not ready for content')
    }
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      return apiError(c, 409, 'CONFLICT', 'Upload session has expired')
    }

    // Stream the request body straight to R2; never buffer it in the Worker.
    const object = await c.env.BUCKET.put(session.object_key, c.req.raw.body, {
      httpMetadata: {
        contentType: session.mime_type ?? DEFAULT_CONTENT_TYPE,
      },
    })

    if (object.size !== session.total_size) {
      await c.env.BUCKET.delete(session.object_key)
      return apiError(c, 400, 'SIZE_MISMATCH', 'Uploaded size does not match the declared size')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO files
         (id, object_key, original_name, mime_type, size, etag, source, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        session.file_id,
        session.object_key,
        session.original_name,
        session.mime_type,
        object.size,
        object.etag,
        'owner',
        now,
        now + retentionSeconds(c.env.DEFAULT_RETENTION_DAYS),
      ),
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
  .post('/:id/complete', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session || session.auth_kind !== 'owner') {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }

    if (session.status !== 'completed') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not completed')
    }

    const file = await c.env.DB.prepare(
      'SELECT id, original_name, size, etag FROM files WHERE id = ?',
    )
      .bind(session.file_id)
      .first<{ id: string; original_name: string; size: number; etag: string | null }>()
    if (!file) {
      return apiError(c, 409, 'CONFLICT', 'File record is missing')
    }

    return c.json({ id: file.id, name: file.original_name, size: file.size, etag: file.etag })
  })
  .delete('/:id', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session || session.auth_kind !== 'owner') {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }

    if (session.status === 'completed') {
      return apiError(c, 409, 'CONFLICT', 'A completed upload cannot be aborted')
    }
    if (session.status === 'aborted') {
      return c.body(null, 204)
    }

    await c.env.DB.prepare('UPDATE upload_sessions SET status = ? WHERE id = ?')
      .bind('aborted', session.id)
      .run()
    return c.body(null, 204)
  })
