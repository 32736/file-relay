import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { apiError } from '../lib/errors'
import { chunkSize, maxFileSize, objectKeyFor, retentionSeconds } from '../lib/r2'
import { createUploadSchema } from '../lib/validate'
import { requireAuth, requireSameOrigin } from '../middleware/auth'
import { recordAudit } from '../services/audit'

const UPLOAD_SESSION_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_CONTENT_TYPE = 'application/octet-stream'
const MIN_PART_SIZE = 5 * 1024 * 1024 // R2 multipart floor for non-final parts
const MAX_MULTIPART_PARTS = 10_000 // R2 multipart limit

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
  r2_upload_id: string | null
  status: string
  expires_at: number
  file_expires_at: number | null
}

interface UploadedPartRow {
  part_number: number
  etag: string
}

interface FileRecordRow {
  id: string
  original_name: string
  size: number
  etag: string | null
}

async function findSession(
  env: AppEnv['Bindings'],
  sessionId: string,
): Promise<UploadSessionRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, file_id, object_key, original_name, mime_type, total_size,
              chunk_size, total_parts, mode, r2_upload_id, status, expires_at,
              file_expires_at
       FROM upload_sessions WHERE id = ?`,
    )
      .bind(sessionId)
      .first<UploadSessionRow>()) ?? null
  )
}

function insertSessionStatement(
  env: AppEnv['Bindings'],
  params: {
    sessionId: string
    fileId: string
    objectKey: string
    name: string
    type: string | null | undefined
    size: number
    chunk: number
    totalParts: number
    mode: string
    r2UploadId: string | null
    now: number
    fileExpiresAt: number | null
  },
) {
  return env.DB.prepare(
    `INSERT INTO upload_sessions
     (id, file_id, object_key, original_name, mime_type, total_size, chunk_size,
     total_parts, mode, r2_upload_id, status, created_at, expires_at, file_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    params.sessionId,
    params.fileId,
    params.objectKey,
    params.name,
    params.type,
    params.size,
    params.chunk,
    params.totalParts,
    params.mode,
    params.r2UploadId,
    'created',
    params.now,
    params.now + UPLOAD_SESSION_TTL_SECONDS,
    params.fileExpiresAt,
  )
}

function insertFileStatement(
  env: AppEnv['Bindings'],
  session: UploadSessionRow,
  size: number,
  etag: string,
  now: number,
) {
  return env.DB.prepare(
    `INSERT INTO files
     (id, object_key, original_name, mime_type, size, etag, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    session.file_id,
    session.object_key,
    session.original_name,
    session.mime_type,
    size,
    etag,
    now,
    session.file_expires_at,
  )
}

function toFileJson(file: FileRecordRow) {
  return { id: file.id, name: file.original_name, size: file.size, etag: file.etag }
}

async function auditCompletedUpload(
  env: AppEnv['Bindings'],
  actorGithubId: string,
  session: UploadSessionRow,
  size: number,
): Promise<void> {
  await recordAudit(env, {
    actorGithubId,
    action: 'file.uploaded',
    targetType: 'file',
    targetId: session.file_id,
    metadata: { size },
  })
}

async function findFileRecord(
  env: AppEnv['Bindings'],
  fileId: string,
): Promise<FileRecordRow | null> {
  return (
    (await env.DB.prepare('SELECT id, original_name, size, etag FROM files WHERE id = ?')
      .bind(fileId)
      .first<FileRecordRow>()) ?? null
  )
}

async function listUploadedParts(
  env: AppEnv['Bindings'],
  sessionId: string,
): Promise<UploadedPartRow[]> {
  const result = await env.DB.prepare(
    `SELECT part_number, etag FROM upload_parts
     WHERE upload_session_id = ? ORDER BY part_number ASC`,
  )
    .bind(sessionId)
    .all<UploadedPartRow>()
  return result.results
}

export const uploadRoutes = new Hono<AppEnv>()
  .post('/', requireAuth, requireSameOrigin, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createUploadSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid upload request')
    }
    const { name, size, type, expiresIn } = parsed.data

    const maxSize = maxFileSize(c.env.MAX_FILE_SIZE)
    if (size > maxSize) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'File exceeds the maximum allowed size')
    }

    const chunk = chunkSize(c.env.UPLOAD_CHUNK_SIZE)
    const fileId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const defaultRetention = retentionSeconds(c.env.DEFAULT_RETENTION_DAYS)
    const effectiveRetention = expiresIn ?? defaultRetention
    const fileExpiresAt = effectiveRetention === null ? null : now + effectiveRetention
    const objectKey = objectKeyFor(fileId, new Date())

    if (size <= chunk) {
      await insertSessionStatement(c.env, {
        sessionId,
        fileId,
        objectKey,
        name,
        type,
        size,
        chunk,
        totalParts: 1,
        mode: 'single',
        r2UploadId: null,
        now,
        fileExpiresAt,
      }).run()
      return c.json({ uploadId: sessionId, mode: 'single', chunkSize: chunk, totalParts: 1 })
    }

    // Multipart upload for files above the chunk size.
    const totalParts = Math.ceil(size / chunk)
    if (totalParts > MAX_MULTIPART_PARTS) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'File requires too many parts')
    }

    let r2UploadId: string
    try {
      const multipart = await c.env.BUCKET.createMultipartUpload(objectKey, {
        httpMetadata: { contentType: type ?? DEFAULT_CONTENT_TYPE },
      })
      r2UploadId = multipart.uploadId
    } catch {
      return apiError(c, 502, 'UPSTREAM_ERROR', 'Failed to start the multipart upload')
    }

    await insertSessionStatement(c.env, {
      sessionId,
      fileId,
      objectKey,
      name,
      type,
      size,
      chunk,
      totalParts,
      mode: 'multipart',
      r2UploadId,
      now,
      fileExpiresAt,
    }).run()

    return c.json({ uploadId: sessionId, mode: 'multipart', chunkSize: chunk, totalParts })
  })
  .get('/:id', requireAuth, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session) {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }

    const base = {
      status: session.status,
      mode: session.mode,
      chunkSize: session.chunk_size,
      totalParts: session.total_parts,
    }
    if (session.mode !== 'multipart') {
      return c.json(base)
    }

    const parts = await listUploadedParts(c.env, session.id)
    return c.json({
      ...base,
      completedParts: parts.map((part) => ({
        partNumber: part.part_number,
        etag: part.etag,
      })),
    })
  })
  .put('/:id/content', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session) {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }
    if (session.status !== 'created' || session.mode !== 'single') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not ready for content')
    }
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      return apiError(c, 409, 'CONFLICT', 'Upload session has expired')
    }

    // Stream the request body straight to R2; never buffer it in the Worker.
    let object: { size: number; etag: string }
    try {
      object = await c.env.BUCKET.put(session.object_key, c.req.raw.body, {
        httpMetadata: {
          contentType: session.mime_type ?? DEFAULT_CONTENT_TYPE,
        },
      })
    } catch {
      // Client aborted (cancel/pause) or upstream failure: remove any partial
      // object so it cannot become an orphan, and let the client retry.
      await c.env.BUCKET.delete(session.object_key).catch(() => undefined)
      return apiError(c, 400, 'UPLOAD_INTERRUPTED', 'Upload was interrupted')
    }

    if (object.size !== session.total_size) {
      await c.env.BUCKET.delete(session.object_key)
      return apiError(c, 400, 'SIZE_MISMATCH', 'Uploaded size does not match the declared size')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      insertFileStatement(c.env, session, object.size, object.etag, now),
      c.env.DB.prepare(
        'UPDATE upload_sessions SET status = ?, completed_at = ? WHERE id = ?',
      ).bind('completed', now, session.id),
    ])
    await auditCompletedUpload(c.env, c.var.session.githubUserId, session, object.size)

    return c.json({
      id: session.file_id,
      name: session.original_name,
      size: object.size,
      etag: object.etag,
    })
  })
  .put('/:id/parts/:partNumber', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session) {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }
    if (session.mode !== 'multipart') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not a multipart upload')
    }
    if (session.status !== 'created' && session.status !== 'uploading') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not accepting parts')
    }
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      return apiError(c, 409, 'CONFLICT', 'Upload session has expired')
    }
    if (!session.r2_upload_id) {
      return apiError(c, 409, 'CONFLICT', 'Multipart upload is not initialized')
    }

    const partNumber = Number(c.req.param('partNumber'))
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.total_parts) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid part number')
    }

    // Stream the part body straight to R2 (workerd requires a known-length
    // body here, i.e. the request body with Content-Length). The part size is
    // taken from Content-Length; the assembled size is verified at completion.
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
    let part: { partNumber: number; etag: string }
    try {
      part = await multipart.uploadPart(partNumber, rawBody)
    } catch {
      return apiError(c, 502, 'UPSTREAM_ERROR', 'Part upload failed')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR REPLACE INTO upload_parts
         (upload_session_id, part_number, etag, size, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(session.id, partNumber, part.etag, contentLength, now),
      // Flip created -> uploading once, idempotently.
      c.env.DB.prepare('UPDATE upload_sessions SET status = ? WHERE id = ? AND status = ?').bind(
        'uploading',
        session.id,
        'created',
      ),
    ])

    return c.json({ partNumber, etag: part.etag })
  })
  .post('/:id/complete', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session) {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }

    if (session.mode === 'single') {
      if (session.status !== 'completed') {
        return apiError(c, 409, 'CONFLICT', 'Upload session is not completed')
      }
      const file = await findFileRecord(c.env, session.file_id)
      if (!file) {
        return apiError(c, 409, 'CONFLICT', 'File record is missing')
      }
      return c.json(toFileJson(file))
    }

    // Multipart completion with crash recovery (plan §23).
    if (session.status === 'completed') {
      const existing = await findFileRecord(c.env, session.file_id)
      if (existing) {
        return c.json(toFileJson(existing))
      }
      // R2 completion already happened but D1 failed: repair D1 only.
      const object = await c.env.BUCKET.head(session.object_key)
      if (object) {
        const now = Math.floor(Date.now() / 1000)
        await insertFileStatement(c.env, session, object.size, object.etag, now).run()
        await auditCompletedUpload(c.env, c.var.session.githubUserId, session, object.size)
        return c.json({
          id: session.file_id,
          name: session.original_name,
          size: object.size,
          etag: object.etag,
        })
      }
      return apiError(c, 409, 'CONFLICT', 'Completed upload has no file record')
    }

    if (session.status !== 'uploading') {
      return apiError(c, 409, 'CONFLICT', 'Upload session is not ready to complete')
    }
    if (!session.r2_upload_id) {
      return apiError(c, 409, 'CONFLICT', 'Multipart upload is not initialized')
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
    let object: { size: number; etag: string }
    try {
      object = await multipart.complete(
        parts.map((part) => ({ partNumber: part.part_number, etag: part.etag })),
      )
    } catch {
      return apiError(c, 502, 'UPSTREAM_ERROR', 'Failed to complete the multipart upload')
    }

    // Strong size check: the assembled object must match the declared size.
    if (object.size !== session.total_size) {
      await c.env.BUCKET.delete(session.object_key)
      return apiError(c, 400, 'SIZE_MISMATCH', 'Assembled file size does not match the declared size')
    }

    const now = Math.floor(Date.now() / 1000)
    await c.env.DB.batch([
      insertFileStatement(c.env, session, object.size, object.etag, now),
      c.env.DB.prepare(
        'UPDATE upload_sessions SET status = ?, completed_at = ? WHERE id = ?',
      ).bind('completed', now, session.id),
    ])
    await auditCompletedUpload(c.env, c.var.session.githubUserId, session, object.size)

    return c.json({
      id: session.file_id,
      name: session.original_name,
      size: object.size,
      etag: object.etag,
    })
  })
  .delete('/:id', requireAuth, requireSameOrigin, async (c) => {
    const session = await findSession(c.env, c.req.param('id'))
    if (!session) {
      return apiError(c, 404, 'NOT_FOUND', 'Upload session not found')
    }

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
        // The multipart may already be gone; the session state is still marked.
      }
    }

    await c.env.DB.prepare('UPDATE upload_sessions SET status = ? WHERE id = ?')
      .bind('aborted', session.id)
      .run()
    return c.body(null, 204)
  })
