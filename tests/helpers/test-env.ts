import type { Bindings } from '../../server/env'
import { randomToken, sha256Hex } from '../../server/lib/crypto'
import type { D1Fake } from './d1-fake'
import type { R2Fake } from './r2-fake'

export const OWNER_ID = '123456'

export function makeTestEnv(
  db: D1Fake,
  bucket: R2Fake,
  overrides: Partial<Bindings> = {},
): Bindings {
  return {
    DB: db as unknown as D1Database,
    BUCKET: bucket as unknown as R2Bucket,
    ASSETS: {} as Fetcher,
    APP_ORIGIN: 'https://drop.28207.cc',
    OWNER_GITHUB_ID: OWNER_ID,
    GITHUB_CLIENT_ID: 'test-client-id',
    GITHUB_CLIENT_SECRET: 'test-client-secret',
    RESEND_API_KEY: 're_test_key',
    EMAIL_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE',
    MAGIC_LINK_FROM: 'login@example.test',
    UPLOAD_CHUNK_SIZE: '33554432',
    MAX_FILE_SIZE: '2147483648',
    SESSION_TTL_SECONDS: '2592000',
    DEFAULT_RETENTION_DAYS: '30',
    ...overrides,
  }
}

let sessionSeed = 0

/** Seeds an owner session directly and returns the raw cookie header. */
export async function seedOwnerSession(db: D1Fake): Promise<string> {
  const rawToken = randomToken(32)
  const tokenHash = await sha256Hex(rawToken)
  const now = Math.floor(Date.now() / 1000)
  await db
    .prepare(
      'INSERT INTO sessions (id, token_hash, github_user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(`sess-${now}-${sessionSeed++}`, tokenHash, OWNER_ID, now, now + 3600)
    .run()
  return `drop_session=${rawToken}`
}
