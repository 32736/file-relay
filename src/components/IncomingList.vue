<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatDate } from '../lib/format'

interface IncomingItem {
  id: string
  title: string | null
  createdAt: number
  expiresAt: number
  maxFiles: number
  maxFileSize: number
  uploadedCount: number
  revokedAt: number | null
}

const requests = ref<IncomingItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const busyId = ref<string | null>(null)
const copied = ref(false)

const title = ref('')
const expiresHours = ref(24)
const maxFiles = ref(5)
const maxFileSizeMb = ref(100)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const body = await api<{ requests: IncomingItem[] }>('/api/incoming-requests')
    requests.value = body.requests
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

async function create(): Promise<void> {
  error.value = null
  try {
    const result = await api<{ url: string }>('/api/incoming-requests', {
      method: 'POST',
      body: JSON.stringify({
        title: title.value || null,
        expiresIn: Math.max(1, expiresHours.value) * 3600,
        maxFiles: Math.min(100, Math.max(1, maxFiles.value)),
        maxFileSize: Math.max(1, maxFileSizeMb.value) * 1024 * 1024,
      }),
    })
    await navigator.clipboard.writeText(result.url)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function revoke(id: string): Promise<void> {
  busyId.value = id
  try {
    await api(`/api/incoming-requests/${id}`, { method: 'DELETE' })
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busyId.value = null
  }
}

function stateLabel(item: IncomingItem): string {
  if (item.revokedAt !== null) return '已撤销'
  if (item.expiresAt <= Math.floor(Date.now() / 1000)) return '已过期'
  return '有效'
}

onMounted(() => void load())
</script>

<template>
  <section class="incoming-list">
    <div class="toolbar">
      <h2>上传请求</h2>
      <button
        class="ghost"
        :disabled="loading"
        @click="load"
      >
        刷新
      </button>
    </div>

    <form
      class="create"
      @submit.prevent="create"
    >
      <label>
        标题
        <input
          v-model="title"
          type="text"
          maxlength="200"
          placeholder="（可选）给我发文件"
        >
      </label>
      <label>
        有效期（小时）
        <input
          v-model.number="expiresHours"
          type="number"
          min="1"
        >
      </label>
      <label>
        最多文件数
        <input
          v-model.number="maxFiles"
          type="number"
          min="1"
          max="100"
        >
      </label>
      <label>
        单文件上限（MB）
        <input
          v-model.number="maxFileSizeMb"
          type="number"
          min="1"
        >
      </label>
      <button
        type="submit"
        class="primary"
      >
        创建并复制链接
      </button>
    </form>
    <p
      v-if="copied"
      class="ok"
      role="status"
    >
      链接已复制到剪贴板
    </p>

    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>
    <p
      v-if="requests.length === 0 && !loading"
      class="empty"
    >
      还没有上传请求。
    </p>

    <table v-if="requests.length">
      <thead>
        <tr>
          <th>标题</th>
          <th>状态</th>
          <th>已收</th>
          <th>有效期</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in requests"
          :key="item.id"
        >
          <td class="name">
            {{ item.title ?? '（无标题）' }}
          </td>
          <td>
            <span
              class="state"
              :class="stateLabel(item)"
            >
              {{ stateLabel(item) }}
            </span>
          </td>
          <td>{{ item.uploadedCount }} / {{ item.maxFiles }}</td>
          <td>{{ formatDate(item.expiresAt) }}</td>
          <td class="actions">
            <button
              v-if="item.revokedAt === null"
              class="ghost danger"
              :disabled="busyId === item.id"
              @click="revoke(item.id)"
            >
              {{ busyId === item.id ? '撤销中…' : '撤销' }}
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
.create {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr auto;
  gap: 0.6rem;
  align-items: end;
  margin-bottom: 0.5rem;
}
.create label {
  font-size: 0.8rem;
  color: #666;
}
.create input {
  display: block;
  width: 100%;
  margin-top: 0.2rem;
  padding: 0.35rem 0.5rem;
}
.create .primary {
  padding: 0.45rem 0.8rem;
  border-radius: 5px;
  border: 1px solid var(--accent, #3b82f6);
  background: var(--accent, #3b82f6);
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.45rem 0.6rem;
  border-bottom: 1px solid var(--border, #eee);
}
.name {
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state {
  font-size: 0.8rem;
  padding: 0.1rem 0.45rem;
  border-radius: 10px;
}
.state.有效 {
  background: #dcfce7;
  color: #166534;
}
.state.已撤销,
.state.已过期 {
  background: #fee2e2;
  color: #991b1b;
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border, #ccc);
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}
button.danger {
  color: #dc2626;
}
.ok {
  color: #16a34a;
}
.empty {
  color: #888;
}
.error {
  color: #dc2626;
}
@media (max-width: 720px) {
  .create {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
