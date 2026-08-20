import { Hono } from 'hono'
import { z } from 'zod'

import type { AppEnv } from '../env'
import { decryptWithSecret } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { requireAuth, requireSameOrigin } from '../middleware/auth'
import { recordAudit } from '../services/audit'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const SHARE_TOKEN_AAD = 'drop:share-token:v1'
// Matches files by name first, then filters shares via `file_id IN (...)`.
// The id list is capped so bound parameters (ids + limit + offset) stay
// within D1's 100-parameter-per-query limit.
const MAX_SEARCH_FILE_IDS = 98

/** Escapes `%`, `_` and `\` so user input is literal in a `LIKE ... ESCAPE '\'` pattern. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const createShareSchema = z.object({
  expiresIn: z.number().int().positive().nullish(),
  maxDownloads: z.number().int().positive().nullish(),
  deleteFileAfterExhausted: z.boolean().nullish(),
})

export interface ShareRow {
  id: string
  file_id: string
  expires_at: number | null
  max_downloads: number | null
  download_count: number
  delete_file_after_exhausted: number
  created_at: number
  revoked_at: number | null
  encrypted_token: string | null
}

/**
 * Recovers the owner-facing share URL from the encrypted token. Returns null
 * for legacy rows created before encrypted storage (the client falls back to
 * its local cache) or when the ciphertext cannot be decrypted.
 */
async function shareUrl(
  env: AppEnv['Bindings'],
  encryptedToken: string | null,
): Promise<string | null> {
  if (!encryptedToken) return null
  try {
    const token = await decryptWithSecret(encryptedToken, env.EMAIL_ENCRYPTION_KEY, SHARE_TOKEN_AAD)
    return `${env.APP_ORIGIN}/s/${token}`
  } catch {
    return null
  }
}

async function findShareByHash(
  env: AppEnv['Bindings'],
  tokenHash: string,
): Promise<ShareRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, file_id, expires_at, max_downloads, download_count,
              delete_file_after_exhausted, created_at, revoked_at, encrypted_token
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

    // Search by file name with the same semantics as /api/files; matching
    // ids are resolved first so share pagination stays in SQL.
    const q = (c.req.query('q') ?? '').trim()
    let searchFileIds: string[] | null = null
    if (q) {
      const matches = await c.env.DB.prepare(
        `SELECT id FROM files WHERE original_name LIKE ? ESCAPE '\\'`,
      )
        .bind(`%${escapeLike(q)}%`)
        .all<{ id: string }>()
      if (matches.results.length === 0) {
        return c.json({ shares: [], nextCursor: null })
      }
      searchFileIds = matches.results
        .slice(0, MAX_SEARCH_FILE_IDS)
        .map((row) => row.id)
    }

    const result = await c.env.DB.prepare(
      `SELECT id, file_id, expires_at, max_downloads, download_count,
              delete_file_after_exhausted, created_at, revoked_at, encrypted_token
       FROM shares
       ${searchFileIds ? `WHERE file_id IN (${searchFileIds.map(() => '?').join(', ')})` : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...(searchFileIds ?? []), limit + 1, offset)
      .all<ShareRow>()

    const hasMore = result.results.length > limit
    const shares = result.results.slice(0, limit)
    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM shares
       ${searchFileIds ? `WHERE file_id IN (${searchFileIds.map(() => '?').join(', ')})` : ''}`,
    )
      .bind(...(searchFileIds ?? []))
      .first<{ total: number }>()

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
      shares: await Promise.all(
        shares.map(async (share) => ({
          id: share.id,
          fileId: share.file_id,
          fileName: names.get(share.file_id) ?? null,
          createdAt: share.created_at,
          expiresAt: share.expires_at,
          maxDownloads: share.max_downloads,
          downloadCount: share.download_count,
          deleteFileAfterExhausted: share.delete_file_after_exhausted === 1,
          revokedAt: share.revoked_at,
          // Owner-only endpoint (requireAuth): the recovered link lets the
          // owner copy it on any device where they are logged in.
          url: await shareUrl(c.env, share.encrypted_token),
        })),
      ),
      total: totalRow?.total ?? 0,
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
    if (result.meta.changes > 0) {
      await recordAudit(c.env, {
        actorGithubId: c.var.session.githubUserId,
        action: 'share.revoked',
        targetType: 'share',
        targetId: c.req.param('id'),
      })
    }
    return c.body(null, 204)
  })

export { findShareByHash, createShareSchema }
