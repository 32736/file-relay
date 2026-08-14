import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../env'
import { randomToken, sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { chunkSize, maxFileSize, objectKeyFor } from '../lib/r2'
import { verifyTurnstile } from '../lib/turnstile'
import { requireAuth, requireSameOrigin } from '../middleware/auth'
import { insertSessionStatement } from './uploads'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

const createIncomingSchema = z.object({
  title: z.string().max(200).nullish(),
  expiresIn: z.number().int().positive(),
  maxFiles: z.number().int().min(1).max(100),
  maxFileSize: z.number().int().positive().nullish(),
})

const publicCreateUploadSchema = z.object({
  turnstileToken: z.string().min(1),
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  type: z.string().max(255).nullish(),
})

interface IncomingRow {
  id: string
  token_hash: string
  title: string | null
  expires_at: number
  max_file_size: number
  max_files: number
  uploaded_count: number
  created_at: number
  revoked_at: number | null
}

async function findIncomingByTokenHash(
  env: AppEnv['Bindings'],
  tokenHash: string,
): Promise<IncomingRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, token_hash, title, expires_at, max_file_size, max_files,
              uploaded_count, created_at, revoked_at
       FROM incoming_requests WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .first<IncomingRow>()) ?? null
  )
}

/** Returns the incoming request only when it is currently usable. */
async function resolveUsableIncoming(
  env: AppEnv['Bindings'],
  token: string,
): Promise<IncomingRow | null> {
  const tokenHash = await sha256Hex(token)
  const row = await findIncomingByTokenHash(env, tokenHash)
  if (!row) return null
  const now = Math.floor(Date.now() / 1000)
  if (row.revoked_at !== null || row.expires_at <= now) return null
  return row
}

export const incomingRoutes = new Hono<AppEnv>()
  .post('/', requireAuth, requireSameOrigin, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createIncomingSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid incoming request')
    }
    const { title, expiresIn, maxFiles, maxFileSize: declaredMaxFileSize } = parsed.data

    const globalMax = maxFileSize(c.env.MAX_FILE_SIZE)
    const effectiveMaxFileSize = Math.min(declaredMaxFileSize ?? globalMax, globalMax)

    const token = randomToken(32)
    const tokenHash = await sha256Hex(token)
    const id = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + expiresIn

    await c.env.DB.prepare(
      `INSERT INTO incoming_requests
       (id, token_hash, title, expires_at, max_file_size, max_files,
        uploaded_count, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, tokenHash, title ?? null, expiresAt, effectiveMaxFileSize, maxFiles, 0, now, null)
      .run()

    return c.json({
      id,
      url: `${c.env.APP_ORIGIN}/u/${token}`,
      expiresAt,
      maxFiles,
      maxFileSize: effectiveMaxFileSize,
      uploadedCount: 0,
    })
  })
  .get('/', requireAuth, async (c) => {
    const rawLimit = Number(c.req.query('limit'))
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT
    const rawCursor = Number(c.req.query('cursor'))
    const offset = Number.isFinite(rawCursor) ? Math.max(Math.trunc(rawCursor), 0) : 0

    const result = await c.env.DB.prepare(
      `SELECT id, token_hash, title, expires_at, max_file_size, max_files,
              uploaded_count, created_at, revoked_at
       FROM incoming_requests
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit + 1, offset)
      .all<IncomingRow>()
    const hasMore = result.results.length > limit
    const rows = result.results.slice(0, limit)

    return c.json({
      requests: rows.map((row) => ({
        id: row.id,
        title: row.title,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        maxFiles: row.max_files,
        maxFileSize: row.max_file_size,
        uploadedCount: row.uploaded_count,
        revokedAt: row.revoked_at,
      })),
      nextCursor: hasMore ? String(offset + limit) : null,
    })
  })
  .delete('/:id', requireAuth, requireSameOrigin, async (c) => {
    const now = Math.floor(Date.now() / 1000)
    const result = await c.env.DB.prepare(
      'UPDATE incoming_requests SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
      .bind(now, c.req.param('id'))
      .run()
    if (result.meta.changes === 0) {
      const exists = await c.env.DB.prepare('SELECT id FROM incoming_requests WHERE id = ?')
        .bind(c.req.param('id'))
        .first()
      if (!exists) return apiError(c, 404, 'NOT_FOUND', 'Incoming request not found')
    }
    return c.body(null, 204)
  })

export const publicIncomingRoutes = new Hono<AppEnv>()
  .get('/:token', async (c) => {
    const row = await resolveUsableIncoming(c.env, c.req.param('token'))
    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'Incoming request not found')
    }
    return c.json({
      title: row.title,
      expiresAt: row.expires_at,
      maxFiles: row.max_files,
      maxFileSize: row.max_file_size,
      uploadedCount: row.uploaded_count,
      siteKey: c.env.TURNSTILE_SITE_KEY,
    })
  })
  .post('/:token/uploads', async (c) => {
    const row = await resolveUsableIncoming(c.env, c.req.param('token'))
    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'Incoming request not found')
    }

    const body = await c.req.json().catch(() => null)
    const parsed = publicCreateUploadSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid upload request')
    }
    const { turnstileToken, name, size, type } = parsed.data

    // Turnstile gates session creation (plan §36); failure is 403 with no
    // session and no quota consumption.
    let verified: boolean
    try {
      verified = await verifyTurnstile(
        c.env.TURNSTILE_SECRET_KEY,
        turnstileToken,
        c.req.header('cf-connecting-ip') ?? null,
      )
    } catch {
      return apiError(c, 502, 'UPSTREAM_ERROR', 'Turnstile verification failed')
    }
    if (!verified) {
      return apiError(c, 403, 'FORBIDDEN', 'Turnstile verification failed')
    }

    const globalMax = maxFileSize(c.env.MAX_FILE_SIZE)
    if (size > Math.min(row.max_file_size, globalMax)) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'File exceeds the allowed size')
    }

    // Atomic quota claim (plan §37).
    const now = Math.floor(Date.now() / 1000)
    const claimed = await c.env.DB.prepare(
      `UPDATE incoming_requests
       SET uploaded_count = uploaded_count + 1
       WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
         AND uploaded_count < max_files
       RETURNING *`,
    )
      .bind(row.id, now)
      .first()
    if (!claimed) {
      return apiError(c, 403, 'FORBIDDEN', 'Incoming request is no longer accepting uploads')
    }

    const chunk = chunkSize(c.env.UPLOAD_CHUNK_SIZE)
    const fileId = crypto.randomUUID()
    const sessionId = crypto.randomUUID()
    const objectKey = objectKeyFor(fileId, new Date())
    const uploadToken = randomToken(32)
    const uploadTokenHash = await sha256Hex(uploadToken)

    let r2UploadId: string | null = null
    if (size > chunk) {
      const multipart = await c.env.BUCKET.createMultipartUpload(objectKey, {
        httpMetadata: { contentType: type ?? 'application/octet-stream' },
      })
      r2UploadId = multipart.uploadId
    }

    await insertSessionStatement(c.env, {
      sessionId,
      fileId,
      objectKey,
      name,
      type,
      size,
      chunk,
      totalParts: size > chunk ? Math.ceil(size / chunk) : 1,
      mode: size > chunk ? 'multipart' : 'single',
      r2UploadId,
      now,
      authKind: 'incoming',
      accessTokenHash: uploadTokenHash,
    }).run()

    return c.json({
      uploadId: sessionId,
      mode: size > chunk ? 'multipart' : 'single',
      chunkSize: chunk,
      totalParts: size > chunk ? Math.ceil(size / chunk) : 1,
      uploadToken,
    })
  })

export { resolveUsableIncoming }
