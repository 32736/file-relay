export interface Bindings {
  DB: D1Database
  BUCKET: R2Bucket
  ASSETS: Fetcher
  APP_ORIGIN: string
  OWNER_GITHUB_ID: string
  GITHUB_CLIENT_ID: string
  GITHUB_CLIENT_SECRET: string
  UPLOAD_CHUNK_SIZE: string
  MAX_FILE_SIZE: string
  SESSION_TTL_SECONDS: string
  DEFAULT_RETENTION_DAYS: string
}

export interface SessionContext {
  sessionId: string
  githubUserId: string
}

export type AppEnv = {
  Bindings: Bindings
  Variables: {
    session: SessionContext
  }
}
