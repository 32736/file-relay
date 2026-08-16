# Roadmap

Tracking document for the current product state and open work. The canonical
architecture and API contracts live in the other `docs/*` files; this file
records what exists now, what is still open, and the decisions that shape
behavior.

## Current state

- Current product behavior is covered by type checking, linting, tests, and
  production builds.
- Features: owner GitHub OAuth, single + multipart uploads (resumable),
  streaming downloads with Range, file list / search / batch delete / storage
  stats, shares (expiring, download-limited, burn-after-reading, QR codes),
  hourly scheduled cleanup, installable PWA + Web Share Target.
- Production uses private R2, D1 metadata, and a single Cloudflare Worker
  authorization boundary.

## Open work pool

### R4.2 — Functional verification (needs a browser, owner account)

One OAuth login, one upload (single + multipart), one share create/download —
manual checklist in `docs/operations.md`.

Status: **checklist written** (2026-08-14); awaiting the owner's browser run.
Record the outcome here when done.

## Decisions (currently in force)

- **D3 — share download counting stays per-request.** Each download request
  atomically increments `download_count`, including range requests; a resumable
  client issuing several range requests consumes several counts — accepted for
  MVP and documented in `docs/api.md`.
- **D4 — owner upload progress includes resumed bytes.** `useUploads` reports
  `resumedBytes + in-session bytes` so a resumed transfer shows monotonic
  progress.
## Validation

Every change ends with:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
