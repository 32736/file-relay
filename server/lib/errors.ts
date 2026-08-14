import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AppEnv } from '../env'

/** Structured API error envelope shared by all routes. */
export function apiError(
  c: Context<AppEnv>,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  return c.json({ error: { code, message } }, status)
}
