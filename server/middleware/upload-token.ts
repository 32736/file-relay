import { createMiddleware } from 'hono/factory'

import type { AppEnv, UploadSessionContext } from '../env'
import { sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'

async function findIncomingSessionByTokenHash(
  env: AppEnv['Bindings'],
  tokenHash: string,
): Promise<UploadSessionContext | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, file_id, object_key, original_name, mime_type, total_size,
              chunk_size, total_parts, mode, r2_upload_id, auth_kind, status, expires_at
       FROM upload_sessions
       WHERE access_token_hash = ? AND auth_kind = 'incoming'`,
    )
      .bind(tokenHash)
      .first<UploadSessionContext>()) ?? null
  )
}

/**
 * Authenticates public upload endpoints with a bearer upload-access token
 * (Phase 08). Resolves the session by its stored hash; owner sessions are
 * never reachable through this path.
 */
export const requireUploadToken = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!token) {
    return apiError(c, 401, 'UNAUTHORIZED', 'Upload token required')
  }

  const tokenHash = await sha256Hex(token)
  const session = await findIncomingSessionByTokenHash(c.env, tokenHash)
  if (!session) {
    return apiError(c, 401, 'UNAUTHORIZED', 'Invalid upload token')
  }
  if (session.expires_at <= Math.floor(Date.now() / 1000)) {
    return apiError(c, 401, 'UNAUTHORIZED', 'Upload token expired')
  }

  c.set('uploadSession', session)
  await next()
})
