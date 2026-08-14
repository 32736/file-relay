// An in-memory R2Bucket-shaped fake covering `put` / `get` / `head` / `delete`.
// It consumes ReadableStream bodies, which doubles as a guard that uploads are
// streamed rather than buffered by the caller. Tests cast it to R2Bucket.

export interface StoredObject {
  key: string
  size: number
  etag: string
  contentType: string | null
  body: Uint8Array
}

async function consumeBody(
  value: ReadableStream | ArrayBuffer | string | null,
): Promise<Uint8Array> {
  if (value === null) return new Uint8Array(0)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)

  const reader = value.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value: chunk } = await reader.read()
    if (done) break
    chunks.push(chunk as Uint8Array)
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged
}

export class R2Fake {
  private objects = new Map<string, StoredObject>()
  private etagCounter = 0

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<StoredObject> {
    const body = await consumeBody(value)
    const object: StoredObject = {
      key,
      size: body.byteLength,
      etag: `fake-etag-${++this.etagCounter}`,
      contentType: options?.httpMetadata?.contentType ?? null,
      body,
    }
    this.objects.set(key, object)
    return object
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  /** Test helper: all object keys currently in the bucket. */
  keys(): string[] {
    return [...this.objects.keys()]
  }

  /** Test helper: a stored object by key. */
  object(key: string): StoredObject | null {
    return this.objects.get(key) ?? null
  }
}
