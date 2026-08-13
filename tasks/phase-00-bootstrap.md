# Phase 00 - Bootstrap

## Goal

Establish a reliable, testable Vue and Cloudflare Worker foundation.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/cloudflare.md`
- `docs/api.md`
- `docs/database.md`

## Scope

- Vue 3, TypeScript, and Vite SPA.
- Cloudflare Vite plugin and Workers Static Assets SPA fallback.
- Hono Worker entry point.
- Typed D1 `DB` and private R2 `BUCKET` bindings.
- Drizzle schema and migration foundation.
- Vitest coverage for the UI foundation and Worker health route.
- `GET /api/health` returning `{ "ok": true }`.
- pnpm-only scripts for development and required validation.

## Out of Scope

Authentication, file upload or download, sharing, cleanup behavior, Turnstile,
PWA, Tauri, and E2EE.

## Existing Constraints

R2 remains private, the Worker remains the only authorization boundary, no
secret or production account identifier is committed, and no production
Cloudflare operation is performed.

## API Changes

Add `GET /api/health` and a JSON fallback for unknown API routes.

## Database Changes

Create the Drizzle schema entry point and migrations directory without adding
application tables.

## Tests

- Health route responds with status 200 and exactly `{ "ok": true }`.
- Unknown API route responds with JSON 404.
- The Vue application mounts and reports the service foundation status.

## Acceptance Criteria

- The development and production builds use the Cloudflare Vite integration.
- D1 and R2 bindings are typed and configured without real production IDs.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

Summarize changed files, design decisions, command results, and unresolved
issues. Stop without beginning Phase 01.
