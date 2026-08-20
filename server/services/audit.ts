import type { Bindings } from '../env'

export interface AuditEvent {
  actorGithubId?: string | null
  action: string
  targetType: string
  targetId?: string | null
  metadata?: Record<string, boolean | number | string | null>
}

/**
 * Audit writes are deliberately best-effort: a logging outage must not turn a
 * successful file operation into a user-visible failure. The event payload
 * never accepts raw credentials or share tokens.
 */
export async function recordAudit(env: Bindings, event: AuditEvent): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_logs
       (id, actor_github_id, action, target_type, target_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        event.actorGithubId ?? null,
        event.action,
        event.targetType,
        event.targetId ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        Math.floor(Date.now() / 1000),
      )
      .run()
  } catch {
    // Do not expose audit storage failures to the caller and never log event
    // payloads, which may contain user-controlled filenames.
  }
}
