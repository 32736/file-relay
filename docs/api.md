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

## Future phases

- Phase 01: GitHub OAuth and owner session endpoints.
- Phases 02-03: upload session and single/multipart upload endpoints.
- Phase 04: owner streaming and range downloads.
- Phase 05: owner share management and public share downloads.
- Phase 06: scheduled cleanup, with no public route required.
