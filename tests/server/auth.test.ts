import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppEnv, Bindings } from '../../server/env'
import { app } from '../../server/index'
import { randomToken, sha256Hex } from '../../server/lib/crypto'
import { storeOwnerEmail } from '../../server/lib/magic-link'
import { requireAuth } from '../../server/middleware/auth'
import { D1Fake } from '../helpers/d1-fake'

const OWNER_ID = 123456
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const GITHUB_USER_URL = 'https://api.github.com/user'
const GITHUB_EMAIL_URL = 'https://api.github.com/user/emails'
const RESEND_EMAILS_URL = 'https://api.resend.com/emails'
const EMAIL_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE'

function stubResend(status = 200): ReturnType<typeof vi.fn> {
  const send = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === RESEND_EMAILS_URL) {
      return jsonResponse({ id: 'email-id' }, status)
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', send)
  return send
}

function testEnv(db: D1Fake): Bindings {
  return {
    DB: db as unknown as D1Database,
    BUCKET: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    APP_ORIGIN: 'https://drop.28207.cc',
    OWNER_GITHUB_ID: String(OWNER_ID),
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    RESEND_API_KEY: 're_test_key',
    EMAIL_ENCRYPTION_KEY,
    MAGIC_LINK_FROM: 'login@example.test',
    UPLOAD_CHUNK_SIZE: '33554432',
    MAX_FILE_SIZE: '2147483648',
    SESSION_TTL_SECONDS: '2592000',
    DEFAULT_RETENTION_DAYS: '0',
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function stubGitHub(overrides: { userId?: number; failTokenExchange?: boolean; emails?: unknown } = {}): void {
  const userId = overrides.userId ?? OWNER_ID
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === GITHUB_TOKEN_URL) {
        if (overrides.failTokenExchange) return jsonResponse({}, 500)
        return jsonResponse({ access_token: 'gho_test_access_token' })
      }
      if (url === GITHUB_USER_URL) {
        return jsonResponse({ id: userId })
      }
      if (url === GITHUB_EMAIL_URL) {
        return jsonResponse(overrides.emails ?? [
          { email: 'owner@example.test', primary: true, verified: true },
        ])
      }
      return new Response('not found', { status: 404 })
    }),
  )
}

function cookieValue(setCookies: string[], name: string): string | undefined {
  const header = setCookies.find((cookie) => cookie.startsWith(`${name}=`))
  if (!header) return undefined
  return header.split(';')[0].slice(name.length + 1)
}

async function completeOAuthLogin(
  db: D1Fake,
): Promise<{ rawToken: string; response: Response }> {
  const env = testEnv(db)
  stubGitHub()

  const start = await app.request('/api/auth/github', {}, env)
  const location = new URL(start.headers.get('location')!)
  const state = location.searchParams.get('state')!
  const stateCookie = start.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith('drop_oauth_state='))!

  const callback = await app.request(
    `/api/auth/github/callback?code=test-code&state=${state}`,
    { headers: { Cookie: stateCookie.split(';')[0] } },
    env,
  )
  const rawToken = cookieValue(callback.headers.getSetCookie(), 'drop_session')!
  return { rawToken, response: callback }
}

async function seedSession(db: D1Fake, expiresInSeconds: number): Promise<string> {
  const rawToken = randomToken(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = Math.floor(Date.now() / 1000)
  await db
    .prepare(
      'INSERT INTO sessions (id, token_hash, github_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(`sess-${now}`, tokenHash, String(OWNER_ID), now, now + expiresInSeconds)
    .run()
  return rawToken
}

describe('Phase 01 auth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects unauthenticated /api/auth/me with 401', async () => {
    const env = testEnv(new D1Fake())
    const response = await app.request('/api/auth/me', {}, env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    })
  })

  it('clears __Host- cookies safely over https (regression)', async () => {
    // Production (https) uses `__Host-` cookie names; deleting them requires
    // the Secure attribute or the cookie serializer throws (500). This guards
    // the unauthenticated /me and failed-OAuth paths.
    const env = testEnv(new D1Fake())

    const me = await app.request('https://drop.28207.cc/api/auth/me', {}, env)
    expect(me.status).toBe(401)

    const callback = await app.request(
      'https://drop.28207.cc/api/auth/github/callback?code=x&state=st',
      { headers: { Cookie: '__Host-drop_oauth_state=other' } },
      env,
    )
    expect(callback.status).toBe(400)
  })

  it('starts OAuth with state cookie and GitHub authorize redirect', async () => {
    const env = testEnv(new D1Fake())
    const response = await app.request('/api/auth/github', {}, env)

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location')!)
    expect(location.origin).toBe('https://github.com')
    expect(location.pathname).toBe('/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('test-client-id')
    expect(location.searchParams.get('scope')).toBe('read:user user:email')
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost/api/auth/github/callback',
    )
    const state = location.searchParams.get('state')
    expect(state).toBeTruthy()

    const setCookies = response.headers.getSetCookie()
    const stateCookie = setCookies.find((cookie) => cookie.startsWith('drop_oauth_state='))
    expect(stateCookie).toBeDefined()
    expect(stateCookie).toContain('HttpOnly')
    expect(cookieValue(setCookies, 'drop_oauth_state')).toBe(state)
  })

  it('rejects a callback with a mismatched state', async () => {
    const env = testEnv(new D1Fake())
    stubGitHub()
    const response = await app.request(
      '/api/auth/github/callback?code=test-code&state=wrong-state',
      { headers: { Cookie: 'drop_oauth_state=other-state' } },
      env,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INVALID_STATE', message: 'OAuth state validation failed' },
    })
  })

  it('rejects a callback without a state cookie', async () => {
    const env = testEnv(new D1Fake())
    stubGitHub()
    const response = await app.request(
      '/api/auth/github/callback?code=test-code&state=some-state',
      {},
      env,
    )

    expect(response.status).toBe(400)
  })

  it('forbids a non-owner GitHub account and creates no session', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    stubGitHub({ userId: 999999 })

    const start = await app.request('/api/auth/github', {}, env)
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const response = await app.request(
      `/api/auth/github/callback?code=test-code&state=${state}`,
      { headers: { Cookie: `drop_oauth_state=${state}` } },
      env,
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'FORBIDDEN', message: 'This GitHub account is not authorized' },
    })
    expect(db.rows('sessions')).toHaveLength(0)
  })

  it('logs in the owner and stores only the token hash', async () => {
    const db = new D1Fake()
    const { rawToken, response } = await completeOAuthLogin(db)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost/')

    const sessionCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('drop_session='))
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).not.toContain('Secure') // http://localhost dev transport

    const rows = db.rows('sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toBe(rawToken)
    expect(rows[0].token_hash).toBe(await sha256Hex(rawToken))
    expect(rows[0].github_user_id).toBe(String(OWNER_ID))

    const emails = db.rows('owner_emails')
    expect(emails).toHaveLength(1)
    expect(emails[0].github_user_id).toBe(String(OWNER_ID))
    expect(emails[0].encrypted_email).not.toContain('owner@example.test')
  })

  it('sends a one-time Magic Link only for the synced GitHub email', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    const resend = stubResend()
    await storeOwnerEmail(env, String(OWNER_ID), 'owner@example.test')

    const request = await app.request(
      '/api/auth/magic-link',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'OWNER@example.test' }),
      },
      env,
    )

    expect(request.status).toBe(204)
    expect(resend).toHaveBeenCalledTimes(1)
    expect(resend).toHaveBeenCalledWith(
      RESEND_EMAILS_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer re_test_key',
          'User-Agent': 'drop/1.0',
        }),
      }),
    )
    const sent = JSON.parse(String(resend.mock.calls[0]?.[1]?.body)) as { text: string; to: string[] }
    expect(sent.to).toEqual(['owner@example.test'])
    const token = /#([A-Za-z0-9_-]{43})/.exec(sent.text)?.[1]
    expect(token).toBeTruthy()
    expect(db.rows('magic_link_tokens')).toHaveLength(1)
    const tokenHash = String(db.rows('magic_link_tokens')[0].token_hash)
    expect(tokenHash).not.toBe(token)
    expect(resend).toHaveBeenCalledWith(
      RESEND_EMAILS_URL,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': `magic-link/${tokenHash}` }),
      }),
    )

    const verify = await app.request(
      '/api/auth/magic-link/verify',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ token }),
      },
      env,
    )
    expect(verify.status).toBe(200)
    expect(cookieValue(verify.headers.getSetCookie(), 'drop_session')).toBeTruthy()

    const replay = await app.request(
      '/api/auth/magic-link/verify',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ token }),
      },
      env,
    )
    expect(replay.status).toBe(400)
    await expect(replay.json()).resolves.toEqual({
      error: { code: 'INVALID_MAGIC_LINK', message: '登录链接无效或已过期' },
    })
  })

  it('does not disclose whether a Magic Link email is eligible', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    const resend = stubResend()
    await storeOwnerEmail(env, String(OWNER_ID), 'owner@example.test')

    const mismatch = await app.request(
      '/api/auth/magic-link',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'other@example.test' }),
      },
      env,
    )
    expect(mismatch.status).toBe(204)
    expect(resend).not.toHaveBeenCalled()
    expect(db.rows('magic_link_tokens')).toHaveLength(0)

    const foreignOrigin = await app.request(
      '/api/auth/magic-link',
      {
        method: 'POST',
        headers: { Origin: 'https://evil.example' },
        body: JSON.stringify({ email: 'owner@example.test' }),
      },
      env,
    )
    expect(foreignOrigin.status).toBe(403)
    expect(resend).not.toHaveBeenCalled()
  })

  it('removes an old email mapping when GitHub no longer has a verified primary email', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    await storeOwnerEmail(env, String(OWNER_ID), 'old@example.test')
    stubGitHub({ emails: [{ email: 'old@example.test', primary: true, verified: false }] })

    const start = await app.request('/api/auth/github', {}, env)
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const response = await app.request(
      `/api/auth/github/callback?code=test-code&state=${state}`,
      { headers: { Cookie: `drop_oauth_state=${state}` } },
      env,
    )

    expect(response.status).toBe(302)
    expect(db.rows('owner_emails')).toHaveLength(0)
  })

  it('removes an unsent Magic Link token when email delivery fails', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    stubResend(503)
    await storeOwnerEmail(env, String(OWNER_ID), 'owner@example.test')

    const response = await app.request(
      '/api/auth/magic-link',
      {
        method: 'POST',
        headers: { Origin: 'http://localhost' },
        body: JSON.stringify({ email: 'owner@example.test' }),
      },
      env,
    )

    expect(response.status).toBe(204)
    expect(db.rows('magic_link_tokens')).toHaveLength(0)
  })

  it('returns the owner identity for a valid session cookie', async () => {
    const db = new D1Fake()
    const rawToken = await seedSession(db, 3600)
    const env = testEnv(db)

    const response = await app.request(
      '/api/auth/me',
      { headers: { Cookie: `drop_session=${rawToken}` } },
      env,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      githubUserId: String(OWNER_ID),
    })
  })

  it('rejects an expired session and lazily deletes the row', async () => {
    const db = new D1Fake()
    const rawToken = await seedSession(db, -60)
    const env = testEnv(db)

    const response = await app.request(
      '/api/auth/me',
      { headers: { Cookie: `drop_session=${rawToken}` } },
      env,
    )

    expect(response.status).toBe(401)
    expect(db.rows('sessions')).toHaveLength(0)
  })

  it('rejects logout from a foreign origin and keeps the session', async () => {
    const db = new D1Fake()
    const rawToken = await seedSession(db, 3600)
    const env = testEnv(db)

    const response = await app.request(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: { Cookie: `drop_session=${rawToken}`, Origin: 'https://evil.example' },
      },
      env,
    )

    expect(response.status).toBe(403)
    expect(db.rows('sessions')).toHaveLength(1)
  })

  it('rejects logout with a missing Origin header', async () => {
    const db = new D1Fake()
    const rawToken = await seedSession(db, 3600)
    const env = testEnv(db)

    const response = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { Cookie: `drop_session=${rawToken}` } },
      env,
    )

    expect(response.status).toBe(403)
    expect(db.rows('sessions')).toHaveLength(1)
  })

  it('logs out with a matching origin and invalidates the session', async () => {
    const db = new D1Fake()
    const rawToken = await seedSession(db, 3600)
    const env = testEnv(db)

    const logout = await app.request(
      '/api/auth/logout',
      {
        method: 'POST',
        headers: { Cookie: `drop_session=${rawToken}`, Origin: 'http://localhost' },
      },
      env,
    )

    expect(logout.status).toBe(204)
    expect(db.rows('sessions')).toHaveLength(0)

    const me = await app.request(
      '/api/auth/me',
      { headers: { Cookie: `drop_session=${rawToken}` } },
      env,
    )
    expect(me.status).toBe(401)
  })

  it('logout is idempotent without a session', async () => {
    const env = testEnv(new D1Fake())
    const response = await app.request(
      '/api/auth/logout',
      { method: 'POST', headers: { Origin: 'http://localhost' } },
      env,
    )

    expect(response.status).toBe(204)
  })

  it('surfaces GitHub upstream failures as 502', async () => {
    const env = testEnv(new D1Fake())
    stubGitHub({ failTokenExchange: true })
    const response = await app.request(
      '/api/auth/github/callback?code=test-code&state=some-state',
      { headers: { Cookie: 'drop_oauth_state=some-state' } },
      env,
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'OAUTH_UPSTREAM_ERROR', message: 'GitHub token exchange failed' },
    })
  })

  it('returns 500 when GitHub OAuth is not configured', async () => {
    const db = new D1Fake()
    const env = { ...testEnv(db), GITHUB_CLIENT_ID: '' }
    const response = await app.request('/api/auth/github', {}, env)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'CONFIGURATION_ERROR', message: 'GitHub OAuth is not configured' },
    })
  })

  it('requireAuth blocks unauthenticated requests and exposes the session', async () => {
    const db = new D1Fake()
    const env = testEnv(db)
    const rawToken = await seedSession(db, 3600)

    const probe = new Hono<AppEnv>()
    probe.get('/probe', requireAuth, (c) =>
      c.json({ ok: true, githubUserId: c.var.session.githubUserId }),
    )

    const denied = await probe.request('/probe', {}, env)
    expect(denied.status).toBe(401)

    const allowed = await probe.request(
      '/probe',
      { headers: { Cookie: `drop_session=${rawToken}` } },
      env,
    )
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toEqual({
      ok: true,
      githubUserId: String(OWNER_ID),
    })
  })
})
