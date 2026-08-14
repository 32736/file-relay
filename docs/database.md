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

## Implemented ownership

- Phase 01: `sessions` (token hashes only; raw session tokens never stored).
- Phase 02: `files` and `upload_sessions` (single uploads; the session table is
  created with the Phase 03-ready multipart shape).
- Phase 03: `upload_parts` (multipart part records, UPSERTed per part).
- Phase 05: `shares` (token hashes only; atomic download claims via
  `UPDATE ... RETURNING`; `password_mac` reserved for Phase 07).
- Phase 08: `incoming_requests` (URL token hashes; atomic file-count quota).

## Planned ownership

- Phase 09+ (PWA/Tauri/E2EE) add no storage; E2EE would need a dedicated
  design before any schema impact.
