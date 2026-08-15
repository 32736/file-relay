<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { loadShareUrls } from '../lib/share-urls'

interface ShareItem {
  id: string
  fileId: string
  fileName: string | null
  createdAt: number
  expiresAt: number | null
  maxDownloads: number | null
  downloadCount: number
  deleteFileAfterExhausted: boolean
  revokedAt: number | null
}

const shares = ref<ShareItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const shareUrls = ref<Record<string, string>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const body = await api<{ shares: ShareItem[] }>('/api/shares')
    shares.value = body.shares
    shareUrls.value = loadShareUrls()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function copyUrl(id: string): Promise<void> {
  const url = shareUrls.value[id]
  if (!url) return
  await navigator.clipboard.writeText(url)
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1500)
}

async function revoke(id: string): Promise<void> {
  busyId.value = id
  try {
    await api(`/api/shares/${id}`, { method: 'DELETE' })
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busyId.value = null
  }
}

function stateLabel(share: ShareItem): string {
  if (share.revokedAt !== null) return '已撤销'
  if (share.expiresAt !== null && share.expiresAt <= Math.floor(Date.now() / 1000)) return '已过期'
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads
    ? '已耗尽'
    : '有效'
}

onMounted(() => void load())
defineExpose({ load })
</script>

<template>
  <section class="share-list">
    <div class="toolbar">
      <h2>分享管理</h2>
      <button
        class="ghost"
        :disabled="loading"
        @click="load"
      >
        刷新
      </button>
    </div>

    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="loading && shares.length === 0"
      role="status"
    >
      加载中…
    </p>
    <p
      v-else-if="shares.length === 0"
      class="empty"
    >
      还没有分享链接。
    </p>

    <table v-else>
      <thead>
        <tr>
          <th>文件</th>
          <th>状态</th>
          <th>下载</th>
          <th>有效期</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="share in shares"
          :key="share.id"
        >
          <td class="name">
            {{ share.fileName ?? share.fileId }}
          </td>
          <td>
            <span
              class="state"
              :class="stateLabel(share).toLowerCase()"
            >
              {{ stateLabel(share) }}
            </span>
          </td>
          <td>
            {{ share.downloadCount }}{{ share.maxDownloads !== null ? ` / ${share.maxDownloads}` : '' }}
          </td>
          <td>{{ share.expiresAt ? formatDate(share.expiresAt) : '永久' }}</td>
          <td class="actions">
            <button
              v-if="shareUrls[share.id]"
              class="ghost"
              @click="copyUrl(share.id)"
            >
              {{ copiedId === share.id ? '已复制' : '复制链接' }}
            </button>
            <button
              v-if="share.revokedAt === null"
              class="ghost danger"
              :disabled="busyId === share.id"
              @click="revoke(share.id)"
            >
              {{ busyId === share.id ? '撤销中…' : '撤销' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.toolbar h2 {
  margin: 0;
  font-size: 1.1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--border);
}
.name {
  max-width: 20rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state {
  font-size: 0.8rem;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-md);
}
.state.有效 {
  background: var(--success-soft);
  color: var(--success);
}
.state.已撤销,
.state.已过期,
.state.已耗尽 {
  background: var(--danger-soft);
  color: var(--danger);
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}
button.danger {
  color: var(--danger);
}
.empty {
  color: var(--text-muted);
}
.error {
  color: var(--danger);
}
</style>
