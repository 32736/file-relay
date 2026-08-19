const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Generates a security token: `byteLength` cryptographically random bytes,
 * base64url encoded. Never use `Math.random()` for tokens.
 */
export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

/** SHA-256 of a UTF-8 string, hex encoded. Used to store token hashes in D1. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return bytesToHex(new Uint8Array(digest))
}

/** Constant-time string comparison for OAuth state and similar secrets. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return difference === 0
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return hex
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

async function aesGcmKey(secret: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(secret)
  if (raw.byteLength !== 32) throw new Error('invalid encryption key')
  return crypto.subtle.importKey('raw', asArrayBuffer(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/**
 * AES-GCM encryption for values that must be recoverable by the Worker but
 * never stored in plaintext (e.g. share tokens). `aad` binds the ciphertext to
 * a purpose so values encrypted for one table cannot be replayed in another.
 * Output format: `base64url(iv).base64url(ciphertext)`.
 */
export async function encryptWithSecret(
  plaintext: string,
  secret: string,
  aad: string,
): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(iv), additionalData: encoder.encode(aad) },
    await aesGcmKey(secret),
    encoder.encode(plaintext),
  )
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`
}

/** Decrypts `encryptWithSecret` output. Throws on tampering or wrong secret. */
export async function decryptWithSecret(
  value: string,
  secret: string,
  aad: string,
): Promise<string> {
  const [encodedIv, encodedCiphertext, extra] = value.split('.')
  if (!encodedIv || !encodedCiphertext || extra) throw new Error('invalid encrypted value')
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: asArrayBuffer(base64UrlToBytes(encodedIv)),
      additionalData: encoder.encode(aad),
    },
    await aesGcmKey(secret),
    asArrayBuffer(base64UrlToBytes(encodedCiphertext)),
  )
  return decoder.decode(plaintext)
}
