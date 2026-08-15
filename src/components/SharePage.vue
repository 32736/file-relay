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
  // Native streaming download: the server sends Content-Disposition +
  // Content-Length, so the browser writes the file to disk instead of the
  // previous blob() full-buffer (which OOM'd phones on large files).
  window.location.href = `/api/public/shares/${props.token}/download`
  busy.value = true
  setTimeout(async () => {
    busy.value = false
    done.value = true
    setTimeout(() => (done.value = false), 3000)
    await load() // refresh remaining count after the claim
  }, 1200)
}

function terminalReason(): string | null {
  if (!meta.value) return null
  if (meta.value.expiresAt !== null && meta.value.expiresAt <= Math.floor(Date.now() / 1000)) {
    return '此分享已过期'
  }
  if (meta.value.remainingDownloads !== null && meta.value.remainingDownloads <= 0) {
    return '此分享的下载次数已用完'
  }
  return null
}

onMounted(() => void load())
</script>

<template>
  <section
    class="share-page"
    aria-label="分享的文件"
  >
    <h1 class="file-title">
      {{ meta?.name ?? '分享' }}
    </h1>

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

    <p
      v-if="!meta && !error"
      role="status"
    >
      加载中…
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

      <p
        v-if="terminalReason()"
        class="terminal"
        role="alert"
      >
        {{ terminalReason() }}，请联系发送者重新分享。
      </p>
      <button
        v-else
        class="download"
        :disabled="busy"
        @click="download"
      >
        {{ busy ? '下载已开始' : '下载文件' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.share-page {
  max-width: 30rem;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.file-title {
  margin: 0 0 0.25rem;
  font-size: 1.4rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.terminal {
  color: var(--danger);
  font-size: 0.9rem;
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
  color: var(--text-muted);
}
button {
  padding: 0.5rem 1.1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.error {
  color: var(--danger);
}
.ok {
  color: var(--success);
}
</style>
