import { Hono } from 'hono'

import type { AppEnv } from './env'

export const app = new Hono<AppEnv>()

app.get('/api/health', (context) => context.json({ ok: true }))

app.notFound((context) => {
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

  return context.text('Not found', 404)
})

export default app
