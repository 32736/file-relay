export interface Bindings {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS: Fetcher
  APP_ORIGIN: string
  OWNER_GITHUB_ID: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  TOKEN_HMAC_SECRET: string
  TURNSTILE_SECRET_KEY: string
  TURNSTILE_SITE_KEY: string
  UPLOAD_CHUNK_SIZE: string
  MAX_FILE_SIZE: string
  SESSION_TTL_SECONDS: string
  DEFAULT_RETENTION_DAYS: string
}

export interface SessionContext {
  sessionId: string
  githubUserId: string
}

/** Upload session resolved by a bearer upload-access token (Phase 08). */
export interface UploadSessionContext {
  id: string
  file_id: string
  object_key: string
  original_name: string
  mime_type: string | null
  total_size: number
  chunk_size: number
  total_parts: number
  mode: string
  r2_upload_id: string | null
  auth_kind: string
  status: string
  expires_at: number
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    session: SessionContext
    uploadSession?: UploadSessionContext
  }
}
