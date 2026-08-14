<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import FilePreview from './FilePreview.vue'
import ShareDialog from './ShareDialog.vue'

export interface FileItem {
  id: string
  name: string
  size: number
  mimeType: string | null
  createdAt: number
}

const PREVIEWABLE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
])

function isPreviewable(mimeType: string | null): boolean {
  return mimeType !== null && PREVIEWABLE_TYPES.has(mimeType)
}

const emit = defineEmits<{ shared: [] }>()

const files = ref<FileItem[]>([])
const nextCursor = ref<string | null>(null)
const query = ref('')
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const error = ref<string | null>(null)
const sharing = ref<FileItem | null>(null)
const previewing = ref<FileItem | null>(null)

async function load(reset = true): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams()
    if (query.value.trim()) params.set('q', query.value.trim())
    if (!reset && nextCursor.value) params.set('cursor', nextCursor.value)
    const body = await api<{ files: FileItem[]; nextCursor: string | null }>(
      `/api/files?${params.toString()}`,
    )
    files.value = reset ? body.files : [...files.value, ...body.files]
    nextCursor.value = body.nextCursor
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(true), 250)
}

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll(): void {
  selected.value =
    selected.value.size === files.value.length
      ? new Set()
      : new Set(files.value.map((file) => file.id))
}

async function deleteSelected(): Promise<void> {
  const ids = [...selected.value]
  if (ids.length === 0) return
  try {
    await api<{ deleted: number }>('/api/files/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    selected.value = new Set()
    await load(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function download(id: string): void {
  window.location.href = `/api/files/${id}/download`
}

onMounted(() => void load(true))
defineExpose({ load })
</script>

<template>
  <section class="file-list">
    <div class="toolbar">
      <input
        v-model="query"
        class="search"
        type="search"
        placeholder="搜索文件名…"
        aria-label="搜索文件名"
        @input="onSearch"
      >
      <button
        class="ghost"
        :disabled="selected.size === 0"
        @click="deleteSelected"
      >
        删除选中（{{ selected.size }}）
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
      v-if="loading && files.length === 0"
      role="status"
    >
      加载中…
    </p>
    <p
      v-else-if="files.length === 0"
      class="empty"
    >
      还没有文件，拖放或选择文件开始上传。
    </p>

    <table v-else>
      <thead>
        <tr>
          <th>
            <input
              type="checkbox"
              aria-label="全选"
              @change="toggleAll"
            >
          </th>
          <th>名称</th>
          <th>大小</th>
          <th>上传时间</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="file in files"
          :key="file.id"
        >
          <td>
            <input
              type="checkbox"
              :checked="selected.has(file.id)"
              :aria-label="`选择 ${file.name}`"
              @change="toggle(file.id)"
            >
          </td>
          <td
            class="name"
            :title="file.name"
          >
            {{ file.name }}
          </td>
          <td>{{ formatBytes(file.size) }}</td>
          <td>{{ formatDate(file.createdAt) }}</td>
          <td class="actions">
            <button
              v-if="isPreviewable(file.mimeType)"
              class="ghost"
              @click="previewing = file"
            >
              预览
            </button>
            <button
              class="ghost"
              @click="download(file.id)"
            >
              下载
            </button>
            <button
              class="ghost"
              @click="sharing = file"
            >
              分享
            </button>
            <button
              class="ghost danger"
              @click="toggle(file.id)"
            >
              删除
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div
      v-if="nextCursor"
      class="more"
    >
      <button
        class="ghost"
        :disabled="loading"
        @click="load(false)"
      >
        加载更多
      </button>
    </div>

    <ShareDialog
      v-if="sharing"
      :file="sharing"
      @close="sharing = null"
      @shared="emit('shared')"
    />

    <FilePreview
      v-if="previewing"
      :file="previewing"
      @close="previewing = null"
    />
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
}
.search {
  flex: 1;
  padding: 0.4rem 0.6rem;
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
  max-width: 24rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  display: flex;
  gap: 0.4rem;
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border, #ccc);
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.5;
  cursor: default;
}
button.danger {
  color: #dc2626;
}
.empty {
  color: #888;
}
.error {
  color: #dc2626;
}
</style>
