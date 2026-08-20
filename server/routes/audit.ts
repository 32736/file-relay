import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/auth'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

interface AuditRow {
  id: string
  actor_github_id: string | null
  action: string
  target_type: string
  target_id: string | null
  metadata: string | null
  created_at: number
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export const auditRoutes = new Hono<AppEnv>().get('/', requireAuth, async (c) => {
  const rawLimit = Number(c.req.query('limit'))
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT
  const rawCursor = Number(c.req.query('cursor'))
  const offset = Number.isFinite(rawCursor) ? Math.max(Math.trunc(rawCursor), 0) : 0

  const result = await c.env.DB.prepare(
    `SELECT id, actor_github_id, action, target_type, target_id, metadata, created_at
     FROM audit_logs
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit + 1, offset)
    .all<AuditRow>()

  const hasMore = result.results.length > limit
  const totalRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM audit_logs',
  ).first<{ total: number }>()
  return c.json({
    entries: result.results.slice(0, limit).map((row) => ({
      id: row.id,
      actorGithubId: row.actor_github_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: parseMetadata(row.metadata),
      createdAt: row.created_at,
    })),
    total: totalRow?.total ?? 0,
    nextCursor: hasMore ? String(offset + limit) : null,
  })
})
