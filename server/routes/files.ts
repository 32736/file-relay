import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../env'
import { buildDownloadResponse, contentDisposition, parseRange } from '../lib/download'
import { encryptWithSecret, randomToken, sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { fileExpirationSchema } from '../lib/validate'
import { createZipStream } from '../lib/zip'
import { requireAuth, requireSameOrigin } from '../middleware/auth'
import { recordAudit } from '../services/audit'
import { createShareSchema } from './shares'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_ZIP32_SIZE = 0xffffffff

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
  expires_at: number | null
}

interface DownloadFileRow {
  id: string
  object_key: string
  original_name: string
  mime_type: string | null
  size: number
}

interface BatchDownloadFileRow extends DownloadFileRow {
  expires_at: number | null
}

function zipEntryName(name: string, fileId: string, used: Set<string>): string {
  const clean = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '_')
    .replace(/[\\/]/g, '_')
    .trim() || `${fileId}.bin`
  let candidate = clean
  let suffix = 2
  while (used.has(candidate)) {
    const dot = clean.lastIndexOf('.')
    const base = dot > 0 ? clean.slice(0, dot) : clean
    const extension = dot > 0 ? clean.slice(dot) : ''
    candidate = `${base} (${suffix++})${extension}`
  }
  used.add(candidate)
  return candidate
}

function toPublicFile(row: FileRow) {
  return {
    id: row.id,
    name: row.original_name,
    size: row.size,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
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
    const whereParts = ['deleted_at IS NULL', '(expires_at IS NULL OR expires_at > ?)']
    const filterParams: unknown[] = [Math.floor(Date.now() / 1000)]
    if (q) {
      whereParts.push(`original_name LIKE ? ESCAPE '\\'`)
      filterParams.push(`%${escapeLike(q)}%`)
    }

    const result = await c.env.DB.prepare(
      `SELECT id, original_name, mime_type, size, created_at, expires_at
       FROM files
       WHERE ${whereParts.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...filterParams, limit + 1, offset)
      .all<FileRow>()
    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM files
       WHERE ${whereParts.join(' AND ')}`,
    )
      .bind(...filterParams)
      .first<{ total: number }>()

    const hasMore = result.results.length > limit
    const files = result.results.slice(0, limit).map(toPublicFile)

    return c.json({
      files,
      total: totalRow?.total ?? 0,
      nextCursor: hasMore ? String(offset + limit) : null,
    })
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

    if (result.meta.changes > 0) {
      await recordAudit(c.env, {
        actorGithubId: c.var.session.githubUserId,
        action: 'file.deleted',
        targetType: 'file',
        metadata: { count: result.meta.changes },
      })
    }
    return c.json({ deleted: result.meta.changes })
  })
  // Undo for a logical delete (the UI offers a short undo window after
  // batch-delete); only rows that are logically deleted are restored.
  .post('/batch-restore', requireAuth, requireSameOrigin, async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(100),
      })
      .safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid restore request')
    }
    const ids = parsed.data.ids
    const result = await c.env.DB.prepare(
      `UPDATE files SET deleted_at = NULL
       WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NOT NULL`,
    )
      .bind(...ids)
      .run()
    if (result.meta.changes > 0) {
      await recordAudit(c.env, {
        actorGithubId: c.var.session.githubUserId,
        action: 'file.restored',
        targetType: 'file',
        metadata: { count: result.meta.changes },
      })
    }
    return c.json({ restored: result.meta.changes })
  })
  .post('/batch-download', requireAuth, requireSameOrigin, async (c) => {
    const parsed = z
      .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
      .safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid batch-download request')
    }

    const ids = [...new Set(parsed.data.ids)]
    const rows = await c.env.DB.prepare(
      `SELECT id, object_key, original_name, mime_type, size, expires_at
       FROM files
       WHERE id IN (${ids.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
    )
      .bind(...ids)
      .all<BatchDownloadFileRow>()
    const now = Math.floor(Date.now() / 1000)
    const activeRows = rows.results.filter((row) => row.expires_at === null || row.expires_at > now)
    if (activeRows.length === 0) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }
    const totalBytes = activeRows.reduce((total, row) => total + row.size, 0)
    if (totalBytes > MAX_ZIP32_SIZE) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', '批量下载总大小超过 ZIP 格式限制')
    }

    const usedNames = new Set<string>()
    const entries = activeRows.map((row) => ({
      name: zipEntryName(row.original_name, row.id, usedNames),
      expectedSize: row.size,
      open: async () => {
        const object = await c.env.BUCKET.get(row.object_key)
        return object?.body ?? null
      },
    }))
    await recordAudit(c.env, {
      actorGithubId: c.var.session.githubUserId,
      action: 'file.batch_downloaded',
      targetType: 'batch',
      metadata: { count: activeRows.length, size: totalBytes },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition(`drop-files-${stamp}.zip`),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return new Response(createZipStream(entries), { status: 200, headers })
  })
  .patch('/:id/expiration', requireAuth, requireSameOrigin, async (c) => {
    const parsed = z.object({ expiresIn: fileExpirationSchema }).safeParse(
      await c.req.json().catch(() => null),
    )
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid expiration request')
    }
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = parsed.data.expiresIn === null ? null : now + parsed.data.expiresIn
    const result = await c.env.DB.prepare(
      'UPDATE files SET expires_at = ? WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(expiresAt, c.req.param('id'))
      .run()
    if (result.meta.changes === 0) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }
    await recordAudit(c.env, {
      actorGithubId: c.var.session.githubUserId,
      action: 'file.expiration_updated',
      targetType: 'file',
      targetId: c.req.param('id'),
      metadata: { expiresAt },
    })
    return c.json({ id: c.req.param('id'), expiresAt })
  })
  .get('/:id', requireAuth, async (c) => {
    const now = Math.floor(Date.now() / 1000)
    const row = await c.env.DB.prepare(
      `SELECT id, original_name, mime_type, size, created_at, expires_at
       FROM files
       WHERE id = ? AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
      .bind(c.req.param('id'), now)
      .first<FileRow>()

    if (!row) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }
    return c.json(toPublicFile(row))
  })
  .get('/:id/download', requireAuth, async (c) => {
    const now = Math.floor(Date.now() / 1000)
    const row = await c.env.DB.prepare(
      `SELECT id, object_key, original_name, mime_type, size, expires_at
       FROM files
       WHERE id = ? AND deleted_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
      .bind(c.req.param('id'), now)
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

    await recordAudit(c.env, {
      actorGithubId: c.var.session.githubUserId,
      action: 'file.downloaded',
      targetType: 'file',
      targetId: row.id,
      metadata: { size: row.size, ranged: range.kind !== 'full' },
    })
    return buildDownloadResponse(object, row.original_name, row.mime_type, range)
  })
  .post('/:id/shares', requireAuth, requireSameOrigin, async (c) => {
    const fileId = c.req.param('id')
    const file = await c.env.DB.prepare(
      'SELECT id FROM files WHERE id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
    )
      .bind(fileId, Math.floor(Date.now() / 1000))
      .first()
    if (!file) {
      return apiError(c, 404, 'NOT_FOUND', 'File not found')
    }

    const body = await c.req.json().catch(() => null)
    const parsed = createShareSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(c, 400, 'VALIDATION_ERROR', 'Invalid share request')
    }
    const { expiresIn, maxDownloads, deleteFileAfterExhausted } = parsed.data

    const token = randomToken(32)
    const tokenHash = await sha256Hex(token)
    // Encrypted with the Worker secret so the owner can recover the link on
    // any logged-in device; never stored in plaintext.
    const encryptedToken = await encryptWithSecret(
      token,
      c.env.EMAIL_ENCRYPTION_KEY,
      'drop:share-token:v1',
    )
    const shareId = crypto.randomUUID()
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = expiresIn ? now + expiresIn : null

    await c.env.DB.prepare(
      `INSERT INTO shares
       (id, file_id, token_hash, encrypted_token, expires_at, max_downloads, download_count,
        delete_file_after_exhausted, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        shareId,
        fileId,
        tokenHash,
        encryptedToken,
        expiresAt,
        maxDownloads ?? null,
        0,
        deleteFileAfterExhausted ? 1 : 0,
        now,
        null,
      )
      .run()

    await recordAudit(c.env, {
      actorGithubId: c.var.session.githubUserId,
      action: 'share.created',
      targetType: 'share',
      targetId: shareId,
      metadata: { fileId },
    })

    // The raw token appears exactly once, inside the share URL; the stored
    // copy is AES-GCM ciphertext that only the Worker secret can open.
    return c.json({
      id: shareId,
      url: `${c.env.APP_ORIGIN}/s/${token}`,
      expiresAt,
      maxDownloads: maxDownloads ?? null,
      deleteFileAfterExhausted: deleteFileAfterExhausted ?? false,
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

    if (result.meta.changes > 0) {
      await recordAudit(c.env, {
        actorGithubId: c.var.session.githubUserId,
        action: 'file.deleted',
        targetType: 'file',
        targetId: c.req.param('id'),
      })
    }
    return c.body(null, 204)
  })
