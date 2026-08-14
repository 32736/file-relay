# Phase 08 - Incoming Upload

## Goal

After MVP approval, let anyone (no login) upload files to the owner via an
expiring "incoming request" link, protected by Cloudflare Turnstile and a
short-lived hashed upload-access token, with atomic file-count/size quotas and
public single/multipart upload endpoints.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/cloudflare.md`
- `docs/cloudflare_private_file_drop_codex_implementation_plan.md`
  (§12 incoming_requests model, §36 incoming flow, §37 incoming token,
  §44 public incoming/uploads routes, §59 phase scope)

## Scope

- `incoming_requests` table (migration).
- Owner routes: `POST /api/incoming-requests`, `GET /api/incoming-requests`,
  `DELETE /api/incoming-requests/:id`.
- Public routes: `GET /api/public/incoming/:token` (metadata + site key),
  `POST /api/public/incoming/:token/uploads` (Turnstile → quota claim →
  upload-access token → upload session), and the public upload endpoints
  (`/api/public/uploads/...`) authenticated by the bearer upload-access token.
- Minimal `/u/:token` front-end component (Turnstile widget + file picker).
- Docs sync (`docs/api.md`, `docs/cloudflare.md` for `TURNSTILE_*`).

## Out of Scope

- PWA (Phase 09), Tauri/E2EE (Phases 10/11).
- Incoming *downloads*; per-request passcodes beyond Turnstile.
- Any non-Turnstile anti-abuse (rate limiting is a later concern).

## Existing Constraints

- R2 stays private; the Worker is the only authorization boundary.
- Uploads stream (single: `BUCKET.put(objectKey, request.body)`; parts:
  `multipart.uploadPart(partNumber, body)`); never buffer.
- Security tokens use Web Crypto; D1 stores SHA-256 hashes, never raw tokens.
- Quotas are enforced atomically (`UPDATE ... RETURNING`), never
  SELECT-then-UPDATE.
- `TURNSTILE_SECRET_KEY` is a secret; `TURNSTILE_SITE_KEY` is public.

## Design Decisions (confirmed)

1. **Two-token model (plan §36/§37).** The incoming request has a URL token
   (`/u/<token>`, SHA-256 in `incoming_requests.token_hash`) that identifies
   the request; it is *not* the upload credential. After Turnstile passes, the
   server issues a per-upload `upload_access_token` (32 bytes, base64url;
   SHA-256 in `upload_sessions.access_token_hash`) that authorizes the public
   upload endpoints (`Authorization: Bearer <token>`).
2. **Turnstile gates session creation only** (plan §36): one siteverify per
   uploaded file, before the quota claim. siteverify failures → `403
   FORBIDDEN` and no session. The site key is returned by the metadata
   endpoint so the page can render the widget (site keys are public).
3. **Atomic quota claim (plan §37).** `UPDATE incoming_requests SET
   uploaded_count = uploaded_count + 1 WHERE id = ? AND revoked_at IS NULL AND
   expires_at > ? AND uploaded_count < max_files RETURNING *`; zero rows →
   `403` (expired/revoked/full). `max_file_size` is checked against the
   declared size (plus the global `MAX_FILE_SIZE`); the request's own
   remaining capacity is not tracked per-byte (file-count quota only, matching
   the plan's model).
4. **Upload sessions carry `auth_kind = 'incoming'`.** The existing
   `upload_sessions` table gains no columns; creation stores
   `access_token_hash` and `auth_kind`. Owner flows stay `auth_kind = 'owner'`.
5. **Public upload endpoints reuse the owner pipeline.** `/api/public/uploads`
   hosts `PUT .../:id/content`, `PUT .../:id/parts/:partNumber`, `POST
   .../:id/complete`, `DELETE .../:id` with a bearer middleware that resolves
   the session by `access_token_hash` (never by cookie). Same size/part
   validation, streaming, and completion as owner uploads; the `files` row is
   created with `source = 'incoming'`.
6. **Incoming requests expire and revoke.** `expires_at` (required),
   `revoked_at` flag; metadata/download refusal is uniform `404` on public
   routes. Phase 06's cron does not clean incoming rows yet (out of scope;
   noted for a later cleanup extension).
7. **Front end is a minimal `/u/:token` component** rendered by pathname
   inspection in App.vue (no router added in this phase): Turnstile widget
   (via the official script), file picker, single/multipart upload using the
   returned upload token. Owner UI is unchanged.

## API Changes

### `POST /api/incoming-requests` (owner)

Body `{ "title"?: string, "expiresIn": seconds, "maxFiles": number (1–100),
"maxFileSize"?: bytes (≤ MAX_FILE_SIZE) }` → `200 { "id", "url",
"expiresAt", "maxFiles", "maxFileSize", "uploadedCount": 0 }`. `url` is
`${APP_ORIGIN}/u/<token>`; the raw token appears once.

### `GET /api/incoming-requests` (owner)

Paginated list `{ id, title, url (none — raw token not stored), createdAt,
expiresAt, maxFiles, maxFileSize, uploadedCount, revokedAt }`.

### `DELETE /api/incoming-requests/:id` (owner)

Revoke → `204`; idempotent; unknown → `404`.

### `GET /api/public/incoming/:token`

`200 { "title", "expiresAt", "maxFiles", "maxFileSize", "uploadedCount",
"siteKey" }`; unknown/revoked/expired → `404`.

### `POST /api/public/incoming/:token/uploads`

Body `{ "turnstileToken": string, "name": string, "size": number, "type"?
string }`. Validates Turnstile, then the request validity + quota (atomic
claim), then creates the upload session with a fresh upload-access token →
`200 { "uploadId", "mode", "chunkSize", "totalParts", "uploadToken" }`.

### `/api/public/uploads/...` (bearer)

- `PUT /:id/content`, `PUT /:id/parts/:partNumber`, `POST /:id/complete`,
  `DELETE /:id` — same semantics as the owner routes, authenticated by
  `Authorization: Bearer <upload_access_token>`, restricted to
  `auth_kind = 'incoming'` sessions.

## Database Changes

New migration (`db/migrations/0004_*.sql`):

```sql
CREATE TABLE `incoming_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `token_hash` text NOT NULL,
  `title` text,
  `expires_at` integer NOT NULL,
  `max_file_size` integer NOT NULL,
  `max_files` integer NOT NULL,
  `uploaded_count` integer DEFAULT 0 NOT NULL,
  `created_at` integer NOT NULL,
  `revoked_at` integer
);
CREATE UNIQUE INDEX `incoming_requests_token_hash_unique` ON `incoming_requests` (`token_hash`);
CREATE INDEX `idx_incoming_expires_at` ON `incoming_requests` (`expires_at`);
```

## Tests

Harness: extend `tests/helpers/test-env.ts` with `TURNSTILE_SECRET_KEY` and
`TURNSTILE_SITE_KEY`; Turnstile calls are stubbed via `fetch` (siteverify
success/failure). The D1 fake already covers `RETURNING`/increments.

Matrix (maps to plan §59/§69 and acceptance criteria):

1. Unauthenticated owner incoming routes → `401`; cross-origin writes → `403`.
2. Create incoming request → `200` with a `/u/<token>` URL; D1 stores the
   SHA-256 hash, not the token; `expiresIn`/`maxFiles`/`maxFileSize` honored.
3. Public metadata: valid → `200` with `siteKey` and no internal fields;
   unknown/revoked/expired → `404`.
4. Turnstile failure → `403`, no session created, quota untouched.
5. Valid Turnstile → session created with `auth_kind = 'incoming'` and a
   hashed `access_token_hash`; response carries the raw upload token once.
6. Atomic file quota: `maxFiles = 1` → two concurrent session creations →
   exactly one `200`; `uploaded_count` ends at 1; the second gets `403`.
7. Oversized file (`size > maxFileSize` or `> MAX_FILE_SIZE`) → `400`/`413`
   before any quota claim.
8. Bearer upload: single content upload + complete via
   `/api/public/uploads/...` → `200`, file row `source = 'incoming'`;
   parts/multipart complete works; wrong/missing bearer → `401`; owner-only
   session rejects bearer (and vice versa: bearer cannot touch owner
   sessions).
9. Expired/revoked incoming request → metadata `404` and session creation
   `403`; revoke idempotent `204`.
10. Front end: the `/u/...` component renders (Turnstile placeholder),
    uploads through the returned token (stubbed fetch).

## Acceptance Criteria

- A stranger can open `/u/<token>`, pass Turnstile, and upload single or
  multipart files; the owner sees them in `/api/files` with `source =
  'incoming'`.
- Quota is never oversubscribed under concurrency; Turnstile bypass is not
  possible (server-side siteverify only).
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm db:migrate:local
```

## Completion

1. Summarize changed files (expected: `db/schema.ts`, new migration,
   `server/routes/incoming.ts`, `server/routes/public-uploads.ts`,
   `server/middleware/upload-token.ts`, `src/components/IncomingUpload.vue`,
   `tests/helpers/*`, `tests/server/incoming.test.ts`, `docs/api.md`,
   `docs/cloudflare.md`).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues.
5. Stop. Do not start Phase 09.

---

# 设计决策摘要（中文，供人工 review）

- **双 token 模型（方案 §36/§37）**：请求链接 token（`/u/<token>`，标识请求，SHA-256 存 `incoming_requests.token_hash`）≠ 上传凭据；Turnstile 通过后服务端发**每次上传的 `upload_access_token`**（32B，SHA-256 存 `upload_sessions.access_token_hash`），公开上传端点用 `Authorization: Bearer`。
- **Turnstile 只门控会话创建**（方案 §36）：每文件一次 siteverify，通过后才原子 claim 配额；失败 → 403 且不建会话；site key 公开（元数据返回供页面渲染 widget）。
- **原子配额（方案 §37）**：`UPDATE ... SET uploaded_count = uploaded_count + 1 WHERE ... AND uploaded_count < max_files RETURNING *`；0 行 → 403；按文件数配额（与方案模型一致）。
- **复用 owner 上传管线**：`auth_kind = 'incoming'` + `access_token_hash` 走同一套 single/multipart/complete 逻辑；`files.source = 'incoming'`。
- **公开路由统一 404**：过期/撤销/未知不区分。
- **前端最小收件页**：App.vue 按 pathname 渲染 `/u/:token` 组件（Turnstile widget + 选择文件 + 用返回的上传 token 上传），本期不引入 router。
