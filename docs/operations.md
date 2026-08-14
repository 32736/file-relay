# Operations

Production runbook for `drop.28207.cc` (Worker `drop`, D1 `drop-db`,
R2 `drop-files`).

## Prerequisites (one-time)

- `wrangler login` (or `CLOUDFLARE_API_TOKEN`) for local commands.
- GitHub production OAuth App registered with callback
  `https://drop.28207.cc/api/auth/github/callback`.
- Turnstile widget for the domain; secrets below.

## Secrets (already set)

- `GITHUB_CLIENT_SECRET` — GitHub OAuth App secret
- `TOKEN_HMAC_SECRET` — share-password MAC key
- `TURNSTILE_SECRET_KEY` — Turnstile secret

Public vars live in `wrangler.jsonc` (`GITHUB_CLIENT_ID`, `TURNSTILE_SITE_KEY`,
`OWNER_GITHUB_ID`, limits). Note: after changing `wrangler.jsonc`, rebuild
first — `wrangler deploy` uses the built `dist/drop/wrangler.json`.

## Deploy

```bash
pnpm build
pnpm run deploy        # NOT `pnpm deploy` (pnpm built-in)
```

Production D1 migrations are applied manually (review gate):

```bash
pnpm exec wrangler d1 migrations apply drop-db --remote
```

## CI / CD

- `.github/workflows/ci.yml` — runs typecheck/lint/test/build on push/PR.
- `.github/workflows/deploy.yml` — manual deploy (`workflow_dispatch`)
  using repository secrets `CLOUDFLARE_API_TOKEN` (minimal permission:
  Workers Scripts Edit, D1 Edit, Account Settings Read) and
  `CLOUDFLARE_ACCOUNT_ID`.

## Owner login verification

1. Open `https://drop.28207.cc`.
2. Click **Sign in with GitHub** and authorize.
3. Expect to land back on the app showing **Signed in as owner**; the header
   shows the storage stats and three tabs (文件 / 分享 / 上传请求).
4. If the callback errors, check the URL: a `500` is a server fault, while
   `403 FORBIDDEN` means the GitHub account is not the owner
   (`OWNER_GITHUB_ID`).

## Notes

- `workers.dev` and preview URLs are disabled in production; the only entry is
  the custom domain.
- The service worker caches only the app shell (network-first); `/api/*` is
  never cached. Web Share Target (Chromium) files land in the upload queue.
- Local development secrets live in `.dev.vars` (git-ignored); production
  secrets are Wrangler secrets — never commit either.
