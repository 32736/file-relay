import { Hono } from 'hono'

import type { AppEnv } from './env'
import { authRoutes } from './routes/auth'

export const app = new Hono<AppEnv>()

app.get('/api/health', (context) => context.json({ ok: true }))

app.route('/api/auth', authRoutes)

app.notFound(async (context) => {
  if (context.req.path.startsWith('/api/')) {
    return context.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'API route not found',
        },
      },
      404,
    )
  }

  // Non-API paths are served by Static Assets (with SPA fallback). The Worker
  // runs first (`run_worker_first`), so it must forward these requests.
  return context.env.ASSETS.fetch(context.req.raw)
})

export default app
