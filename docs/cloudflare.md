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

## Production resource creation

Run production-changing commands only after explicit review:

```bash
pnpm wrangler d1 create drop-db
pnpm wrangler r2 bucket create drop-files
```

Future phases configure secrets through `wrangler secret put`, including
`GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_HMAC_SECRET`, and (for incoming
uploads) `TURNSTILE_SECRET_KEY`.

## Local development

`pnpm dev` runs the Cloudflare Vite integration. Local state belongs under
`.wrangler/` and is ignored. Use `.dev.vars` for local secrets; the file is
ignored and must never be committed.

## Deployment boundary

Phase 00 does not create remote resources, migrate production D1, bind DNS,
configure secrets, or deploy. These actions require explicit approval and a
reviewed production configuration.
