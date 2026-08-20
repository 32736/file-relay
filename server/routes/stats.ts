import { Hono } from 'hono'

import type { AppEnv } from '../env'
import { storageQuotaBytes } from '../lib/r2'
import { requireAuth } from '../middleware/auth'

export const statsRoutes = new Hono<AppEnv>().get('/', requireAuth, async (c) => {
  const now = Math.floor(Date.now() / 1000)
  const counts = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM files WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
  ).bind(now).first<{ count: number }>()
  const sums = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)',
  ).bind(now).first<{ total: number }>()

  const totalBytes = Number(sums?.total ?? 0)
  const quotaBytes = storageQuotaBytes(c.env.STORAGE_QUOTA_BYTES)
  return c.json({
    fileCount: Number(counts?.count ?? 0),
    totalBytes,
    quotaBytes,
    usedRatio: Math.min(1, totalBytes / quotaBytes),
  })
})
