export interface Bindings {
  DB: D1Database
  BUCKET: R2Bucket
  APP_ORIGIN: string
  UPLOAD_CHUNK_SIZE: string
  MAX_FILE_SIZE: string
  SESSION_TTL_SECONDS: string
  DEFAULT_RETENTION_DAYS: string
}

export type AppEnv = {
  Bindings: Bindings
}
