import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { apiError } from '../lib/errors'
import { requireAuth, requireSameOrigin } from '../middleware/auth'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

interface FileRow {
  id: string
  original_name: string
  mime_type: string | null
  size: number
  created_at: number
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

    const result = await c.env.DB.prepare(
      `SELECT id, original_name, mime_type, size, created_at
       FROM files
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit + 1, offset)
      .all<FileRow>()

    const hasMore = result.results.length > limit
    const files = result.results.slice(0, limit).map(toPublicFile)

    return c.json({ files, nextCursor: hasMore ? String(offset + limit) : null })
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
