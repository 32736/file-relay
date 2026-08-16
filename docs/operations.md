# Operations

Production runbook for `drop.28207.cc` (Worker `drop`, D1 `drop-db`,
R2 `drop-files`).

## Prerequisites (one-time)

- `wrangler login` (or `CLOUDFLARE_API_TOKEN`) for local commands.
- GitHub production OAuth App registered with callback
  `https://drop.28207.cc/api/auth/github/callback`.

## Secrets

- `GITHUB_CLIENT_SECRET` — GitHub OAuth App secret
- `EMAIL_ENCRYPTION_KEY` — a 32-byte Base64URL secret used to encrypt the
  GitHub-verified primary email stored for Magic Link delivery
- `RESEND_API_KEY` — a Resend sending-only API key for Magic Link delivery
  (required before the first Magic Link deployment)

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

## GitHub 邮箱 Magic Link

Magic Link is an alternative login method for the same GitHub owner identity;
it is not a separate account system. The first GitHub OAuth login after this
feature is deployed requests `user:email`, then securely synchronizes the
verified primary email from GitHub.

Before enabling production delivery:

1. In Resend, add and verify `notify.28207.cc` as a sending domain. Add its
   required DNS-only SPF, DKIM, and MX records in Cloudflare DNS (or use
   Resend's Cloudflare Domain Connect flow).

2. Create a Resend sending-only API key, then store it without committing it:

   ```bash
   pnpm exec wrangler secret put RESEND_API_KEY
   ```

3. Store the encryption secret without printing it or committing it:

   ```bash
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=' | pnpm exec wrangler secret put EMAIL_ENCRYPTION_KEY
   ```

4. Apply migration `0010_magic_links.sql`, deploy, and complete one GitHub
   login so the verified primary email is synchronized.

The Worker sends only from `Drop <login@notify.28207.cc>`. Requesting a link always returns
`204`, including for non-matching addresses, to avoid email enumeration.

## CI / CD

- `.github/workflows/ci.yml` — runs typecheck/lint/test/build on push/PR.
- `.github/workflows/deploy.yml` — manual deploy (`workflow_dispatch`)
  using repository secrets `CLOUDFLARE_API_TOKEN` (minimal permission:
  Workers Scripts Edit, D1 Edit, Account Settings Read) and
  `CLOUDFLARE_ACCOUNT_ID`.

## Owner login verification

1. Open `https://drop.28207.cc`.
2. Click **Sign in with GitHub** and authorize.
3. Expect to land back on the app showing the owner workspace; the header
   shows storage stats, a share control, and logout.
4. If the callback errors, check the URL: a `500` is a server fault, while
   `403 FORBIDDEN` means the GitHub account is not the owner
   (`OWNER_GITHUB_ID`).

## Functional verification checklist (roadmap R4.2)

Manual browser sweep against `https://drop.28207.cc`. Tick each item; record
any failure (status code + console error) in the roadmap.

### 1. Owner authentication
- [ ] Open the app → "Sign in with GitHub" → authorize → land back as
      "Signed in as owner".
- [ ] The header shows storage stats, the share control, and logout.

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
