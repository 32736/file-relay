# API

All API responses use JSON unless a later phase explicitly defines a streaming
file response. Errors will adopt a stable structured envelope before public
business APIs are introduced.

## Phase 00

### `GET /api/health`

Returns HTTP 200:

```json
{
  "ok": true
}
```

The endpoint is public and deliberately does not return environment variables,
resource identifiers, dependency details, or stack traces. It is a process
readiness check, not a D1 or R2 integrity check.

Unknown `/api/*` routes return a JSON 404 response. Non-API paths are handled by
Workers Static Assets and the SPA fallback.

## Phase 01

Owner-only authentication via GitHub OAuth. The service has exactly one owner,
identified by the numeric GitHub user ID in the `OWNER_GITHUB_ID` variable.

### `GET /api/auth/github`

Starts the OAuth flow. Generates a random state value, stores it in a
short-lived HttpOnly cookie, and redirects (`302`) to GitHub's authorization
endpoint. Returns `500 CONFIGURATION_ERROR` when `GITHUB_CLIENT_ID` is unset.

### `GET /api/auth/github/callback`

Validates `state` against the state cookie (constant-time comparison), exchanges
`code` for a GitHub access token, fetches the authenticated user, and checks the
numeric user ID against `OWNER_GITHUB_ID`.

- Missing or mismatched `state` → `400 INVALID_STATE`; no session is created.
- Non-owner account → `403 FORBIDDEN`; no session is created.
- GitHub upstream failure → `502 OAUTH_UPSTREAM_ERROR`.
- Success → creates a session (only the token hash is stored in D1), sets the
  session cookie, and redirects to the application root.

### `GET /api/auth/me`

- Valid session → `200` with `{ "authenticated": true, "githubUserId": "..." }`.
- Missing, invalid, or expired session → `401 UNAUTHORIZED` (expired rows are
  lazily deleted).

### `POST /api/auth/logout`

Requires a matching `Origin` header: cross-origin or missing-Origin requests
are rejected with `403 FORBIDDEN`. Deletes the session and clears the cookie.
Idempotent — `204 No Content` even without a session.

### Session cookie

`__Host-drop_session` (HttpOnly, Secure, SameSite=Lax, Path=/). Local
development over `http://localhost` uses `drop_session` because browsers reject
`__Host-` cookies without the Secure attribute.

## Future phases

- Phases 02-03: upload session and single/multipart upload endpoints.
- Phase 04: owner streaming and range downloads.
- Phase 05: owner share management and public share downloads.
- Phase 06: scheduled cleanup, with no public route required.
