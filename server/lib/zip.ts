const ZIP_LOCAL_FILE_HEADER = 0x04034b50
const ZIP_DATA_DESCRIPTOR = 0x08074b50
const ZIP_CENTRAL_DIRECTORY = 0x02014b50
const ZIP_END_OF_DIRECTORY = 0x06054b50
const ZIP_UTF8_DATA_DESCRIPTOR_FLAGS = 0x0808

export interface ZipEntry {
  name: string
  expectedSize: number
  open: () => Promise<ReadableStream<Uint8Array> | Uint8Array | null>
}

interface CentralEntry {
  name: Uint8Array
  crc: number
  size: number
  offset: number
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

class Crc32 {
  private value = 0xffffffff

  update(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.value = CRC_TABLE[(this.value ^ byte) & 0xff] ^ (this.value >>> 8)
    }
  }

  digest(): number {
    return (this.value ^ 0xffffffff) >>> 0
  }
}

function asStream(body: ReadableStream<Uint8Array> | Uint8Array): ReadableStream<Uint8Array> {
  if (body instanceof Uint8Array) {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    })
  }
  return body
}

function localHeader(name: Uint8Array): Uint8Array {
  return join(
    u32(ZIP_LOCAL_FILE_HEADER),
    u16(20),
    u16(ZIP_UTF8_DATA_DESCRIPTOR_FLAGS),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(0),
    u16(name.length),
    u16(0),
    name,
  )
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  return join(u32(ZIP_DATA_DESCRIPTOR), u32(crc), u32(size), u32(size))
}

function centralHeader(entry: CentralEntry): Uint8Array {
  return join(
    u32(ZIP_CENTRAL_DIRECTORY),
    u16(20),
    u16(20),
    u16(ZIP_UTF8_DATA_DESCRIPTOR_FLAGS),
    u16(0),
    u16(0),
    u16(0),
    u32(entry.crc),
    u32(entry.size),
    u32(entry.size),
    u16(entry.name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(entry.offset),
    entry.name,
  )
}

function endOfDirectory(entryCount: number, directorySize: number, directoryOffset: number): Uint8Array {
  return join(
    u32(ZIP_END_OF_DIRECTORY),
    u16(0),
    u16(0),
    u16(entryCount),
    u16(entryCount),
    u32(directorySize),
    u32(directoryOffset),
    u16(0),
  )
}

/**
 * Creates a ZIP32 archive using the store method. File bodies are read one at
 * a time and immediately forwarded to the response stream; the Worker never
 * buffers the selected files or the completed archive in memory.
 */
export function createZipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0

      const emit = (bytes: Uint8Array): void => {
        controller.enqueue(bytes)
        offset += bytes.length
      }

      const produce = async (): Promise<void> => {
        const centralEntries: CentralEntry[] = []
        for (const entry of entries) {
          const name = encoder.encode(entry.name)
          if (name.length > 0xffff) throw new Error('ZIP entry name is too long')
          const entryOffset = offset
          emit(localHeader(name))

          const body = await entry.open()
          if (!body) throw new Error('File content is missing')
          const reader = asStream(body).getReader()
          const crc = new Crc32()
          let size = 0
          while (true) {
            const next = await reader.read()
            if (next.done) break
            if (!next.value) continue
            crc.update(next.value)
            size += next.value.byteLength
            emit(next.value)
          }
          if (size !== entry.expectedSize) throw new Error('File size changed during ZIP creation')
          emit(dataDescriptor(crc.digest(), size))
          centralEntries.push({ name, crc: crc.digest(), size, offset: entryOffset })
        }

        const directoryOffset = offset
        for (const entry of centralEntries) emit(centralHeader(entry))
        const directorySize = offset - directoryOffset
        emit(endOfDirectory(centralEntries.length, directorySize, directoryOffset))
        controller.close()
      }

      void produce().catch((error: unknown) => controller.error(error))
    },
  })
}
