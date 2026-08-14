import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { requireAuth } from '../middleware/auth'

export const statsRoutes = new Hono<AppEnv>().get('/', requireAuth, async (c) => {
  const counts = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NULL',
  ).first<{ count: number }>()
  const sums = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE deleted_at IS NULL',
  ).first<{ total: number }>()

  return c.json({
    fileCount: Number(counts?.count ?? 0),
    totalBytes: Number(sums?.total ?? 0),
  })
})
