<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import ShareDialog from './ShareDialog.vue'

export interface FileItem {
  id: string
  name: string
  size: number
  mimeType: string | null
  createdAt: number
}

const emit = defineEmits<{ shared: [] }>()

const files = ref<FileItem[]>([])
const nextCursor = ref<string | null>(null)
const query = ref('')
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const error = ref<string | null>(null)
const sharing = ref<FileItem | null>(null)
const selectAllRef = ref<HTMLInputElement | null>(null)
const undo = ref<{ ids: string[] } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

// Reflect partial selection so screen readers aren't lied to.
watch(
  () => selected.value.size,
  () => {
    if (selectAllRef.value) {
      selectAllRef.value.indeterminate =
        selected.value.size > 0 && selected.value.size < files.value.length
    }
  },
)

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
  if (!window.confirm(`将从 Drop 永久删除 ${ids.length} 个文件，确定？`)) return
  try {
    await api<{ deleted: number }>('/api/files/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
    selected.value = new Set()
    // Short undo window — deletion is logical, so restoring is cheap.
    undo.value = { ids }
    clearTimeout(undoTimer)
    undoTimer = setTimeout(() => (undo.value = null), 5000)
    await load(true)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function undoDelete(): Promise<void> {
  if (!undo.value) return
  const ids = undo.value.ids
  clearTimeout(undoTimer)
  undo.value = null
  try {
    await api<{ restored: number }>('/api/files/batch-restore', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    })
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
        class="ghost danger"
        :disabled="selected.size === 0"
        @click="deleteSelected"
      >
        删除选中（{{ selected.size }}）
      </button>
      <button
        v-if="undo"
        class="ghost"
        role="status"
        @click="undoDelete"
      >
        已删除 · 撤销
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
    <div
      v-else-if="files.length === 0"
      class="empty"
    >
      <svg
        class="empty-art"
        viewBox="0 0 120 72"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M14 44h52"
          stroke="var(--accent)"
          stroke-width="4"
          stroke-linecap="round"
          opacity="0.35"
        />
        <circle
          cx="88"
          cy="44"
          r="10"
          fill="var(--accent)"
        />
      </svg>
      <p>还没有文件</p>
      <p class="empty-sub">
        拖放或选择文件开始上传
      </p>
    </div>

    <table v-else>
      <thead>
        <tr>
          <th>
            <input
              ref="selectAllRef"
              type="checkbox"
              aria-label="全选"
              @change="toggleAll"
            >
          </th>
          <th>名称</th>
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
            <span class="file-name">{{ file.name }}</span>
            <span class="file-meta">{{ formatBytes(file.size) }} · {{ formatDate(file.createdAt) }}</span>
          </td>
          <td class="actions">
            <button
              class="icon-btn"
              title="下载"
              aria-label="下载"
              @click="download(file.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M12 4v11m0 0 4.5-4.5M12 15 7.5 10.5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <path
                  d="M5 19h14"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            <button
              class="icon-btn"
              title="分享"
              aria-label="分享"
              @click="sharing = file"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  cx="6"
                  cy="12"
                  r="2.4"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <circle
                  cx="17.5"
                  cy="6"
                  r="2.4"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <circle
                  cx="17.5"
                  cy="18"
                  r="2.4"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="m8.2 10.8 7-3.4m-7 5.8 7 3.4"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
            <button
              class="icon-btn"
              title="选择"
              aria-label="选择"
              @click="toggle(file.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  x="4.5"
                  y="4.5"
                  width="15"
                  height="15"
                  rx="4"
                  stroke="currentColor"
                  stroke-width="2"
                />
                <path
                  d="M12 8.5v7m-3.5-3.5h7"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
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
  border-bottom: 1px solid var(--border);
}
.name {
  max-width: 30rem;
}
.file-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--text);
}
.file-meta {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.78rem;
  color: var(--text-faint);
}
/* Actions fade in on hover/focus on desktop; always visible on touch. */
.actions .icon-btn {
  opacity: 0;
}
tbody tr:hover .actions .icon-btn,
.actions .icon-btn:focus-visible {
  opacity: 1;
}
@media (max-width: 520px) {
  .actions .icon-btn {
    opacity: 1;
  }
}
.icon-btn {
  width: 2.25rem;
  height: 2.25rem;
  display: inline-grid;
  place-items: center;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}
.icon-btn svg {
  width: 1.05rem;
  height: 1.05rem;
}
.icon-btn:hover {
  color: var(--accent-strong);
  border-color: var(--border-strong);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 3rem 1rem;
  color: var(--text-muted);
  text-align: center;
}
.empty p {
  margin: 0;
  font-weight: 600;
  color: var(--text);
}
.empty-sub {
  font-weight: 400 !important;
  color: var(--text-muted) !important;
  font-size: 0.9rem;
}
.empty-art {
  width: 7rem;
  height: auto;
  margin-bottom: 0.4rem;
}
.actions {
  display: flex;
  gap: 0.4rem;
}
tbody tr:hover {
  background: var(--surface-muted);
}
button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.25rem 0.6rem;
  cursor: pointer;
}
button.ghost:disabled {
  opacity: 0.5;
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
