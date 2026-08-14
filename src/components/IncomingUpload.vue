<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string
    }
  }
}

const props = defineProps<{ token: string }>()

interface IncomingMeta {
  title: string | null
  expiresAt: number
  maxFiles: number
  maxFileSize: number
  uploadedCount: number
  siteKey: string
}

interface UploadSession {
  uploadId: string
  mode: 'single' | 'multipart'
  chunkSize: number
  totalParts: number
  uploadToken: string
}

const meta = ref<IncomingMeta | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref<string | null>(null)
const widgetHost = ref<HTMLDivElement | null>(null)
const turnstileToken = ref('')
const files = ref<FileList | null>(null)

function loadTurnstileScript(): void {
  if (document.querySelector('script[src*="turnstile"]') || !window.turnstile) {
    return
  }
  const script = document.createElement('script')
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
  script.async = true
  script.defer = true
  document.head.appendChild(script)
}

function renderWidget(): void {
  if (!window.turnstile || !widgetHost.value || !meta.value) return
  window.turnstile.render(widgetHost.value, {
    sitekey: meta.value.siteKey,
    callback: (token: string) => (turnstileToken.value = token),
  })
}

async function uploadFile(file: File): Promise<void> {
  const session = await api<UploadSession>(`/api/public/incoming/${props.token}/uploads`, {
    method: 'POST',
    body: JSON.stringify({
      turnstileToken: turnstileToken.value,
      name: file.name,
      size: file.size,
      type: file.type,
    }),
  })
  const headers = { Authorization: `Bearer ${session.uploadToken}` }

  if (session.mode === 'single') {
    await fetch(`/api/public/uploads/${session.uploadId}/content`, {
      method: 'PUT',
      headers,
      body: file,
    })
    await api(`/api/public/uploads/${session.uploadId}/complete`, { method: 'POST', headers })
    return
  }

  for (let partNumber = 1; partNumber <= session.totalParts; partNumber++) {
    const start = (partNumber - 1) * session.chunkSize
    const end = Math.min(start + session.chunkSize, file.size)
    const response = await fetch(`/api/public/uploads/${session.uploadId}/parts/${partNumber}`, {
      method: 'PUT',
      headers,
      body: file.slice(start, end),
    })
    if (!response.ok) throw new Error(`分片 ${partNumber} 上传失败`)
  }
  await api(`/api/public/uploads/${session.uploadId}/complete`, { method: 'POST', headers })
}

async function submit(): Promise<void> {
  if (!files.value || files.value.length === 0) {
    error.value = '请先选择文件'
    return
  }
  if (!turnstileToken.value) {
    error.value = '请先完成人机验证'
    return
  }
  busy.value = true
  error.value = null
  done.value = null
  try {
    for (const file of Array.from(files.value)) {
      await uploadFile(file)
    }
    done.value = '上传完成，感谢！'
    turnstileToken.value = ''
    const fresh = await api<IncomingMeta>(`/api/public/incoming/${props.token}`)
    meta.value = fresh
    if (widgetHost.value) widgetHost.value.innerHTML = ''
    renderWidget()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  try {
    meta.value = await api<IncomingMeta>(`/api/public/incoming/${props.token}`)
    loadTurnstileScript()
    renderWidget()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '该上传链接无效或已过期'
  }
})
</script>

<template>
  <section
    class="incoming"
    aria-label="文件上传"
  >
    <h1>{{ meta?.title ?? '文件上传' }}</h1>
    <p
      v-if="meta"
      class="meta"
    >
      可上传 {{ meta.maxFiles - meta.uploadedCount }} 个文件，单个不超过
      {{ formatBytes(meta.maxFileSize) }}，有效期至
      {{ new Date(meta.expiresAt * 1000).toLocaleString() }}
    </p>
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="done"
      class="ok"
      role="status"
    >
      {{ done }}
    </p>

    <template v-if="meta">
      <div
        ref="widgetHost"
        class="widget"
        aria-label="人机验证"
      />
      <label class="pick">
        选择文件
        <input
          type="file"
          multiple
          @change="files = ($event.target as HTMLInputElement).files"
        >
      </label>
      <p
        v-if="files && files.length"
        class="chosen"
      >
        {{ files.length }} 个文件已选择
      </p>
      <button
        :disabled="busy || !files?.length"
        @click="submit"
      >
        {{ busy ? '上传中…' : '上传' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.incoming {
  max-width: 30rem;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 10px;
}
.meta {
  color: #555;
  font-size: 0.9rem;
}
.widget {
  margin: 1rem 0;
  min-height: 65px;
}
.pick input {
  display: none;
}
.pick {
  cursor: pointer;
  color: var(--accent, #3b82f6);
  text-decoration: underline;
}
.chosen {
  font-size: 0.85rem;
}
button {
  margin-top: 0.75rem;
  padding: 0.45rem 1rem;
  border-radius: 5px;
  border: 1px solid var(--border, #ccc);
  background: var(--accent, #3b82f6);
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.error {
  color: #dc2626;
}
.ok {
  color: #16a34a;
}
</style>
