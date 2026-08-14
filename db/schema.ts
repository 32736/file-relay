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
