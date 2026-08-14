import { Hono } from 'hono'

import type { AppEnv, Bindings } from './env'
import { authRoutes } from './routes/auth'
import { fileRoutes } from './routes/files'
import { incomingRoutes, publicIncomingRoutes } from './routes/incoming'
import { publicUploadRoutes } from './routes/public-uploads'
import { shareRoutes } from './routes/shares'
import { publicShareRoutes } from './routes/shares-public'
import { statsRoutes } from './routes/stats'
import { uploadRoutes } from './routes/uploads'
import { runCleanup } from './services/cleanup'

export const app = new Hono<AppEnv>()

app.get('/api/health', (context) => context.json({ ok: true }))

app.route('/api/auth', authRoutes)
app.route('/api/files', fileRoutes)
app.route('/api/uploads', uploadRoutes)
app.route('/api/shares', shareRoutes)
app.route('/api/public/shares', publicShareRoutes)
app.route('/api/stats', statsRoutes)
app.route('/api/incoming-requests', incomingRoutes)
app.route('/api/public/incoming', publicIncomingRoutes)
app.route('/api/public/uploads', publicUploadRoutes)

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

export default {
  fetch: app.fetch,
  async scheduled(_controller, env: Bindings, ctx) {
    ctx.waitUntil(runCleanup(env))
  },
} satisfies ExportedHandler<Bindings>
