# Phase 01 - Authentication

## Goal

Implement owner-only GitHub OAuth: state validation, numeric owner-ID
authorization, hashed sessions, secure cookies, Origin protection, logout, and
`/api/auth/me`. Provide a reusable `requireAuth` middleware so Phase 02+ mounts
protected routes without reimplementing session checks.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/cloudflare.md`
- `docs/api.md`
- `docs/database.md`

## Scope

- `sessions` table migration (Drizzle schema + `drizzle-kit generate`).
- Four auth routes: `GET /api/auth/github`, `GET /api/auth/github/callback`,
  `GET /api/auth/me`, `POST /api/auth/logout`.
- Reusable `requireAuth` middleware and an Origin-validation helper for
  state-changing cookie-authenticated routes.
- Environment: add `OWNER_GITHUB_ID`, `GITHUB_CLIENT_ID` (wrangler vars,
  placeholders) and `GITHUB_CLIENT_SECRET` (secret; `.dev.vars` locally,
  `wrangler secret put` in production). Update `server/env.ts`, `wrangler.jsonc`
  vars, and `.env.example`.
- Minimal front-end auth surface in `src/App.vue`: a "Sign in with GitHub"
  link plus logged-in state display. No router, no Pinia.
- Tests with an in-memory D1 fake and a stubbed `fetch` for GitHub.
- Documentation sync: `docs/api.md` (new Phase 01 section), `docs/database.md`
  (sessions ownership note).

## Out of Scope

- File upload, download, sharing, cleanup, PWA, QR codes, and storage stats.
- Multi-user model: this service has exactly one owner.
- `SESSION_SECRET` / HMAC keyed session tokens (see Design Decisions).
- Front-end routing, state management, or any heavier UI.

## Existing Constraints

- R2 stays private; the Worker remains the only authorization boundary; no
  production Cloudflare operation is performed in this phase.
- Owner identity is the GitHub numeric user ID — never username, login, email.
- Security tokens use Web Crypto random bytes, base64url encoded; never
  `Math.random()`.
- D1 stores hashes only, never raw session tokens. Timestamps are Unix epoch
  seconds. Plain IDs use `crypto.randomUUID()`.
- State-changing cookie-authenticated APIs must validate `Origin`.
- Session cookie is HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, with a
  `__Host-` prefix in production.

## Design Decisions (confirmed)

1. **Session token hashing — plain SHA-256.** The session token is 32 random
   bytes, base64url encoded. D1 stores `SHA-256(token)`. A 32-byte high-entropy
   token is not subject to offline guessing, so no pepper/HMAC is required;
   `SESSION_SECRET` is intentionally not introduced this phase (it stays
   available for future needs).
2. **Cookie naming depends on transport security.** Browsers reject any
   `__Host-` cookie that lacks the Secure attribute, and Secure cookies are not
   sent over plain `http://` — so local development on `http://localhost`
   cannot use `__Host-drop_session`. The cookie helper derives the name from the
   request origin protocol:
   - `https` → `__Host-drop_session` (HttpOnly, Secure, SameSite=Lax, Path=/)
   - `http` → `drop_session` (HttpOnly, SameSite=Lax, Path=/; Secure omitted)
   The OAuth state cookie follows the same rule
   (`__Host-drop_oauth_state` / `drop_oauth_state`), HttpOnly, SameSite=Lax,
   ~10 minute lifetime.
3. **OAuth redirect_uri is derived from the request origin**
   (`new URL(request.url).origin + '/api/auth/github/callback'`), so one code
   path serves the development GitHub OAuth App (`http://localhost:*`) and the
   production App (`https://drop.28207.cc`) without extra configuration.
4. **Origin validation compares against the request origin**, not a fixed
   `APP_ORIGIN` constant. On this single-origin deployment the request URL
   origin always equals `APP_ORIGIN`, and comparing against the request origin
   keeps local development working without overriding `APP_ORIGIN` in
   `.dev.vars`. A cross-site attacker's `Origin` can never equal the request's
   own origin. Missing `Origin` on a state-changing cookie route → `403`.
   (This is a deliberate, documented refinement of the implementation plan's
   literal "check `Origin: https://drop.28207.cc`" wording.)
5. **Test harness — in-memory D1 fake.** A small `D1Database`-shaped fake
   (`prepare`/`bind`/`all`/`run`/`first`) backed by a plain table store, plus a
   stubbed global `fetch` for the two GitHub endpoints. Keeps Vitest fast and
   dependency-free; `@cloudflare/vitest-pool-workers` is not introduced.
6. **Minimal front-end.** `src/App.vue` gains a sign-in link and a session
   status indicator only; no router/store changes in this phase.

## API Changes

### `GET /api/auth/github`

- Generates a 32-byte base64url state value (Web Crypto), stores it in the
  OAuth-state HttpOnly cookie, and responds `302` to
  `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`,
  `state`, and `scope=read:user`.
- Missing configuration (`GITHUB_CLIENT_ID`) → structured `500`.

### `GET /api/auth/github/callback`

- Query params: `code`, `state`.
- Constant-time comparison of `state` against the state cookie; mismatch,
  missing, or expired → `400 INVALID_STATE` (and the state cookie is cleared).
- Exchange `code` at `POST https://github.com/login/oauth/access_token`
  (`Accept: application/json`) using `client_id`, `client_secret`, and the same
  `redirect_uri`; upstream failure → structured `502`.
- Fetch `GET https://api.github.com/user` with `Authorization: Bearer <token>`;
  upstream failure → structured `502`.
- If the numeric `user.id` does not equal `OWNER_GITHUB_ID` → `403 FORBIDDEN`,
  no session is created, no session cookie is set.
- Success: generate a 32-byte base64url session token, store
  `SHA-256(token)` in `sessions` (`id` = `crypto.randomUUID()`,
  `created_at`/`expires_at` = epoch seconds, TTL from
  `SESSION_TTL_SECONDS`), set the session cookie, clear the state cookie, and
  `302` to the request origin root (`/`).
- Logging must never include the raw token, code, or GitHub token.

### `GET /api/auth/me`

- Reads the session cookie, hashes it, looks up `sessions` by `token_hash`, and
  checks `expires_at > now`.
- Valid → `200 { "authenticated": true, "githubUserId": "..." }`.
- Invalid/expired → `401 UNAUTHORIZED`; an expired row is lazily deleted and
  the cookie cleared.

### `POST /api/auth/logout`

- Validates `Origin` (decision 4); mismatch or missing → `403 FORBIDDEN`.
- Deletes the session row, clears the session cookie → `204 No Content`.
- Idempotent: no valid session still yields `204`.

### Error envelope

Follows the Phase 00 shape: `{ "error": { "code", "message" } }` with codes
such as `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_STATE`, `OAUTH_UPSTREAM_ERROR`,
`CONFIGURATION_ERROR`.

### `requireAuth` middleware

Resolves the session from the cookie (same logic as `me`) and attaches
`{ sessionId, githubUserId }` to `c.var`; otherwise `401`. Exported so Phase 02
mounts protected routes with one call. `Origin` enforcement remains opt-in per
route for state-changing endpoints.

## Database Changes

One migration (`db/migrations/0001_*.sql` generated by Drizzle):

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                -- crypto.randomUUID()
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256(raw token), never the raw token
  github_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,        -- Unix epoch seconds
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

Note: the implementation plan (§12) also lists an explicit
`idx_sessions_token_hash`. In SQLite a `UNIQUE` constraint already creates a
backing index, so an additional index is redundant; it is intentionally not
created. Queries filter by `token_hash` (unique lookup) or scan bounded cleanup
by `expires_at`.

## Tests

Harness: `tests/helpers/` in-memory D1 fake + GitHub `fetch` stub. Matrix
(maps to implementation plan §69 "Auth" and §52 acceptance):

1. Unauthenticated `GET /api/auth/me` → `401`.
2. `GET /api/auth/github` → `302`; `Location` contains `client_id`, `state`,
   `redirect_uri`, `scope`; response sets the state cookie (HttpOnly).
3. Callback with missing/mismatched `state` → `4xx`; no session row created.
4. Callback with a non-owner GitHub id → `403`; no session row, no session
   cookie.
5. Callback with the owner GitHub id → `302` + session cookie; the stored
   `token_hash` is not the raw token and equals `SHA-256(raw token)`.
6. `GET /api/auth/me` with a valid cookie → `200 authenticated: true`.
7. Expired session → `401` (and lazy row deletion).
8. `POST /api/auth/logout` with a wrong/missing `Origin` → `403`; session row
   retained.
9. `POST /api/auth/logout` with a correct `Origin` → `204`; row deleted, cookie
   cleared; subsequent `me` → `401`.
10. `POST /api/auth/logout` without a session → `204` (idempotent).
11. `requireAuth` on a protected probe route: no/invalid cookie → `401`;
    valid cookie → handler receives `githubUserId`.
12. App test updated: `src/App.vue` renders the sign-in surface.

## Acceptance Criteria

- Unauthenticated management API → `401`.
- Non-owner GitHub account → `403`, no session created.
- Owner → login succeeds; session cookie works; `me` returns identity.
- Wrong OAuth state → rejected.
- Logout invalidates the session.
- No raw token ever stored in D1 or logged.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

1. Summarize changed files (expected: `db/schema.ts`, new migration,
   `server/env.ts`, `server/index.ts`, new `server/routes/auth.ts`,
   `server/lib/*`, `server/middleware/*`, `tests/helpers/*`,
   `tests/server/auth.test.ts`, `tests/app.test.ts`, `src/App.vue`,
   `wrangler.jsonc`, `.env.example`, `docs/api.md`, `docs/database.md`).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues (e.g., local GitHub OAuth App registration).
5. Stop. Do not start Phase 02.

---

# 设计决策摘要（中文，供人工 review）

- **会话 Token 哈希**：32B 随机 token（Web Crypto，base64url），D1 只存 `SHA-256(token)`；本期不引入 `SESSION_SECRET`/HMAC（高熵 token 无需加盐，方案 §11 的 `SESSION_SECRET` 留给后续）。
- **Cookie 策略**：生产 https 用 `__Host-drop_session`（HttpOnly+Secure+SameSite=Lax+Path=/）；本地 `http://localhost` 下浏览器拒绝 `__Host-`（强制 Secure），自动降级为 `drop_session`。OAuth state cookie 同名规则，10 分钟过期。
- **redirect_uri 推导**：取请求 origin 拼 `/api/auth/github/callback`，开发/生产各自注册 GitHub OAuth App，一套代码两端兼容。
- **Origin 校验**：对比"请求自身 origin"而非固定 `APP_ORIGIN`（同源部署下两者恒等，且本地开发无需覆盖配置）；缺失 Origin 的状态变更请求 → 403。这是对实施方案 §15 字面写法的有意识细化，已在文档中标注。
- **测试基建**：内存 D1 fake + stub GitHub fetch，不引入 vitest-pool-workers。
- **前端**：仅 App.vue 最小登录入口，无 router/store。
- **索引取舍**：`token_hash` 的 UNIQUE 约束自带索引，实施方案 §12 的显式 `idx_sessions_token_hash` 冗余，不创建（文档已标注）。
