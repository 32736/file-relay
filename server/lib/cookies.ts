import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../env'

// Production (https) uses `__Host-` prefixed names: browsers then require
// Secure, Path=/, and no Domain. Local development over http://localhost
// cannot use the prefix because browsers reject `__Host-` cookies without the
// Secure attribute, so a plain name is used there instead.
const SESSION_COOKIE_HTTPS = '__Host-drop_session'
const SESSION_COOKIE_HTTP = 'drop_session'
const STATE_COOKIE_HTTPS = '__Host-drop_oauth_state'
const STATE_COOKIE_HTTP = 'drop_oauth_state'

function isHttps(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === 'https:'
}

export function sessionCookieName(requestUrl: string): string {
  return isHttps(requestUrl) ? SESSION_COOKIE_HTTPS : SESSION_COOKIE_HTTP
}

export function stateCookieName(requestUrl: string): string {
  return isHttps(requestUrl) ? STATE_COOKIE_HTTPS : STATE_COOKIE_HTTP
}

/** Sets the owner session cookie (HttpOnly, SameSite=Lax, Path=/). */
export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, sessionCookieName(c.req.url), token, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: 'Lax',
    path: '/',
  })
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, sessionCookieName(c.req.url), {
    path: '/',
    // `__Host-` prefixed names require the Secure attribute; without it the
    // cookie serializer rejects the header.
    secure: isHttps(c.req.url),
  })
}

/** Sets the short-lived OAuth state cookie (HttpOnly, SameSite=Lax). */
export function setStateCookie(c: Context<AppEnv>, state: string, maxAgeSeconds: number): void {
  setCookie(c, stateCookieName(c.req.url), state, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

export function clearStateCookie(c: Context<AppEnv>): void {
  deleteCookie(c, stateCookieName(c.req.url), {
    path: '/',
    secure: isHttps(c.req.url),
  })
}
