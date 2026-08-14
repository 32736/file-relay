# Cloudflare configuration

## Resources

| Resource | Name | Binding |
| --- | --- | --- |
| Worker | `drop` | n/a |
| D1 database | `drop-db` | `DB` |
| Private R2 bucket | `drop-files` | `BUCKET` |
| Production origin | `https://drop.28207.cc` | `APP_ORIGIN` |

`wrangler.jsonc` contains a conspicuous zero-valued D1 database ID placeholder
so local code can be bootstrapped without committing an account identifier.
Replace it with the ID returned when the production database is created; do not
commit credentials or secrets.

## Static assets routing

The Worker runs first (`assets.run_worker_first: true`) and serves `/api/*`
itself; all other paths are forwarded to the `ASSETS` binding
(`assets.binding: "ASSETS"`, declared explicitly — without it `env.ASSETS` is
undefined). This keeps API routes — including navigation-style requests such as
GitHub OAuth — in the Worker, while `not_found_handling:
"single-page-application"` preserves SPA deep-link refreshes through
`env.ASSETS.fetch()`. Without `run_worker_first`, navigation requests
(`Sec-Fetch-Mode: navigate`) that miss an asset are answered with `index.html`
by the assets service and never reach the Worker.

## Production resource creation

Run production-changing commands only after explicit review:

```bash
pnpm wrangler d1 create drop-db
pnpm wrangler r2 bucket create drop-files
```

Phase 01 adds owner authentication. `OWNER_GITHUB_ID` (numeric GitHub user ID)
and `GITHUB_CLIENT_ID` are non-secret vars configured in `wrangler.jsonc`
(empty placeholders by default; a missing value denies logins). The secret
`GITHUB_CLIENT_SECRET` is configured through `wrangler secret put`, and
locally through `.dev.vars`.

Phase 06 adds an hourly cron trigger (`17 * * * *`). The Worker's `scheduled`
handler runs the bounded cleanup pass in `server/services/cleanup.ts`: expired
sessions, stale upload sessions (aborting R2 multiparts), expired files,
exhausted burn-after-reading files (after a 1-hour safety window), physically
deleted logically-deleted files, revoked/expired shares, and revoked/expired
incoming requests. Each task is capped at 50 rows per run.

Phase 09 adds PWA installability: `public/manifest.webmanifest`, `icon.svg`,
and a network-first `sw.js` (app-shell caching only; `/api/*` is never
cached). The service worker registers in production builds only; it also
receives Web Share Target payloads (Chromium) and routes them into the upload
queue.

## CI / deployment

`.github/workflows/ci.yml` runs typecheck/lint/test/build on every push/PR.
`.github/workflows/deploy.yml` deploys on manual trigger
(`workflow_dispatch`) using the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets. The token should be minimal
permission: Workers Scripts Edit, D1 Edit, Account Settings Read. Production
D1 migrations stay manual (`pnpm exec wrangler d1 migrations apply drop-db
--remote`). `workers.dev` and preview URLs are disabled in production.

## Local development

`pnpm dev` runs the Cloudflare Vite integration. Local state belongs under
`.wrangler/` and is ignored. Use `.dev.vars` for local secrets; the file is
ignored and must never be committed.

## Deployment boundary

Phase 00 does not create remote resources, migrate production D1, bind DNS,
configure secrets, or deploy. These actions require explicit approval and a
reviewed production configuration.
