import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Phase 01: owner authentication sessions. Only the SHA-256 hash of the raw
// session token is stored; the raw token exists solely in the owner's cookie.
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    githubUserId: text('github_user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('idx_sessions_expires_at').on(table.expiresAt)],
)

// Phase 02: file metadata. R2 holds the bytes under `object_key`; the original
// filename is metadata only. A row is created when an upload completes, so the
// table never contains half-uploaded files. Deletion is logical via
// `deleted_at`; physical R2 cleanup is a Phase 06 cron responsibility.
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    objectKey: text('object_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type'),
    size: integer('size').notNull(),
    etag: text('etag'),
    source: text('source').notNull().default('owner'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => [
    index('idx_files_created_at').on(table.createdAt),
    index('idx_files_expires_at').on(table.expiresAt),
    index('idx_files_deleted_at').on(table.deletedAt),
  ],
)

// Phase 02: upload sessions, created with the full Phase 03-ready shape
// (mode / r2_upload_id / access_token_hash / status lifecycle) so multipart
// only adds behavior, not schema. `auth_kind` is 'owner' until Phase 08 adds
// incoming uploads.
export const uploadSessions = sqliteTable(
  'upload_sessions',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id').notNull(),
    objectKey: text('object_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type'),
    totalSize: integer('total_size').notNull(),
    chunkSize: integer('chunk_size').notNull(),
    totalParts: integer('total_parts').notNull(),
    mode: text('mode').notNull(),
    r2UploadId: text('r2_upload_id'),
    authKind: text('auth_kind').notNull(),
    accessTokenHash: text('access_token_hash'),
    status: text('status').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    completedAt: integer('completed_at'),
  },
  (table) => [
    index('idx_upload_sessions_status').on(table.status),
    index('idx_upload_sessions_expires_at').on(table.expiresAt),
  ],
)
