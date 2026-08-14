import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { buildDownloadResponse, parseRange } from '../lib/download'
import { sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { findShareByHash } from './shares'

interface PublicFileRow {
  id: string
  object_key: string
  original_name: string
  mime_type: string | null
  size: number
}

async function resolvePublicShare(
  env: AppEnv['Bindings'],
  token: string,
): Promise<{ share: NonNullable<Awaited<ReturnType<typeof findShareByHash>>>; file: PublicFileRow } | null> {
  const tokenHash = await sha256Hex(token)
  const share = await findShareByHash(env, tokenHash)
  if (!share) return null

  const file = (await env.DB.prepare(
    `SELECT id, object_key, original_name, mime_type, size
     FROM files WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(share.file_id)
    .first<PublicFileRow>()) ?? null
  if (!file) return null

  const now = Math.floor(Date.now() / 1000)
  if (share.revoked_at !== null) return null
  if (share.expires_at !== null && share.expires_at <= now) return null

  return { share, file }
}

export const publicShareRoutes = new Hono<AppEnv>()
  .get('/:token', async (c) => {
    const resolved = await resolvePublicShare(c.env, c.req.param('token'))
    if (!resolved) {
      return apiError(c, 404, 'NOT_FOUND', 'Share not found')
    }
    const { share, file } = resolved

    return c.json({
      name: file.original_name,
      size: file.size,
      mimeType: file.mime_type,
      expiresAt: share.expires_at,
      remainingDownloads:
        share.max_downloads === null
          ? null
          : Math.max(0, share.max_downloads - share.download_count),
    })
  })
  .get('/:token/download', async (c) => {
    const resolved = await resolvePublicShare(c.env, c.req.param('token'))
    if (!resolved) {
      return apiError(c, 404, 'NOT_FOUND', 'Share not found')
    }
    const { share, file } = resolved

    // Atomic claim (plan §30): one increment per download request. Zero rows
    // means expired, revoked, or exhausted.
    const now = Math.floor(Date.now() / 1000)
    const claimed = await c.env.DB.prepare(
      `UPDATE shares
       SET download_count = download_count + 1, last_download_at = ?
       WHERE id = ?
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)
         AND (max_downloads IS NULL OR download_count < max_downloads)
       RETURNING *`,
    )
      .bind(now, share.id, now)
      .first()

    if (!claimed) {
      return apiError(c, 403, 'FORBIDDEN', 'Share is no longer available')
    }

    const range = parseRange(c.req.header('range'), file.size)
    if (range.kind === 'invalid') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${file.size}` },
      })
    }

    // Stream from R2 via the shared Phase 04 pipeline.
    let object: Awaited<ReturnType<AppEnv['Bindings']['BUCKET']['get']>>
    if (range.kind === 'bytes') {
      object = await c.env.BUCKET.get(file.object_key, {
        range: { offset: range.start, length: range.end - range.start + 1 },
      })
    } else if (range.kind === 'suffix') {
      object = await c.env.BUCKET.get(file.object_key, { range: { suffix: range.length } })
    } else {
      object = await c.env.BUCKET.get(file.object_key)
    }

    if (!object) {
      return apiError(c, 404, 'NOT_FOUND', 'File content is missing')
    }

    return buildDownloadResponse(object, file.original_name, file.mime_type, range)
  })
