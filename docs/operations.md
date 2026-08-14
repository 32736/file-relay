# Operations

Production runbook for `drop.28207.cc` (Worker `drop`, D1 `drop-db`,
R2 `drop-files`).

## Prerequisites (one-time)

- `wrangler login` (or `CLOUDFLARE_API_TOKEN`) for local commands.
- GitHub production OAuth App registered with callback
  `https://drop.28207.cc/api/auth/github/callback`.

## Secrets (already set)

- `GITHUB_CLIENT_SECRET` — GitHub OAuth App secret

Public vars live in `wrangler.jsonc` (`GITHUB_CLIENT_ID`, `OWNER_GITHUB_ID`,
limits). Note: after changing `wrangler.jsonc`, rebuild first — `wrangler
deploy` uses the built `dist/drop/wrangler.json`.

## Deploy

```bash
pnpm build
pnpm run deploy        # NOT `pnpm deploy` (pnpm built-in)
```

### Deploy with the minimal-permission API token

A minimal-permission token (`drop-deploy`: Workers Scripts Edit, D1 Edit,
Account Settings Read) is stored in the git-ignored `.vars` file as
`CLOUDFLARE_API_TOKEN`. Use it for scripted/CI deployments:

```powershell
$vars = @{}
Get-Content .vars | ForEach-Object { if ($_ -match '^([A-Z_]+)=(.*)$') { $vars[$matches[1]] = $matches[2] } }
$env:CLOUDFLARE_API_TOKEN = $vars['CLOUDFLARE_API_TOKEN']
pnpm run deploy
```

Account ID: `82bdd11ec9921fe04af95ca034feb790`. To enable the manual CD
workflow (`.github/workflows/deploy.yml`), add repository secrets
`CLOUDFLARE_API_TOKEN` (the same value) and `CLOUDFLARE_ACCOUNT_ID`, then run
Actions → Deploy → Run workflow.

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

## Functional verification checklist (roadmap R4.2)

Manual browser sweep against `https://drop.28207.cc`. Tick each item; record
any failure (status code + console error) in the roadmap.

### 1. Owner authentication
- [ ] Open the app → "Sign in with GitHub" → authorize → land back as
      "Signed in as owner".
- [ ] The header shows storage stats and the three tabs (文件 / 分享 / 上传请求)
      and the three tabs (文件 / 分享 / 上传请求).

### 2. Upload / download
- [ ] Drag a small file (≤ 32 MiB) into the upload zone → completes → appears
      in the list → download and verify bytes.
- [ ] Upload a file > 32 MiB (multipart) → completes → download and verify.
- [ ] Delete a file → disappears from the list; a second delete is idempotent.

### 3. Sharing (plaintext)
- [ ] Create a share with an expiry + max downloads → open the `/s/<token>` URL
      in a new window → metadata correct → download works.
- [ ] Revoke the share → the public URL returns 404/403.
### 4. PWA
- [ ] The browser offers "install" (manifest + SW present); offline reload of
      the app shell works after one online visit.

### 5. Cleanup sanity
- [ ] An expired session/uploads/share you created earlier is gone the next
      hour (cron) — or manually confirm via the D1 counts below.

Record the outcome in `docs/roadmap.md` (R4.2 status).

## Notes

- `workers.dev` and preview URLs are disabled in production; the only entry is
  the custom domain.
- The service worker caches only the app shell (network-first); `/api/*` is
  never cached. Web Share Target (Chromium) files land in the upload queue.
- Local development secrets live in `.dev.vars` (git-ignored); production
  secrets are Wrangler secrets — never commit either.
