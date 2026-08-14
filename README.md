# Drop

Drop is a private, owner-operated file transfer service running on
`drop.28207.cc`. It uses a Vue single-page application and a Cloudflare Worker
on one origin, with D1 for application state and a private R2 bucket for file
content.

## Features

- Owner-only GitHub OAuth (numeric GitHub user ID check).
- Uploads up to 2 GiB: single uploads ≤ 32 MiB, R2 multipart above, with
  part retry/resume on the server.
- Streaming downloads with HTTP Range support (206/416).
- Shares: expiring links, download limits (atomic claims), passwords,
  burn-after-reading, QR codes.
- Incoming uploads: public `/u/<token>` links gated by Cloudflare Turnstile,
  per-upload bearer tokens, atomic file quotas.
- File listing, search, batch delete, storage stats.
- Hourly scheduled cleanup (expired sessions/uploads/shares, deleted files).
- Installable PWA with an offline app shell.

## Requirements

- Node.js 22
- pnpm 10

## Local development

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite. Create a `.dev.vars` file from the keys listed
in `.env.example` (GitHub OAuth, `TOKEN_HMAC_SECRET`, Turnstile). The Worker
health endpoint is available at `GET /api/health` and returns `{ "ok": true }`.

Local state lives under `.wrangler/`; `pnpm db:migrate:local` applies the D1
migrations locally.

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Deployment

Production resources (`drop-db` D1, `drop-files` R2) and secrets are
configured via `wrangler login`, `wrangler d1 create`, `wrangler r2 bucket
create`, and `wrangler secret put`. After changing `wrangler.jsonc`, rebuild
first (the built `dist/drop/wrangler.json` is what `wrangler deploy` uses):

```bash
pnpm build
pnpm run deploy        # note: `pnpm deploy` is a pnpm built-in, use `run`
```

Apply production migrations with `pnpm exec wrangler d1 migrations apply
drop-db --remote`. See [`docs/cloudflare.md`](docs/cloudflare.md) for the
resource and secret checklist.

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Cloudflare configuration](docs/cloudflare.md)
- [API](docs/api.md)
- [Database](docs/database.md)
- [Implementation plan](docs/cloudflare_private_file_drop_codex_implementation_plan.md)
- [Phase tasks](tasks/)

## License

MIT
