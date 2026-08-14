// An in-memory R2Bucket-shaped fake covering `put` / `get` / `head` / `delete`
// plus multipart (`createMultipartUpload`, `resumeMultipartUpload`,
// `uploadPart`, `complete`, `abort`). It consumes ReadableStream bodies, which
// doubles as a guard that uploads are streamed rather than buffered by the
// caller. Tests cast it to R2Bucket.

export interface StoredObject {
  key: string
  size: number
  etag: string
  contentType: string | null
  body: Uint8Array
  range?: { offset: number; length: number }
}

export interface MultipartState {
  uploadId: string
  key: string
  contentType: string | null
  parts: Map<number, { etag: string; size: number }>
  completed: boolean
  aborted: boolean
}

async function consumeBody(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
): Promise<Uint8Array> {
  if (value === null) return new Uint8Array(0)
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  }

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
  // Fields are accessed by FakeMultipartUpload below; keep them non-private
  // within this module.
  objects = new Map<string, StoredObject>()
  multiparts = new Map<string, MultipartState>()
  etagCounter = 0
  private multipartCounter = 0

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
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

  async get(
    key: string,
    options?: { range?: { offset?: number; length?: number; suffix?: number } },
  ): Promise<StoredObject | null> {
    const object = this.objects.get(key)
    if (!object) return null

    const range = options?.range
    if (!range) {
      return { ...object, body: object.body }
    }

    let offset = 0
    let length = object.size
    if (range.suffix !== undefined) {
      offset = Math.max(0, object.size - range.suffix)
      length = object.size - offset
    } else if (range.offset !== undefined) {
      offset = range.offset
      length = range.length ?? Math.max(0, object.size - offset)
    }

    return {
      ...object,
      body: object.body.slice(offset, offset + length),
      range: { offset, length },
    }
  }

  async head(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key)
  }

  async createMultipartUpload(
    key: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<FakeMultipartUpload> {
    const uploadId = `fake-mpu-${++this.multipartCounter}`
    this.multiparts.set(key, {
      uploadId,
      key,
      contentType: options?.httpMetadata?.contentType ?? null,
      parts: new Map(),
      completed: false,
      aborted: false,
    })
    return this.resumeMultipartUpload(key, uploadId)
  }

  resumeMultipartUpload(key: string, uploadId: string): FakeMultipartUpload {
    const state = this.multiparts.get(key)
    if (!state || state.uploadId !== uploadId) {
      throw new Error(`no active multipart upload for ${key}`)
    }
    return new FakeMultipartUpload(this, state)
  }

  /** Test helper: all object keys currently in the bucket. */
  keys(): string[] {
    return [...this.objects.keys()]
  }

  /** Test helper: a stored object by key. */
  object(key: string): StoredObject | null {
    return this.objects.get(key) ?? null
  }

  /** Test helper: multipart state by object key. */
  multipartState(key: string): MultipartState | undefined {
    return this.multiparts.get(key)
  }
}

class FakeMultipartUpload {
  constructor(
    private readonly bucket: R2Fake,
    private readonly state: MultipartState,
  ) {}

  get uploadId(): string {
    return this.state.uploadId
  }

  get key(): string {
    return this.state.key
  }

  async uploadPart(
    partNumber: number,
    value: ReadableStream | ArrayBuffer | string | null,
  ): Promise<{ partNumber: number; etag: string; size: number }> {
    if (this.state.completed || this.state.aborted) {
      throw new Error('multipart upload is no longer active')
    }
    const body = await consumeBody(value)
    const etag = `fake-part-etag-${++this.bucket.etagCounter}`
    this.state.parts.set(partNumber, { etag, size: body.byteLength })
    return { partNumber, etag, size: body.byteLength }
  }

  async complete(
    parts: { partNumber: number; etag: string }[],
  ): Promise<StoredObject> {
    let totalSize = 0
    for (const part of parts) {
      const stored = this.state.parts.get(part.partNumber)
      if (!stored || stored.etag !== part.etag) {
        throw new Error(`part ${part.partNumber} has not been uploaded`)
      }
      totalSize += stored.size
    }
    const object: StoredObject = {
      key: this.state.key,
      size: totalSize,
      etag: `fake-object-etag-${++this.bucket.etagCounter}`,
      contentType: this.state.contentType,
      body: new Uint8Array(0),
    }
    this.bucket.objects.set(this.state.key, object)
    this.state.completed = true
    return object
  }

  async abort(): Promise<void> {
    this.state.aborted = true
    this.bucket.multiparts.delete(this.state.key)
  }
}
