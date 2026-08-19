<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'

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
          <dd>{{ formatDate(meta.expiresAt) }}</dd>
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
        class="btn-primary download"
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
  max-width: 38rem;
  margin: 8vh auto 2rem;
  padding: 2.5rem;
  background: var(--drop-card);
  color: var(--drop-ink-2);
  border: 2px solid var(--drop-ink);
  border-top: 8px solid var(--drop-brand);
  border-radius: 0;
  box-shadow: var(--drop-shadow-hard);
}
.file-title {
  margin: 0 0 0.25rem;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
  line-height: 1.15;
  text-transform: uppercase;
  overflow-wrap: anywhere;
  color: var(--drop-ink);
}
.file-title::before {
  content: "/// ";
  color: var(--drop-brand);
}
.terminal {
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--drop-state-error);
  border-left: 5px solid var(--drop-state-error);
  background: color-mix(in srgb, var(--drop-state-error) 14%, var(--drop-card));
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.82rem;
}
.meta {
  margin: 1.5rem 0;
  border-top: 2px solid var(--drop-ink);
  color: var(--drop-ink-2);
}
.meta div {
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: .7rem 0;
  border-bottom: 1px solid var(--drop-line);
}
.meta dt {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.meta dd {
  margin: 0;
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
button {
  width: 100%;
  padding: 0.9rem 1.1rem;
  border-radius: 0;
  border: 2px solid var(--drop-ink);
  background: var(--drop-brand);
  color: var(--drop-background);
  cursor: pointer;
  box-shadow: var(--drop-shadow-hard-sm);
  font-family: var(--font-micro);
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
button:not(:disabled):hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--drop-ink); filter: brightness(1.08); }
button:not(:disabled):active { transform: translate(3px, 3px); box-shadow: 0 0 0 var(--drop-ink); }
button:disabled {
  opacity: 0.55;
  cursor: default;
}
.error {
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.85rem;
}
.ok {
  color: var(--drop-state-success);
  font-family: var(--font-micro);
  font-size: 0.85rem;
}
</style>
