<script setup lang="ts">
import { ref } from 'vue'

import { api } from '../lib/api'

interface UploadSession {
  uploadId: string
  mode: 'single' | 'multipart'
  chunkSize: number
  totalParts: number
}

const emit = defineEmits<{ uploaded: [] }>()

const dragging = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const progress = ref<string | null>(null)

async function uploadFile(file: File): Promise<void> {
  const session = await api<UploadSession>('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type }),
  })

  if (session.mode === 'single') {
    progress.value = `上传中 ${file.name}…`
    await fetch(`/api/uploads/${session.uploadId}/content`, { method: 'PUT', body: file })
    await api(`/api/uploads/${session.uploadId}/complete`, { method: 'POST' })
    return
  }

  // Multipart: stream slices of the file; Content-Length comes from the slice.
  for (let partNumber = 1; partNumber <= session.totalParts; partNumber++) {
    const start = (partNumber - 1) * session.chunkSize
    const end = Math.min(start + session.chunkSize, file.size)
    progress.value = `上传中 ${file.name}（${partNumber}/${session.totalParts}）…`
    const response = await fetch(`/api/uploads/${session.uploadId}/parts/${partNumber}`, {
      method: 'PUT',
      body: file.slice(start, end),
    })
    if (!response.ok) {
      throw new Error(`分片 ${partNumber} 上传失败`)
    }
  }
  progress.value = `合并中 ${file.name}…`
  await api(`/api/uploads/${session.uploadId}/complete`, { method: 'POST' })
}

async function handleFiles(files: File[]): Promise<void> {
  if (files.length === 0) return
  busy.value = true
  error.value = null
  try {
    for (const file of files) {
      await uploadFile(file)
    }
    emit('uploaded')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
    progress.value = null
  }
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  void handleFiles(files)
}

function onPick(event: Event): void {
  const files = Array.from((event.target as HTMLInputElement).files ?? [])
  void handleFiles(files)
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <section
    class="upload-zone"
    :class="{ dragging }"
  >
    <div
      class="drop-area"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p>拖放文件到这里，或</p>
      <label class="pick">
        选择文件
        <input
          type="file"
          multiple
          @change="onPick"
        >
      </label>
    </div>
    <p
      v-if="progress"
      class="progress"
      role="status"
    >
      {{ progress }}
    </p>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="busy"
      class="busy"
      role="status"
    >
      处理中…
    </p>
  </section>
</template>

<style scoped>
.upload-zone .drop-area {
  border: 2px dashed var(--border, #ccc);
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
}
.upload-zone.dragging .drop-area {
  border-color: var(--accent, #3b82f6);
  background: rgba(59, 130, 246, 0.06);
}
.pick input {
  display: none;
}
.pick {
  cursor: pointer;
  color: var(--accent, #3b82f6);
  text-decoration: underline;
}
.error {
  color: #dc2626;
}
</style>
