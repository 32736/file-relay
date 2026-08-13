# Drop Repository Instructions

## Project

Drop is a personal file transfer service built on Cloudflare using Vue 3,
TypeScript, Vite, Workers Static Assets, Hono, D1, Drizzle ORM, and a private
R2 bucket.

Before implementing a task:

1. Read this file.
2. Read the relevant documents under `docs/`.
3. Read the requested task under `tasks/`.
4. Inspect the existing implementation.
5. Implement only the requested phase.

## Package Manager

Use pnpm only. Do not use npm or yarn.

## Required Validation

Before considering any task complete, run:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

Do not report a phase complete when a required command fails.

## Architecture Rules

- R2 must remain private.
- The Worker is the only authorization boundary.
- D1 stores metadata and application state; R2 stores file content.
- Browser clients must never receive infrastructure credentials.
- Do not change the infrastructure architecture or persistence layer without
  explicit approval.

## Streaming Rules

- Large uploads and downloads must use streams.
- Never buffer a complete large upload or download in Worker memory.
- Do not use `request.arrayBuffer()` for large upload bodies.
- Do not use `object.arrayBuffer()` for large downloads.

## Security Rules

- Never expose or log credentials, secrets, passwords, or raw security tokens.
- Generate security tokens with Web Crypto, never `Math.random()`.
- Session, share, and upload-access tokens must not be stored in plaintext.
- Owner authentication must compare the GitHub numeric user ID.
- OAuth state verification is mandatory.
- State-changing cookie-authenticated APIs must validate `Origin`.
- Do not inline-preview user-provided HTML or SVG.
- Never use original filenames as R2 object keys.

## Database

- Apply every schema change through a migration.
- Validate every API input.
- Avoid unindexed full-table scans.
- Store timestamps as Unix epoch seconds in D1 unless a phase explicitly
  documents a different wire representation.

## Scope

- Implement only the requested phase and stop after reporting its results.
- Do not refactor unrelated code or add out-of-scope optional features.
- If implementation conflicts with architecture documentation, stop and
  explain the conflict instead of silently changing the architecture.

## Cloudflare APIs

If repository documentation differs from an installed API:

1. Inspect package versions and local type definitions.
2. Inspect repository-local documentation and existing code.
3. Consult official Cloudflare documentation when available.
4. Do not guess signatures or change architecture to bypass an unknown API.

## Git

- Keep changes scoped to the current phase.
- Do not commit secrets.
- Do not modify lockfiles unless dependencies changed.
- Before finishing, summarize changed files, design decisions, validation
  results, and unresolved issues.
