const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Server-side Turnstile validation (plan §36). Throws on upstream failure. */
export async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp: string | null,
): Promise<boolean> {
  if (!secretKey || !token) return false

  const form = new FormData()
  form.set('secret', secretKey)
  form.set('response', token)
  if (remoteIp) form.set('remoteip', remoteIp)

  const response = await fetch(TURNSTILE_SITEVERIFY_URL, { method: 'POST', body: form })
  if (!response.ok) {
    throw new Error('Turnstile verification failed')
  }
  const body = (await response.json()) as { success?: boolean }
  return body.success === true
}
