import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'

import type { AppEnv } from '../env'
import { sessionCookieName } from '../lib/cookies'
import { apiError } from '../lib/errors'
import { findSession } from '../lib/session'

/**
 * Resolves the owner session from the session cookie and exposes it as
 * `c.var.session`. Phase 02+ mounts this on protected routes.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, sessionCookieName(c.req.url))
  const session = await findSession(c.env, token)
  if (!session) {
    return apiError(c, 401, 'UNAUTHORIZED', 'Not authenticated')
  }

  c.set('session', { sessionId: session.id, githubUserId: session.github_user_id })
  await next()
})

/**
 * Validates that a state-changing request carrying cookies originates from this
 * application's own origin. On this single-origin deployment the request URL
 * origin equals `APP_ORIGIN`; comparing against the request's own origin keeps
 * local development working without overriding configuration. Missing `Origin`
 * is rejected.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return false
  return origin === new URL(request.url).origin
}
