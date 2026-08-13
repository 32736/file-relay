# Database

Cloudflare D1 stores metadata and business state. R2 stores file content. All
schema changes are represented by ordered SQL files under `db/migrations/` and
are never applied to production implicitly.

## Conventions

- IDs are text UUIDs generated with `crypto.randomUUID()` unless the value is a
  security token.
- Timestamps are Unix epoch seconds in D1.
- Security token columns contain hashes or keyed MACs, never raw tokens.
- Foreign keys and indexes are introduced with the table that needs them.
- Queries avoid unindexed full-table scans.

## Phase 00 schema

Phase 00 intentionally creates no application tables. It establishes the
Drizzle schema entry point and migrations directory. Each later phase owns its
schema additions so its migration, implementation, and tests can be reviewed
together.

## Planned ownership

- Phase 01: `sessions`.
- Phase 02: `files` and `upload_sessions` needed for single uploads.
- Phase 03: multipart fields and `upload_parts`.
- Phase 05: `shares`.
- Phase 08: `incoming_requests` and public upload authorization state.
