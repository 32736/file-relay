import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../env'
import { apiError } from '../lib/errors'
import { requireAuth, requireSameOrigin } from '../middleware/auth'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

// Password protection is enabled in Phase 07: `password` (optional) is stored
// as HMAC-SHA-256(TOKEN_HMAC_SECRET, shareId + "\0" + password).
const createShareSchema = z.object({
  expiresIn: z.number().int().positive().nullish(),
  maxDownloads: z.number().int().positive().nullish(),
  deleteFileAfterExhausted: z.boolean().nullish(),
  password: z.string().min(1).max(128).nullish(),
})

export interface ShareRow {
  id: string
  file_id: string
  password_mac: string | null
  expires_at: number | null
  max_downloads: number | null
  download_count: number
  delete_file_after_exhausted: number
  created_at: number
  revoked_at: number | null
}

async function findShareByHash(
  env: AppEnv['Bindings'],
  tokenHash: string,
): Promise<ShareRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, file_id, password_mac, expires_at, max_downloads, download_count,
              delete_file_after_exhausted, created_at, revoked_at
       FROM shares WHERE token_hash = ?`,
    )
      .bind(tokenHash)
      .first<ShareRow>()) ?? null
  )
}

export const shareRoutes = new Hono<AppEnv>()
  .get('/', requireAuth, async (c) => {
    const rawLimit = Number(c.req.query('limit'))
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
      : DEFAULT_LIMIT
    const rawCursor = Number(c.req.query('cursor'))
    const offset = Number.isFinite(rawCursor) ? Math.max(Math.trunc(rawCursor), 0) : 0

    const result = await c.env.DB.prepare(
      `SELECT id, file_id, expires_at, max_downloads, download_count,
              delete_file_after_exhausted, created_at, revoked_at
       FROM shares
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit + 1, offset)
      .all<ShareRow>()

    const hasMore = result.results.length > limit
    const shares = result.results.slice(0, limit)

    // Resolve file names for the listed shares in one IN query.
    const fileIds = [...new Set(shares.map((share) => share.file_id))]
    const names = new Map<string, string>()
    if (fileIds.length > 0) {
      const files = await c.env.DB.prepare(
        `SELECT id, original_name FROM files
         WHERE id IN (${fileIds.map(() => '?').join(', ')})`,
      )
        .bind(...fileIds)
        .all<{ id: string; original_name: string }>()
      for (const file of files.results) names.set(file.id, file.original_name)
    }

    return c.json({
      shares: shares.map((share) => ({
        id: share.id,
        fileId: share.file_id,
        fileName: names.get(share.file_id) ?? null,
        createdAt: share.created_at,
        expiresAt: share.expires_at,
        maxDownloads: share.max_downloads,
        downloadCount: share.download_count,
        deleteFileAfterExhausted: share.delete_file_after_exhausted === 1,
        revokedAt: share.revoked_at,
      })),
      nextCursor: hasMore ? String(offset + limit) : null,
    })
  })
  .delete('/:id', requireAuth, requireSameOrigin, async (c) => {
    const now = Math.floor(Date.now() / 1000)
    const result = await c.env.DB.prepare(
      'UPDATE shares SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    )
      .bind(now, c.req.param('id'))
      .run()

    if (result.meta.changes === 0) {
      const exists = await c.env.DB.prepare('SELECT id FROM shares WHERE id = ?')
        .bind(c.req.param('id'))
        .first()
      if (!exists) {
        return apiError(c, 404, 'NOT_FOUND', 'Share not found')
      }
    }
    return c.body(null, 204)
  })

export { findShareByHash, createShareSchema }