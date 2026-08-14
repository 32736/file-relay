import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'

import type { AppEnv } from '../env'
import {
  clearSessionCookie,
  clearStateCookie,
  sessionCookieName,
  setSessionCookie,
  setStateCookie,
  stateCookieName,
} from '../lib/cookies'
import { constantTimeEqual, randomToken } from '../lib/crypto'
import { apiError } from '../lib/errors'
import { createSession, deleteSessionByToken, findSession } from '../lib/session'
import { isSameOrigin } from '../middleware/auth'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const OAUTH_STATE_TTL_SECONDS = 600

function oauthRedirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/auth/github/callback`
}

export const authRoutes = new Hono<AppEnv>()
  .get('/github', (c) => {
    const { GITHUB_CLIENT_ID } = c.env
    if (!GITHUB_CLIENT_ID) {
      return apiError(c, 500, 'CONFIGURATION_ERROR', 'GitHub OAuth is not configured')
    }

    const state = randomToken(32)
    setStateCookie(c, state, OAUTH_STATE_TTL_SECONDS)

    const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL)
    authorizeUrl.searchParams.set('client_id', GITHUB_CLIENT_ID)
    authorizeUrl.searchParams.set('redirect_uri', oauthRedirectUri(c.req.url))
    authorizeUrl.searchParams.set('scope', 'read:user')
    authorizeUrl.searchParams.set('state', state)

    return c.redirect(authorizeUrl.toString(), 302)
  })
  .get('/github/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    const stateCookie = getCookie(c, stateCookieName(c.req.url))

    if (!code || !state || !stateCookie || !constantTimeEqual(state, stateCookie)) {
      clearStateCookie(c)
      return apiError(c, 400, 'INVALID_STATE', 'OAuth state validation failed')
    }
    clearStateCookie(c)

    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, OWNER_GITHUB_ID } = c.env
    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !OWNER_GITHUB_ID) {
      return apiError(c, 500, 'CONFIGURATION_ERROR', 'GitHub OAuth is not configured')
    }

    const redirectUri = oauthRedirectUri(c.req.url)

    let accessToken: string
    try {
      const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'drop',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          client_secret: GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      })
      if (!tokenResponse.ok) {
        return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub token exchange failed')
      }
      const tokenData = (await tokenResponse.json()) as { access_token?: string }
      if (!tokenData.access_token) {
        return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub token exchange failed')
      }
      accessToken = tokenData.access_token
    } catch {
      return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub token exchange failed')
    }

    let githubUserId: number
    try {
      const userResponse = await fetch(GITHUB_USER_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'drop',
        },
      })
      if (!userResponse.ok) {
        return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub user lookup failed')
      }
      const userData = (await userResponse.json()) as { id?: number }
      if (typeof userData.id !== 'number') {
        return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub user lookup failed')
      }
      githubUserId = userData.id
    } catch {
      return apiError(c, 502, 'OAUTH_UPSTREAM_ERROR', 'GitHub user lookup failed')
    }

    if (String(githubUserId) !== String(OWNER_GITHUB_ID)) {
      return apiError(c, 403, 'FORBIDDEN', 'This GitHub account is not authorized')
    }

    const sessionToken = randomToken(32)
    await createSession(c.env, String(githubUserId), sessionToken)
    setSessionCookie(c, sessionToken)

    return c.redirect(`${new URL(c.req.url).origin}/`, 302)
  })
  .get('/me', async (c) => {
    const token = getCookie(c, sessionCookieName(c.req.url))
    const session = await findSession(c.env, token)
    if (!session) {
      clearSessionCookie(c)
      return apiError(c, 401, 'UNAUTHORIZED', 'Not authenticated')
    }
    return c.json({ authenticated: true, githubUserId: session.github_user_id })
  })
  .post('/logout', async (c) => {
    if (!isSameOrigin(c.req.raw)) {
      return apiError(c, 403, 'FORBIDDEN', 'Cross-origin request rejected')
    }

    const token = getCookie(c, sessionCookieName(c.req.url))
    if (token) {
      await deleteSessionByToken(c.env, token)
    }
    clearSessionCookie(c)
    return c.body(null, 204)
  })
