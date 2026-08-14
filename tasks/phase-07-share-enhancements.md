# Phase 07 - Share Enhancements

## Goal

After MVP approval, add password-protected shares, safe inline previews,
share QR codes, storage statistics, batch deletion, filename search, and a
first usable owner UI (upload, list, download, delete, share dialog). The
backend stays API-first; the front end becomes a thin, functional layer over
the existing API.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/cloudflare_private_file_drop_codex_implementation_plan.md`
  (§29 share passwords, §33 preview safety whitelist, §38 UI, §44 routes,
  §58 phase scope, §69 security test matrix)

## Scope

- **Share passwords** (plan §29): HMAC-SHA-256 password MACs, an unlock
  endpoint, and password-gated downloads.
- **Safe previews** (plan §33): inline `Content-Disposition` for the whitelist
  (`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `application/pdf`)
  on owner and public downloads; HTML/SVG/XHTML stay `attachment`.
- **QR codes**: client-side QR rendering of the share URL in the share dialog
  (no server dependency).
- **Storage statistics**: `GET /api/stats` (owner) → file count + total bytes.
- **Batch deletion**: `POST /api/files/batch-delete` (owner, logical delete).
- **Search**: `GET /api/files?q=` filename filter.
- **Owner UI**: upload zone, file list with download/delete, share dialog with
  password/limits/QR. Single-page, no router; small components.
- **Docs sync** (`docs/api.md`, `docs/cloudflare.md` for `TOKEN_HMAC_SECRET`).

## Out of Scope

- Turnstile / incoming uploads (Phase 08), PWA (Phase 09), Tauri/E2EE.
- Storage quotas, per-folder UX, video streaming, online Office.
- Server-side QR generation or any non-whitelist inline rendering.

## Existing Constraints

- Security tokens use Web Crypto; password MACs are keyed hashes
  (`TOKEN_HMAC_SECRET`), never plaintext passwords.
- Previews never render HTML/SVG/XHTML inline on the application origin
  (XSS); whitelist MIME only, and the browser's `file.type` is untrusted.
- Deletion stays logical (physical cleanup is Phase 06 cron).
- The raw share token appears once; D1 stores hashes only.

## Design Decisions (confirmed)

1. **Password MAC (plan §29).** `password_mac = HMAC-SHA-256(TOKEN_HMAC_SECRET,
   shareId + "\0" + password)`, hex encoded; stored on the share. The raw
   password is never stored or logged. `TOKEN_HMAC_SECRET` is a Wrangler
   secret (`.dev.vars` locally).
2. **Stateless unlock proof.** `POST /api/public/shares/:token/unlock` with
   `{ "password" }` recomputes the MAC and, on match, sets an HttpOnly cookie
   `share_unlock_<shareId>` whose value **is the MAC itself** (short-lived, 30
   minutes, SameSite=Lax). Downloads of password-protected shares require this
   cookie to equal `password_mac` — stateless (no D1 writes), and impossible
   to forge without the secret. Metadata remains readable
   (`passwordRequired: true`); only downloads are gated.
3. **Preview whitelist is server-enforced.** `contentDisposition` gains a
   whitelist helper; owner and public downloads render `inline` only for the
   whitelist, otherwise `attachment`. `X-Content-Type-Options: nosniff` stays
   on every response.
4. **`GET /api/stats`** (owner): one bounded aggregate query per metric —
   `COUNT(*)` of non-deleted files and `COALESCE(SUM(size), 0)` over the same
   set. Response `{ "fileCount", "totalBytes" }`.
5. **Batch delete** is a single `UPDATE files SET deleted_at = ? WHERE
   id IN (...) AND deleted_at IS NULL`; the response reports how many were
   actually deleted (already-deleted ids are skipped). Cap: 100 ids per call.
6. **Search is a `LIKE` filter.** `GET /api/files?q=` adds
   `AND original_name LIKE ?` with `%escaped%` (escapes `%`/`_`/`\`); empty `q`
   is ignored. Pagination/sorting unchanged.
7. **Front end is a functional thin layer.** No router/Pinia; App.vue hosts an
   upload zone (drag & drop + file picker), the file list (download/delete),
   and a share dialog (options + password + QR). It reuses the existing API
   and honors the CSRF `Origin` rule (same-origin fetch sends it). QR uses the
   `qrcode` npm package (client-side). Tests cover components with stubbed
   fetch.

## API Changes

### `POST /api/files/:fileId/shares` (owner)

Body gains optional `"password": string` (1–128 chars). When present, stores
the HMAC MAC; the response adds `"passwordProtected": true` (the raw password
never leaves the client except in the body). `password: null` behaves as
absent.

### `GET /api/public/shares/:token`

`passwordRequired` now reflects `password_mac IS NOT NULL`.

### `POST /api/public/shares/:token/unlock`

Body `{ "password": string }`. Wrong/absent → `403 FORBIDDEN` (no detail).
Match → sets the `share_unlock_<shareId>` cookie and `200 { "ok": true }`.

### `GET /api/public/shares/:token/download`

If the share has `password_mac`, requires the unlock cookie to equal it →
else `403 FORBIDDEN` (before any claim is consumed).

### Downloads (owner + public) — preview whitelist

`Content-Disposition` is `inline` for whitelisted MIME types, `attachment`
otherwise. Whitelist: `image/png`, `image/jpeg`, `image/webp`, `image/gif`,
`application/pdf`. Never inline: `text/html`, `image/svg+xml`,
`application/xhtml+xml`, or anything else.

### `GET /api/stats` (owner)

`200 { "fileCount": number, "totalBytes": number }`.

### `POST /api/files/batch-delete` (owner)

Body `{ "ids": string[] }` (1–100). Logically deletes them; `200
{ "deleted": number }` (already-deleted ids excluded).

### `GET /api/files?q=...`

Adds the case-insensitive filename filter (SQLite `LIKE`).

## Tests

Harness: extend `tests/helpers/d1-fake.ts` with `LIKE` conditions and
`COUNT(*)` / `SUM(col)` / `COALESCE(SUM(col), 0)` select expressions;
`tests/helpers/test-env.ts` gains a `TOKEN_HMAC_SECRET` binding.

Matrix (maps to plan §58/§69 and acceptance criteria):

1. Password share: create with `password` → `passwordProtected: true`, MAC in
   D1 ≠ password and equals `HMAC(secret, id + "\0" + password)`; metadata says
   `passwordRequired: true`.
2. Unlock: correct password → cookie set (HttpOnly, same value as MAC); wrong
   password → `403`, no cookie.
3. Password-gated download: without cookie → `403` and **no claim consumed**
   (`download_count` unchanged); with correct cookie → `200` + claim consumed;
   share exhausted → still `403`.
4. Unprotected shares are unaffected (no unlock needed).
5. Preview whitelist: PNG/JPEG/WebP/GIF/PDF → `inline` disposition; HTML/SVG →
   `attachment`; unknown type → `attachment`; applies to owner and public
   downloads.
6. `GET /api/stats`: counts and sums only non-deleted files; empty table → `0`.
7. Batch delete: multiple ids deleted (logical), response count correct;
   already-deleted ids skipped; > 100 ids → `400`; missing ids don't error.
8. Search: `q` matches case-insensitively, `%`/`_` in the query are literal,
   empty `q` ignored, pagination still works with `q`.
9. UI: App renders upload zone and file list; share dialog shows password
   option and renders a QR canvas; actions call the right endpoints.
10. Regression: all prior phases' tests stay green.

## Acceptance Criteria

- Password-protected shares download only after a correct unlock; no claim is
  wasted on failed unlocks.
- Images/PDF preview inline on the origin; HTML/SVG never inline.
- Stats, batch delete, and search work end-to-end; UI covers the owner loop.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

1. Summarize changed files (expected: `server/lib/crypto.ts` (+HMAC),
   `server/lib/download.ts` (whitelist), `server/routes/files.ts` (q,
   batch-delete), `server/routes/shares.ts` (+password),
   `server/routes/shares-public.ts` (unlock + gating), `server/routes/stats.ts`,
   `src/App.vue` + `src/components/*`, `tests/helpers/*`, new tests,
   `package.json` (+qrcode), `docs/api.md`, `docs/cloudflare.md`).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues.
5. Stop. Do not start Phase 08.

---

# 设计决策摘要（中文，供人工 review）

- **密码 MAC（方案 §29）**：`HMAC-SHA-256(TOKEN_HMAC_SECRET, shareId + "\0" + password)` 存库；明文密码永不存储/记录；`TOKEN_HMAC_SECRET` 走 Wrangler secret。
- **无状态解锁证明**：unlock 校验后设 HttpOnly cookie（30 分钟），**cookie 值就是 MAC 本身**——下载时比对 cookie 值 == `password_mac`，无需 D1 写入、无伪造可能；元数据仍可见（`passwordRequired: true`），只有下载被门控。
- **预览白名单服务端强制**：仅 `image/png/jpeg/webp/gif` + `application/pdf` 允许 `inline`，HTML/SVG/XHTML 永不 inline；`nosniff` 恒在。
- **`GET /api/stats`**：非删除文件的 `COUNT(*)` 与 `SUM(size)` 聚合。
- **批量删除**：单条 `UPDATE ... WHERE id IN (...) AND deleted_at IS NULL`，返回实际删除数，上限 100。
- **搜索**：`LIKE '%q%'`（转义 `%`/`_`/`\`），空 `q` 忽略，分页不变。
- **前端薄层**：无 router/Pinia，App.vue + 组件（上传区/列表/分享对话框含二维码），复用现有 API；QR 用 `qrcode` 客户端包。
