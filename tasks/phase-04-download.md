# Phase 04 - Download

## Goal

Add owner-only streaming downloads with safe `Content-Disposition`, and
R2-backed HTTP Range handling (`200` full, `206` partial, `416` unsatisfiable).
Extract a reusable download-response builder so Phase 05's public share
downloads stream through the same code path, and document how range requests
interact with share download counting.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/cloudflare.md`
- `docs/api.md`

## Scope

- `GET /api/files/:id/download` (owner, streaming, Range-aware).
- `server/lib/download.ts`: `parseRange`, `contentDisposition` (CR/LF-safe,
  RFC 5987 `filename*`), and `buildDownloadResponse` (shared by Phase 05).
- R2 fake range support; download test matrix.
- Documentation sync (`docs/api.md`); no schema changes this phase.

## Out of Scope

- Public share downloads (`/api/public/shares/:token/download`, Phase 05).
- Download counting, share sessions, atomic claims (Phase 05).
- Scheduled cleanup of downloaded/expired files (Phase 06).
- Front-end download UI.

## Existing Constraints

- Downloads stream: `BUCKET.get(key, { range })` → response body stream. Never
  `object.arrayBuffer()`.
- The Worker is the only authorization boundary; owner downloads require
  `requireAuth`.
- R2 object keys never contain original filenames; filenames are metadata.
- User-controlled filenames must not inject response headers (strip CR/LF) or
  HTML; HTML/SVG never render inline on the application origin.
- Downloads default to `attachment` with `nosniff`.

## Design Decisions (confirmed)

1. **Route: `GET /api/files/:id/download`** (owner-only). The implementation
   plan's route table (plan §44) does not name an owner download route; this
   phase defines it, alongside Phase 05's public
   `/api/public/shares/:token/download`.
2. **Single-range only.** Only `bytes=start-end`, `bytes=start-`, and
   `bytes=-suffix` are supported (R2's range model). Multi-range requests →
   `416` with `Content-Range: bytes */size`.
3. **R2-backed ranges (plan §32).** Parse the `Range` header server-side, pass
   `{ range: { offset, length } }` or `{ range: { suffix } }` to `BUCKET.get`,
   and derive response headers from the returned `R2Object.range`. Responses:
   - no `Range` → `200`, `Content-Length: size`, `Accept-Ranges: bytes`;
   - valid range → `206`, `Content-Length: length`,
     `Content-Range: bytes <start>-<end>/<size>`;
   - unsatisfiable (start ≥ size, start > end, suffix 0, malformed, multi) →
     `416` + `Content-Range: bytes */size`.
4. **Safe `Content-Disposition` (plan §40) via a shared helper.** Strip CR/LF
   and control characters; emit an ASCII `filename="..."` fallback (quotes and
   backslashes escaped) plus RFC 5987 `filename*=UTF-8''<percent-encoded>` for
   non-ASCII names (中文/emoji). Phase 04 always uses `attachment`.
5. **`buildDownloadResponse(object, filename, mimeType)` is the shared
   pipeline** for owner and (Phase 05) public downloads: it attaches
   `Content-Type`, `Content-Disposition`, `X-Content-Type-Options: nosniff`,
   `Accept-Ranges: bytes`, and the size/range headers, and streams the body.
   It deliberately contains no authorization or counting logic.
6. **Range × share counting interaction (required by the task).** Share
   download counting (Phase 05, atomic UPDATE per plan §30) will increment per
   download *request*; a range request is one request. This means a resumable
   client issuing several range requests consumes several counts. Documented
   and accepted for MVP (shares are short-lived links; the phase 05 design
   decides whether only requests starting at offset 0 count). `buildDownloadResponse`
   keeps counting out of the pipeline so Phase 05 can claim before streaming.
7. **Deleted files are invisible to downloads.** `GET /api/files/:id/download`
   resolves the file via the same non-deleted lookup as listing/detail → `404`
   for missing or logically deleted files.

## API Changes

### `GET /api/files/:id/download`

- Owner-only (`requireAuth`).
- Missing or logically deleted file → `404 NOT_FOUND`.
- Success streams from R2 with `200` or `206` as above.
- `Content-Type`: stored `mime_type` or `application/octet-stream`.
- `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`.
- Unsatisfiable range → `416` (no body stream).

## Tests

Harness: extend `tests/helpers/r2-fake.ts` `get(key, options?)` to honor
`{ range: { offset, length } }` / `{ range: { suffix } }` and return range
metadata like real R2 (`R2Object.range`), plus a `body` stream.

Matrix (maps to plan §55/§69 and acceptance criteria):

1. Unauthenticated download → `401`.
2. Missing / logically deleted file → `404`.
3. Full download: `200`, body equals stored bytes, `Content-Length: size`,
   `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, correct
   `Content-Type` and attachment disposition.
4. Range `bytes=0-99` → `206`, `Content-Range: bytes 0-99/<size>`,
   `Content-Length: 100`, body is the slice.
5. Range `bytes=100-` → `206`, correct open-ended slice.
6. Range `bytes=-500` (suffix) → `206`, last 500 bytes.
7. Unsatisfiable ranges: `start ≥ size`, `start > end`, `bytes=0-0` when
   empty (not reachable; size ≥ 1), malformed header, multi-range → `416` +
   `Content-Range: bytes */size`.
8. Filename safety: a name with CR/LF (`evil\r\nX-Injected: 1.txt`) produces a
   single-line disposition header with no injection; a name with quotes is
   escaped in `filename`; a 中文/emoji name yields a valid
   `filename*=UTF-8''...` percent-encoded value (no raw non-ASCII in headers).
9. Shared pipeline: `buildDownloadResponse` produces identical headers for
   owner and (future) public paths — asserted via a direct unit test of the
   helper.
10. Streaming guard: the response body is a stream backed by the R2 object body
    (no full-object buffering asserted through the fake).

## Acceptance Criteria

- Owner downloads of 1 KB / 5 MiB / 31 MiB files stream correctly (Phase 02
  fixtures), including a 33 MiB multipart upload (Phase 03 fixture).
- `200` / `206` / `416` and `Content-Range` behave per RFC 7233 for the tested
  ranges; resume works (`bytes=100-` after an interrupted download).
- Chinese filenames download with correct UTF-8 `filename*`; header injection
  is impossible.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

1. Summarize changed files (expected: `server/routes/files.ts` (+ download
   route), `server/lib/download.ts`, `tests/helpers/r2-fake.ts`,
   `tests/server/files.test.ts`, `docs/api.md`).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues.
5. Stop. Do not start Phase 05.

---

# 设计决策摘要（中文，供人工 review）

- **Owner 下载路由**：`GET /api/files/:id/download`（实施方案 §44 未列 owner 下载路由，本阶段定义；公开分享下载 `/api/public/shares/:token/download` 归 Phase 05）。
- **仅支持单 Range**（R2 的 range 模型）：`bytes=start-end` / `start-` / `-suffix`；多段/非法 → 416 + `Content-Range: bytes */size`。
- **R2 原生 Range（方案 §32）**：解析请求头 → `BUCKET.get(key, {range})` → 用返回的 `R2Object.range` 组装 206/Content-Range，全程流式、绝不 `arrayBuffer()`。
- **共享下载管线 `buildDownloadResponse`**：统一挂 Content-Type / Content-Disposition / nosniff / Accept-Ranges / 长度头并流式 body；**不含鉴权与计数逻辑**，Phase 05 公开下载直接复用，计数在流式前由 Phase 05 原子 claim。
- **文件名安全（方案 §40）**：剥离 CR/LF 与控制字符；ASCII `filename="..."`（转义引号/反斜杠）+ RFC 5987 `filename*=UTF-8''...`（百分号编码，中文/emoji 安全）；Phase 04 一律 `attachment`。
- **Range × 分享计数交互（任务书要求）**：Phase 05 计数按"每次下载请求"原子 +1（方案 §30）；断点续传多段 Range 会消耗多次计数——MVP 接受并文档化，Phase 05 再定是否只对 offset 0 起请求计数。
- **已删除文件对下载不可见**：与列表/详情同一非删除查询 → 404。
- 本期无 schema 变更；预览白名单留 Phase 07。
