import { Hono } from 'hono'

import type { AppEnv } from './env'
import { authRoutes } from './routes/auth'
import { fileRoutes } from './routes/files'
import { uploadRoutes } from './routes/uploads'

export const app = new Hono<AppEnv>()

app.get('/api/health', (context) => context.json({ ok: true }))

app.route('/api/auth', authRoutes)
app.route('/api/files', fileRoutes)
app.route('/api/uploads', uploadRoutes)

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
