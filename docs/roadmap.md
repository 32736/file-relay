# Roadmap

Tracking document for the current product state and open work. The canonical
architecture and API contracts live in the other `docs/*` files; this file
records what exists now, what is still open, and the decisions that shape
behavior.

## Current state

- Phase 00–09 implemented and validated (`pnpm typecheck` / `lint` / `test` /
  `build` green; 136 tests).
- Features: owner GitHub OAuth, single + multipart uploads (resumable),
  streaming downloads with Range, file list / search / batch delete / storage
  stats, shares (expiring, download-limited, burn-after-reading, QR codes),
  hourly scheduled cleanup, installable PWA + Web Share Target.
- Production running the trimmed build (2026-08-14); `d1_migrations` 0000–0007
  applied, columns from removed features stay inert.

## Open work pool

### R4.2 — Functional verification (needs a browser, owner account)

One OAuth login, one upload (single + multipart), one share create/download —
manual checklist in `docs/operations.md`.

Status: **checklist written** (2026-08-14); awaiting the owner's browser run.
Record the outcome here when done.

### Operations (optional, owner-invoked)

- Retire the production Wrangler secrets that code no longer references
  (`TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `TOKEN_HMAC_SECRET`).
- Commit the working tree (currently ~60 changed files across the E2EE
  lifecycle, the feature trim, and doc syncs).

## Decisions (currently in force)

- **D3 — share download counting stays per-request.** Each download request
  atomically increments `download_count`, including range requests; a resumable
  client issuing several range requests consumes several counts — accepted for
  MVP and documented in `docs/api.md`.
- **D4 — owner upload progress includes resumed bytes.** `useUploads` reports
  `resumedBytes + in-session bytes` so a resumed transfer shows monotonic
  progress.
- **D14 — feature trim: incoming uploads, share passwords, previews removed
  (2026-08-14).** Removed: incoming uploads (`/u/` links, Turnstile,
  `incoming_requests` table, public upload endpoints); share passwords (unlock
  endpoint, `password_mac`); inline previews (all downloads are `attachment`).
  The `incoming_requests` table and `password_mac` column stay inert
  (migrations are never dropped); the retired secrets are no longer referenced
  by code.

## History (no longer in scope)

Planned or implemented and later removed; see git history for details. None of
these are active:

- Phase 10 (Tauri desktop client) — cancelled, browser-only product.
- Phase 11 (E2EE) — implemented then fully removed (plaintext-only).
- Rate limiting beyond existing protections — not needed.
- Backups / scheduled exports — not needed.
- D2 Offline upload queue — explicitly out of scope since Phase 09.

## Validation

Every change ends with:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
