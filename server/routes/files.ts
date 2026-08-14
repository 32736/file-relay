import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../env'
import { buildDownloadResponse, dispositionFor, parseRange } from '../lib/download'
import { randomToken, hmacSha256Hex, sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { requireAuth, requireSameOrigin } from '../middleware/auth'
import { createShareSchema } from './shares'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/** Escapes `%`, `_` and `\` so user input is literal in a `LIKE ... ESCAPE '\'` pattern. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`)
}

interface FileRow {
  id: string
  original_name: string
  mime_type: string | null
  size: number
  created_at: number
}

interface DownloadFileRow {
  id: string
  object_key: string
  original_name: string
  mime_type: string | null
  size: number
}

function toPublicFile(row: FileRow) {
  return {
    id: row.id,
    name: row.original_name,
    size: row.size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
  }
}

export const fileRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => {
    const rawLimit = Number(c.req.query('limit'))
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT
    const rawCursor = Number(c.req.query('cursor'))
    const offset = Number.isFinite(rawCursor) ? Math.max(Math.trunc(rawCursor), 0) : 0

    const q = (c.req.query('q') ?? '').trim()
    const whereParts = ['deleted_at IS NULL']
    const params: unknown[] = [limit + 1, offset]
    if (q) {
      whereParts.push(`original_name LIKE ? ESCAPE '\\'`)
      params.unshift(`%${escapeLike(q)}%`)
    }

    const result = await c.env.DB.prepare(
      `SELECT id, original_name, mime_type, size, created_at
       FROM files
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params)
      .all<FileRow>()

    const hasMore = result.results.length > limit
    const files = result.results.slice(0, limit).map(toPublicFile)

    return c.json({ files, nextCursor: hasMore ? String(offset + limit) : null })
  })
  .post('/batch-delete', requireAuth, requireSameOrigin, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(100),
      })
      .safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid batch-delete request')
    }
    const ids = parsed.data.ids

    const now = Math.floor(Date.now() / 1000)
    const result = await c.env.DB.prepare(
      `UPDATE files SET deleted_at = ?
       WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
    )
      .bind(now, ...ids)
      .run()

    return c.json({ deleted: result.meta.changes })
  })
  .get('/:id', requireAuth, async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT id, original_name, mime_type, size, created_at
       FROM files
       WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(c.req.param('id'))
      .first<FileRow>()

    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }
    return c.json(toPublicFile(row))
  })
  .get('/:id/download', requireAuth, async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT id, object_key, original_name, mime_type, size
       FROM files
       WHERE id = ? AND deleted_at IS NULL`,
    )
      .bind(c.req.param('id'))
      .first<DownloadFileRow>()

    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }

    const range = parseRange(c.req.header('range'), row.size)
    if (range.kind === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${row.size}` },
      })
    }

    // Stream from R2; never buffer the object in the Worker.
    let object: Awaited<ReturnType<AppEnv['Bindings']['BUCKET']['get']>>
    if (range.kind === 'bytes') {
      object = await c.env.BUCKET.get(row.object_key, {
        range: { offset: range.start, length: range.end - range.start + 1 },
      })
    } else if (range.kind === 'suffix') {
      object = await c.env.BUCKET.get(row.object_key, { range: { suffix: range.length } })
    } else {
      object = await c.env.BUCKET.get(row.object_key)
    }

    if (!object) {
      return apiError(c, 404, 'NOT_FOUND', 'File content is missing')
    }

    return buildDownloadResponse(
      object,
      row.original_name,
      row.mime_type,
      range,
      dispositionFor(row.mime_type),
    )
  })
  .post('/:id/shares', requireAuth, requireSameOrigin, async (c) => {
    const fileId = c.req.param('id')
    const file = await c.env.DB.prepare('SELECT id FROM files WHERE id = ? AND deleted_at IS NULL')
      .bind(fileId)
      .first()
    if (!file) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }

    const body = await c.req.json().catch(() => null)
    const parsed = createShareSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid share request')
    }
    const { expiresIn, maxDownloads, deleteFileAfterExhausted, password } = parsed.data

    const token = randomToken(32)
    const tokenHash = await sha256Hex(token)
    const shareId = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = expiresIn ? now + expiresIn : null
    const passwordMac = password
      ? await hmacSha256Hex(c.env.TOKEN_HMAC_SECRET, `${shareId}\0${password}`)
      : null

    await c.env.DB.prepare(
      `INSERT INTO shares
       (id, file_id, token_hash, password_mac, expires_at, max_downloads,
        download_count, delete_file_after_exhausted, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        shareId,
        fileId,
        tokenHash,
        passwordMac,
        expiresAt,
        maxDownloads ?? null,
        0,
        deleteFileAfterExhausted ? 1 : 0,
        now,
        null,
      )
      .run()

    // The raw token appears exactly once, inside the share URL.
    return c.json({
      id: shareId,
      url: `${c.env.APP_ORIGIN}/s/${token}`,
      expiresAt,
      maxDownloads: maxDownloads ?? null,
      deleteFileAfterExhausted: deleteFileAfterExhausted ?? false,
      passwordProtected: passwordMac !== null,
    })
  })
  .delete('/:id', requireAuth, requireSameOrigin, async (c) => {
    const now = Math.floor(Date.now() / 1000)
    const result = await c.env.DB.prepare(
      'UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(now, c.req.param('id'))
      .run()

    if (result.meta.changes === 0) {
      const exists = await c.env.DB.prepare('SELECT id FROM files WHERE id = ?')
        .bind(c.req.param('id'))
        .first()
      if (!exists) {
        return apiError(c, 404, 'NOT_FOUND', 'File not found')
      }
    }

    return c.body(null, 204)
  })
