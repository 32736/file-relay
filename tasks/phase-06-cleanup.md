# Phase 06 - Cleanup

## Goal

Add the scheduled, bounded cleanup pass that completes the MVP: expired
sessions, stale upload sessions (aborting their R2 multiparts), logically
deleted files (physical R2 removal), expired files, exhausted
burn-after-reading files, and revoked/expired shares. Wire the Worker's
`scheduled` handler and the hourly cron trigger.

## Read Before Work

- `AGENTS.md`
- `docs/architecture.md`
- `docs/cloudflare.md`
- `docs/database.md`
- `docs/cloudflare_private_file_drop_codex_implementation_plan.md`
  (§10 crons trigger, §24 aborted multiparts, §26 logical-delete cleanup,
  §34 burn-after-reading safety window, §35 cron task list, §45 Worker entry,
  §57 phase scope)

## Scope

- `server/services/cleanup.ts`: `runCleanup(env)` with bounded tasks
  (50 rows each) so no task scans the whole database.
- Worker entry: `scheduled` handler (`ctx.waitUntil(runCleanup(env))`).
- `wrangler.jsonc`: `triggers.crons: ["17 * * * *"]`.
- Cleanup test matrix against the fakes.
- Documentation sync (`docs/cloudflare.md`, `docs/database.md` if needed).

## Out of Scope

- Storage statistics.
- Any cleanup behavior beyond the listed tasks; no new public routes.
- Production deployment or remote migration application (explicit approval).

## Existing Constraints

- Bounded batches (50–100 per plan §35); never unindexed full-table scans.
- Physical R2 deletion only after a logical `deleted_at` marker or a safety
  window; never delete bytes inline during a download (Phase 05).
- Multipart aborts resume from `r2_upload_id` and are best-effort (the DB
  rows are cleaned regardless).
- All cleanup is idempotent; timestamps are epoch seconds.

## Design Decisions (confirmed)

1. **Task order matters.** Runs in this order so downstream tasks see upstream
   effects:
   1. expired `sessions`;
   2. stale `upload_sessions` (`created`/`uploading`, expired) — abort R2
      multipart, delete `upload_parts`, delete the session row;
   3. exhausted burn-after-reading files — shares with
      `delete_file_after_exhausted = 1`, `download_count >= max_downloads`,
      `last_download_at` older than a 1-hour safety window → logical file
      deletion;
   4. expired files (`expires_at <= now`, not deleted) → logical deletion;
   5. logically deleted files (`deleted_at` set) → delete the R2 object, then
      delete the row;
   6. revoked or expired `shares` rows → delete.
2. **Two-phase file deletion.** Step 5 performs physical removal only for rows
   already logically deleted (by owner action, expiry, or burn); a crash
   between R2 delete and D1 delete is retried next run (the row still has
   `deleted_at` and the R2 delete is idempotent).
3. **Burn-after-reading safety window (plan §34).** Files are only logically
   deleted after `last_download_at` is older than `BURN_SAFETY_WINDOW_SECONDS`
   (3600), so the final streaming download cannot race the deletion.
4. **Multipart abort is best-effort.** If `resumeMultipartUpload`/`abort`
   throws (already aborted/expired upload), rows are still removed; orphaned
   R2 multiparts are cleaned by R2's own lifecycle.
5. **Bounded batches.** Every task processes at most `CLEANUP_BATCH_SIZE = 50`
   rows per run and stops; the cron fires hourly so all backlog drains over
   successive runs.
6. **`scheduled` handler wiring (plan §45).** The default export becomes
   `{ fetch: app.fetch, scheduled }` (`satisfies ExportedHandler<Bindings>`);
   `scheduled` runs `ctx.waitUntil(runCleanup(env))`. The hourly cron trigger
   is declared in `wrangler.jsonc`.

## Implementation

### `server/services/cleanup.ts`

`runCleanup(env)` runs the six tasks above, each a bounded loop:

```ts
const BATCH_SIZE = 50
const BURN_SAFETY_WINDOW_SECONDS = 60 * 60

async function cleanupExpiredSessions(env, now) {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ? LIMIT ?')
    .bind(now, BATCH_SIZE).run()
}

async function cleanupStaleUploadSessions(env, now) {
  const rows = await env.DB.prepare(
    `SELECT id, object_key, mode, r2_upload_id FROM upload_sessions
     WHERE status IN ('created', 'uploading') AND expires_at <= ?
     LIMIT ?`).bind(now, BATCH_SIZE).all()
  for (const row of rows.results) {
    if (row.mode === 'multipart' && row.r2_upload_id) {
      try {
        const m = env.BUCKET.resumeMultipartUpload(row.object_key, row.r2_upload_id)
        await m.abort()
      } catch { /* best-effort */ }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM upload_parts WHERE upload_session_id = ?').bind(row.id),
      env.DB.prepare('DELETE FROM upload_sessions WHERE id = ?').bind(row.id),
    ])
  }
}

async function cleanupBurnFiles(env, now) {
  const cutoff = now - BURN_SAFETY_WINDOW_SECONDS
  const rows = await env.DB.prepare(
    `SELECT s.file_id FROM shares s
     WHERE s.delete_file_after_exhausted = 1
       AND s.max_downloads IS NOT NULL
       AND s.download_count >= s.max_downloads
       AND s.last_download_at IS NOT NULL AND s.last_download_at <= ?
       AND s.revoked_at IS NULL
     LIMIT ?`).bind(cutoff, BATCH_SIZE).all()
  for (const row of rows.results) {
    await env.DB.prepare(
      'UPDATE files SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL'
    ).bind(now, row.file_id).run()
  }
}

async function cleanupExpiredFiles(env, now) {
  await env.DB.prepare(
    `UPDATE files SET deleted_at = ?
     WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?
     LIMIT ?`).bind(now, now, BATCH_SIZE).run()
}

async function cleanupDeletedFiles(env) {
  const rows = await env.DB.prepare(
    'SELECT id, object_key FROM files WHERE deleted_at IS NOT NULL LIMIT ?'
  ).bind(BATCH_SIZE).all()
  for (const row of rows.results) {
    try { await env.BUCKET.delete(row.object_key) } catch { /* retry next run */ }
    await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(row.id).run()
  }
}

async function cleanupShares(env, now) {
  await env.DB.prepare(
    `DELETE FROM shares
     WHERE revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= ?)
     LIMIT ?`).bind(now, BATCH_SIZE).run()
}
```

### Worker entry (`server/index.ts`)

```ts
export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCleanup(env))
  },
} satisfies ExportedHandler<Bindings>
```

### `wrangler.jsonc`

```jsonc
"triggers": { "crons": ["17 * * * *"] }
```

## Tests

Harness: reuse `D1Fake` + `R2Fake`; seed rows directly, call `runCleanup(env)`,
assert effects. Note the fakes do not support `DELETE ... LIMIT` — the cleanup
SQL uses `LIMIT ?` on D1; the fakes are extended to parse and apply
`DELETE ... LIMIT n` and `UPDATE ... LIMIT n` (take the first n matching rows).

Matrix (maps to plan §35/§57 and acceptance criteria):

1. Expired sessions are deleted; live sessions survive.
2. Stale `upload_sessions` (expired, `created`/`uploading`): R2 multipart
   abort invoked, `upload_parts` and the session row removed; a live session
   survives untouched.
3. Burn-after-reading: exhausted share older than the safety window → file
   logically deleted; exhausted share *inside* the safety window → untouched;
   non-exhausted share → untouched.
4. Expired files (`expires_at <= now`) → `deleted_at` set; unexpired files
   untouched.
5. Logically deleted files → R2 object removed and row deleted; live files
   untouched.
6. Revoked and expired shares rows are deleted; active shares survive.
7. Batch bounds: seeding more than `BATCH_SIZE` expired sessions/files deletes
   at most `BATCH_SIZE` per run (second run drains the rest).
8. Idempotency: a second `runCleanup` call changes nothing further.
9. `scheduled` handler wiring: exporting the worker object with a `fetch` and
   `scheduled` (type-checked); the cron trigger is present in `wrangler.jsonc`.

## Acceptance Criteria

- A single `runCleanup` pass cleans each class of stale data without touching
  live data, bounded per task.
- The Worker entry exposes `fetch` + `scheduled`; the hourly cron is declared.
- All required commands pass.

## Required Commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Completion

1. Summarize changed files (expected: `server/services/cleanup.ts`,
   `server/index.ts`, `wrangler.jsonc`, `tests/helpers/d1-fake.ts`,
   `tests/server/cleanup.test.ts`, `docs/cloudflare.md`).
2. State key design decisions and any deviation from the implementation plan.
3. Report validation command results.
4. Report unresolved issues.
5. Stop at the MVP review boundary. Do not start Phase 07.

---

# 设计决策摘要（中文，供人工 review）

- **任务顺序**：sessions → 过期 upload_sessions（abort multipart + 清 parts + 删行）→ 阅后即焚耗尽文件（安全窗口 1 小时后逻辑删除）→ 过期文件（逻辑删除）→ 已逻辑删除文件（R2 物理删除 + 删行）→ 已撤销/过期 shares 行。
- **两阶段删除**：物理删除只对已有 `deleted_at` 的行执行；R2 删除与 D1 删除之间崩溃 → 下一轮重试（R2 delete 幂等）。
- **阅后即焚安全窗口**（方案 §34）：`last_download_at` 距今 > 1 小时才逻辑删除，避免与最后一次下载竞争。
- **multipart abort 尽力而为**：abort 抛错不影响行清理（R2 侧孤儿 multipart 由 R2 生命周期兜底）。
- **每任务批量 ≤ 50**（方案 §35），cron 每小时一次，积压多轮排空。
- **Worker 入口**：default export 改为 `{ fetch: app.fetch, scheduled }`（方案 §45），`wrangler.jsonc` 声明 `17 * * * *`。
- fake 需扩展 `DELETE/UPDATE ... LIMIT` 支持（D1 支持 LIMIT 于 DELETE/UPDATE）。
