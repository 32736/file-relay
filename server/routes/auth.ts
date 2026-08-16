import { Hono } from 'hono'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'

import type { AppEnv } from '../env'
import {
  clearSessionCookie,
  clearStateCookie,
  sessionCookieName,
  setSessionCookie,
  setStateCookie,
  stateCookieName,
} from '../lib/cookies'
import { constantTimeEqual, randomToken, sha256Hex } from '../lib/crypto'
import { apiError } from '../lib/errors'
import {
  consumeMagicLinkToken,
  createMagicLinkToken,
  deleteMagicLinkToken,
  deleteOwnerEmail,
  findOwnerEmail,
  normalizeEmail,
  storeOwnerEmail,
} from '../lib/magic-link'
import { sendMagicLinkEmail } from '../lib/resend'
import { createSession, deleteSessionByToken, findSession } from '../lib/session'
import { isSameOrigin, requireSameOrigin } from '../middleware/auth'

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_EMAIL_URL = 'https://api.github.com/user/emails'
const OAUTH_STATE_TTL_SECONDS = 600

const magicLinkRequestSchema = z.object({
  email: z.string().trim().email().max(320),
})
const magicLinkVerifySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
})

type GitHubEmail = { email?: string; primary?: boolean; verified?: boolean }

function oauthRedirectUri(requestUrl: string): string {
  return `${new URL(requestUrl).origin}/api/auth/github/callback`
}

function emailFailureCategory(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'unknown'
}

async function syncGitHubPrimaryEmail(env: AppEnv['Bindings'], accessToken: string, githubUserId: string): Promise<void> {
  try {
    const response = await fetch(GITHUB_EMAIL_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'drop',
      },
    })
    if (!response.ok) {
      console.error('github_email_sync_failed:upstream')
      return
    }
    const emails = (await response.json()) as GitHubEmail[]
    const primary = emails.find((email) => email.primary && email.verified && typeof email.email === 'string')
    if (!primary?.email) {
      await deleteOwnerEmail(env, githubUserId)
      console.error('github_email_sync_failed:no-verified-primary')
      return
    }
    await storeOwnerEmail(env, githubUserId, primary.email)
  } catch {
    console.error('github_email_sync_failed:storage-or-network')
  }
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
    authorizeUrl.searchParams.set('scope', 'read:user user:email')
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

    await syncGitHubPrimaryEmail(c.env, accessToken, String(githubUserId))

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
  .post('/magic-link', requireSameOrigin, async (c) => {
    const parsed = magicLinkRequestSchema.safeParse(await c.req.json().catch(() => null))
    // This endpoint intentionally has an indistinguishable response for an
    // invalid address, a non-owner address, rate limiting, and send failures.
    if (!parsed.success) return c.body(null, 204)

    let issuedTokenHash: string | null = null
    try {
      const ownerEmail = await findOwnerEmail(c.env, c.env.OWNER_GITHUB_ID)
      if (!ownerEmail || !constantTimeEqual(normalizeEmail(parsed.data.email), ownerEmail)) {
        return c.body(null, 204)
      }

      const token = randomToken(32)
      issuedTokenHash = await sha256Hex(token)
      const issued = await createMagicLinkToken(
        c.env,
        c.env.OWNER_GITHUB_ID,
        issuedTokenHash,
      )
      if (!issued) return c.body(null, 204)

      const url = `${c.env.APP_ORIGIN}/auth/magic#${token}`
      await sendMagicLinkEmail(c.env, ownerEmail, url, issuedTokenHash)
    } catch (error) {
      if (issuedTokenHash) {
        try {
          await deleteMagicLinkToken(c.env, issuedTokenHash)
        } catch {
          // The regular cleanup pass will remove an unsent token if deletion fails.
        }
      }
      // Never log the recipient, token, or encrypted email value.
      console.error(`magic_link_send_failed:${emailFailureCategory(error)}`)
    }
    return c.body(null, 204)
  })
  .post('/magic-link/verify', requireSameOrigin, async (c) => {
    const parsed = magicLinkVerifySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return apiError(c, 400, 'INVALID_MAGIC_LINK', '登录链接无效或已过期')

    const record = await consumeMagicLinkToken(c.env, await sha256Hex(parsed.data.token))
    if (!record || String(record.github_user_id) !== String(c.env.OWNER_GITHUB_ID)) {
      return apiError(c, 400, 'INVALID_MAGIC_LINK', '登录链接无效或已过期')
    }

    const sessionToken = randomToken(32)
    await createSession(c.env, c.env.OWNER_GITHUB_ID, sessionToken)
    setSessionCookie(c, sessionToken)
    return c.json({ ok: true })
  })
