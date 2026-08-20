import { Hono } from 'hono'

import type { AppEnv, Bindings } from './env'
import { authRoutes } from './routes/auth'
import { auditRoutes } from './routes/audit'
import { fileRoutes } from './routes/files'
import { shareRoutes } from './routes/shares'
import { publicShareRoutes } from './routes/shares-public'
import { statsRoutes } from './routes/stats'
import { uploadRoutes } from './routes/uploads'
import { runCleanup } from './services/cleanup'

export const app = new Hono<AppEnv>()

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; manifest-src 'self'; font-src 'self'; media-src 'self' blob:",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Resource-Policy': 'same-origin',
} as const

app.use('*', async (context, next) => {
  await next()
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value)
  if (context.req.path.startsWith('/api/')) context.header('Cache-Control', 'no-store')
})

app.get('/api/health', (context) => context.json({ ok: true }))

app.route('/api/auth', authRoutes)
app.route('/api/audit', auditRoutes)
app.route('/api/files', fileRoutes)
app.route('/api/uploads', uploadRoutes)
app.route('/api/shares', shareRoutes)
app.route('/api/public/shares', publicShareRoutes)
app.route('/api/stats', statsRoutes)
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
