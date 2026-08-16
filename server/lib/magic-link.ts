import type { Bindings } from '../env'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const EMAIL_AAD = encoder.encode('drop:owner-email:v1')

export const MAGIC_LINK_TTL_SECONDS = 10 * 60
export const MAGIC_LINK_RESEND_COOLDOWN_SECONDS = 60

export interface MagicLinkTokenRow {
  id: string
  token_hash: string
  github_user_id: string
  created_at: number
  expires_at: number
  consumed_at: number | null
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(secret)
  if (raw.byteLength !== 32) throw new Error('invalid email encryption key')
  return crypto.subtle.importKey('raw', asArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function encryptOwnerEmail(email: string, secret: string): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: asArrayBuffer(EMAIL_AAD) },
    await encryptionKey(secret),
    encoder.encode(normalizeEmail(email)),
  )
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptOwnerEmail(value: string, secret: string): Promise<string> {
  const [encodedIv, encodedCiphertext, extra] = value.split('.')
  if (!encodedIv || !encodedCiphertext || extra) throw new Error('invalid encrypted owner email')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asArrayBuffer(base64UrlToBytes(encodedIv)),
      additionalData: asArrayBuffer(EMAIL_AAD),
    },
    await encryptionKey(secret),
    asArrayBuffer(base64UrlToBytes(encodedCiphertext)),
  )
  return normalizeEmail(decoder.decode(plaintext))
}

export async function storeOwnerEmail(
  env: Bindings,
  githubUserId: string,
  email: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const encryptedEmail = await encryptOwnerEmail(email, env.EMAIL_ENCRYPTION_KEY)
  await env.DB.prepare(
    `INSERT OR REPLACE INTO owner_emails
      (github_user_id, encrypted_email, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(githubUserId, encryptedEmail, now, now)
    .run()
}

export async function findOwnerEmail(env: Bindings, githubUserId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT encrypted_email FROM owner_emails WHERE github_user_id = ?',
  ).bind(githubUserId).first<{ encrypted_email: string }>()
  if (!row) return null
  return decryptOwnerEmail(row.encrypted_email, env.EMAIL_ENCRYPTION_KEY)
}

export async function deleteOwnerEmail(env: Bindings, githubUserId: string): Promise<void> {
  await env.DB.prepare('DELETE FROM owner_emails WHERE github_user_id = ?').bind(githubUserId).run()
}

export async function createMagicLinkToken(
  env: Bindings,
  githubUserId: string,
  tokenHash: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  const latest = await env.DB.prepare(
    `SELECT created_at FROM magic_link_tokens
      WHERE github_user_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(githubUserId).first<{ created_at: number }>()
  if (latest && latest.created_at > now - MAGIC_LINK_RESEND_COOLDOWN_SECONDS) return false

  await env.DB.prepare(
    `INSERT INTO magic_link_tokens
      (id, token_hash, github_user_id, created_at, expires_at, consumed_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), tokenHash, githubUserId, now, now + MAGIC_LINK_TTL_SECONDS, null)
    .run()
  return true
}

export async function consumeMagicLinkToken(
  env: Bindings,
  tokenHash: string,
): Promise<MagicLinkTokenRow | null> {
  const now = Math.floor(Date.now() / 1000)
  const row = await env.DB.prepare(
    `SELECT id, token_hash, github_user_id, created_at, expires_at, consumed_at
       FROM magic_link_tokens
      WHERE token_hash = ? AND expires_at > ? AND consumed_at IS NULL`,
  ).bind(tokenHash, now).first<MagicLinkTokenRow>()
  if (!row) return null

  const consumed = await env.DB.prepare(
    `UPDATE magic_link_tokens SET consumed_at = ?
      WHERE id = ? AND expires_at > ? AND consumed_at IS NULL`,
  ).bind(now, row.id, now).run()
  return consumed.meta.changes === 1 ? row : null
}

export async function deleteMagicLinkToken(env: Bindings, tokenHash: string): Promise<void> {
  await env.DB.prepare(
    'DELETE FROM magic_link_tokens WHERE token_hash = ? AND consumed_at IS NULL',
  ).bind(tokenHash).run()
}
