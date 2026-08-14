<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatBytes } from '../lib/format'

const props = defineProps<{ token: string }>()

interface ShareMeta {
  name: string
  size: number
  mimeType: string | null
  expiresAt: number | null
  remainingDownloads: number | null
}

const meta = ref<ShareMeta | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)
const done = ref(false)

async function load(): Promise<void> {
  try {
    meta.value = await api<ShareMeta>(`/api/public/shares/${props.token}`)
    error.value = null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '该分享不存在或已失效'
  }
}

async function download(): Promise<void> {
  busy.value = true
  error.value = null
  try {
    const response = await fetch(`/api/public/shares/${props.token}/download`)
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
      throw new Error(body?.error?.message ?? `下载失败（${response.status}）`)
    }
    // Trigger the browser download; the response body is the streamed file.
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = meta.value?.name ?? 'download'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    done.value = true
    setTimeout(() => (done.value = false), 3000)
    await load() // refresh remaining count
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <section
    class="share-page"
    aria-label="分享的文件"
  >
    <h1>{{ meta?.name ?? '分享' }}</h1>

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
      下载已开始
    </p>

    <template v-if="meta">
      <dl class="meta">
        <div>
          <dt>大小</dt>
          <dd>{{ formatBytes(meta.size) }}</dd>
        </div>
        <div v-if="meta.expiresAt">
          <dt>有效期至</dt>
          <dd>{{ new Date(meta.expiresAt * 1000).toLocaleString() }}</dd>
        </div>
        <div v-if="meta.remainingDownloads !== null">
          <dt>剩余下载次数</dt>
          <dd>{{ meta.remainingDownloads }}</dd>
        </div>
      </dl>

      <button
        class="download"
        :disabled="busy || (meta.remainingDownloads !== null && meta.remainingDownloads <= 0)"
        @click="download"
      >
        {{ busy ? '下载中…' : '下载文件' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.share-page {
  max-width: 30rem;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 10px;
}
.meta {
  margin: 1rem 0;
}
.meta div {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.3rem 0;
}
.meta dt {
  color: #666;
}
button {
  padding: 0.5rem 1.1rem;
  border-radius: 6px;
  border: 1px solid var(--border, #ccc);
  background: var(--accent, #3b82f6);
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.error {
  color: #dc2626;
}
.ok {
  color: #16a34a;
}
</style>
