import type { Bindings } from '../env'
import { sha256Hex } from './crypto'

export interface SessionRecord {
  id: string
  github_user_id: string
  created_at: number
  expires_at: number
}

const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Resolves a session from a raw cookie token. Looks up D1 by the SHA-256 hash
 * of the token and rejects expired sessions, lazily deleting expired rows.
 */
export async function findSession(
  env: Bindings,
  rawToken: string | null | undefined,
): Promise<SessionRecord | null> {
  if (!rawToken) return null

  const tokenHash = await sha256Hex(rawToken)
  const row = await env.DB.prepare(
    'SELECT id, github_user_id, created_at, expires_at FROM sessions WHERE token_hash = ?',
  )
    .bind(tokenHash)
    .first<SessionRecord>()
  if (!row) return null

  const now = Math.floor(Date.now() / 1000)
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run()
    return null
  }

  return row
}

/** Stores a new session; only the token hash is persisted. */
export async function createSession(
  env: Bindings,
  githubUserId: string,
  sessionToken: string,
): Promise<void> {
  const tokenHash = await sha256Hex(sessionToken)
  const now = Math.floor(Date.now() / 1000)
  const ttlSeconds = Number(env.SESSION_TTL_SECONDS) || DEFAULT_SESSION_TTL_SECONDS

  await env.DB.prepare(
    'INSERT INTO sessions (id, token_hash, github_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), tokenHash, githubUserId, now, now + ttlSeconds)
    .run()
}

/** Deletes the session identified by a raw cookie token. */
export async function deleteSessionByToken(env: Bindings, rawToken: string): Promise<void> {
  const tokenHash = await sha256Hex(rawToken)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}
