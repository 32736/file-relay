# Drop

Drop is a private, owner-operated file transfer service designed for
`drop.28207.cc`. It uses a Vue single-page application and a Cloudflare Worker
on one origin, with D1 for application state and a private R2 bucket for file
content.

Phase 00 provides the repository foundation and a health endpoint. Phase 01
adds owner-only GitHub OAuth. File upload, download, and sharing are
intentionally not implemented yet.

## Requirements

- Node.js 22
- pnpm 10

## Local development

```bash
pnpm install
pnpm dev
```

Open the URL printed by Vite. The Worker health endpoint is available at
`GET /api/health` and returns `{ "ok": true }`.

The committed D1 database ID is a non-production placeholder. Before a remote
deployment, create `drop-db`, replace the placeholder in `wrangler.jsonc`, and
configure the required resources and secrets described in
[`docs/cloudflare.md`](docs/cloudflare.md).

## Validation

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Documentation

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Cloudflare configuration](docs/cloudflare.md)
- [API](docs/api.md)
- [Database](docs/database.md)
- [Implementation plan](docs/cloudflare_private_file_drop_codex_implementation_plan.md)

## License

MIT
