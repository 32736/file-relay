<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import { toast } from '../lib/toast'
import FileTypeIcon from './FileTypeIcon.vue'
import ShareDialog from './ShareDialog.vue'

export interface FileItem {
  id: string
  name: string
  size: number
  mimeType: string | null
  createdAt: number
}

const emit = defineEmits<{ shared: []; hasfiles: [value: boolean]; changed: [] }>()

const files = ref<FileItem[]>([])
const nextCursor = ref<string | null>(null)
const query = ref('')
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const error = ref<string | null>(null)
const sharing = ref<FileItem | null>(null)
const confirming = ref<string[] | null>(null)
const undo = ref<{ ids: string[] } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

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
    emit('hasfiles', files.value.length > 0)
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

function askDelete(): void {
  const ids = [...selected.value]
  if (ids.length === 0) return
  confirming.value = ids
}

async function confirmDelete(): Promise<void> {
  const ids = confirming.value
  confirming.value = null
  if (!ids) return
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
    toast(`已删除 ${ids.length} 个文件`, 'success')
    await load(true)
    emit('changed')
  } catch (cause) {
    toast(cause instanceof Error ? cause.message : String(cause), 'error')
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
        v-if="selected.size > 0"
        class="ghost danger"
        :disabled="selected.size === 0"
        @click="askDelete"
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
    <div
      v-if="loading && files.length > 0"
      class="list-loading"
      role="status"
      aria-label="加载中"
    >
      加载中
    </div>
    <div
      v-if="loading && files.length === 0"
      class="skeleton-list"
      role="status"
      aria-label="加载中"
    >
      <div
        v-for="n in 4"
        :key="n"
        class="skeleton-row"
      >
        <span
          class="skeleton-block"
          style="width: 42%"
        />
        <span
          class="skeleton-block"
          style="width: 12%"
        />
        <span
          class="skeleton-block"
          style="width: 18%"
        />
      </div>
    </div>
    <div
      v-else-if="files.length === 0"
      class="empty"
    >
      <p>暂无文件</p>
    </div>

    <table v-else>
      <thead>
        <tr>
          <th>名称</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="file in files"
          :key="file.id"
          :class="{ selected: selected.has(file.id) }"
        >
          <td
            class="name"
            :title="file.name"
          >
            <span class="name-inner">
              <FileTypeIcon :mime="file.mimeType" />
              <span class="name-text">
                <span class="file-name">{{ file.name }}</span>
                <span class="file-meta">
                  <span>{{ formatBytes(file.size) }}</span>
                  <span>{{ formatDate(file.createdAt) }}</span>
                </span>
              </span>
            </span>
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
              class="icon-btn select-btn"
              :class="{ selected: selected.has(file.id) }"
              :title="selected.has(file.id) ? '取消选择' : '选择'"
              :aria-label="selected.has(file.id) ? `取消选择 ${file.name}` : `选择 ${file.name}`"
              :aria-pressed="selected.has(file.id)"
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
                  d="m8 12.5 2.7 2.7L16.5 9"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
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
        {{ loading ? '加载中…' : '加载更多' }}
      </button>
    </div>

    <ShareDialog
      v-if="sharing"
      :file="sharing"
      @close="sharing = null"
      @shared="emit('shared')"
    />

    <div
      v-if="confirming"
      class="confirm-overlay"
      @click.self="confirming = null"
    >
      <div
        class="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认删除"
      >
        <p class="confirm-title">
          删除 {{ confirming.length }} 个文件？
        </p>
        <p class="confirm-sub">
          删除后将无法恢复。
        </p>
        <div class="confirm-actions">
          <button
            class="btn-secondary"
            @click="confirming = null"
          >
            取消
          </button>
          <button
            class="btn-danger"
            @click="confirmDelete"
          >
            删除 {{ confirming.length }} 个文件
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* All theme surfaces use drop-* tokens so both light (newspaper print) and
   dark (CRT terminal) palettes render with consistent contrast. */
.toolbar {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.875rem;
}
.search {
  flex: 1;
  min-height: 2.75rem;
  padding: 0.5rem 0.875rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.85rem;
}
.search::placeholder { color: var(--drop-ink-3); }
.search:focus {
  outline: none;
  border: 2px solid var(--drop-brand);
  padding: calc(0.5rem - 1px) calc(0.875rem - 1px);
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  text-align: left;
  padding: 0.75rem 0.7rem;
  border-bottom: 1px solid var(--drop-line);
  color: var(--drop-ink-2);
}
th {
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: .7rem;
  font-weight: 700;
  letter-spacing: .12em;
  text-transform: uppercase;
  border-bottom: 2px solid var(--drop-ink);
  background: var(--drop-surface-2);
}
tbody tr { transition: background-color var(--drop-dur-fast) linear; }
.name {
  max-width: 30rem;
}
.file-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
  color: var(--drop-ink);
}
.file-meta {
  display: flex;
  justify-content: space-between;
  gap: .75rem;
  font-size: 0.72rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-variant-numeric: tabular-nums;
}
.file-meta span:last-child { text-align: right; white-space: nowrap; }
.file-list table {
  width: 100%;
  table-layout: fixed;
  background: var(--drop-surface);
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  overflow: hidden;
  color: var(--drop-ink-2);
}
.file-list th:last-child, .file-list td:last-child { width: 9rem; }
.file-list th { text-align: center; }
.file-list td.actions { display: table-cell; min-height: 3.6rem; vertical-align: middle; text-align: right; white-space: nowrap; }
.file-list td.actions .icon-btn { margin-left: .35rem; vertical-align: middle; }
.actions .icon-btn {
  opacity: 1;
}
tbody tr:hover .actions .icon-btn,
.actions .icon-btn:focus-visible {
  opacity: 1;
}
tbody tr:hover {
  background: var(--drop-surface-muted);
}
tbody tr.selected {
  background: color-mix(in srgb, var(--drop-brand) 16%, var(--drop-surface));
  box-shadow: inset 4px 0 0 var(--drop-brand);
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
  border: 1px solid var(--drop-line);
  border-radius: 0;
  color: var(--drop-ink-2);
  cursor: pointer;
  padding: 0;
}
.icon-btn svg {
  width: 1.05rem;
  height: 1.05rem;
}
.icon-btn:hover {
  color: var(--drop-background);
  border-color: var(--drop-ink);
  background: var(--drop-ink);
}
.icon-btn.select-btn.selected {
  color: var(--drop-background);
  border-color: var(--drop-brand);
  background: var(--drop-brand);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 4rem 1rem;
  border: 1px dashed var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink-3);
  text-align: center;
}
.empty p {
  margin: 0;
  font-family: var(--font-macro);
  font-weight: 900;
  font-size: 1.1rem;
  letter-spacing: 0.02em;
  color: var(--drop-ink);
}
.empty p::before { content: "[ "; color: var(--drop-brand); }
.empty p::after { content: " ]"; color: var(--drop-brand); }
.empty-sub {
  font-weight: 400 !important;
  color: var(--drop-ink-3) !important;
  font-size: 0.9rem;
}
.name-inner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
/* Icon centered vertically across both text lines and horizontally inside
   its own box (FileTypeIcon uses inline-grid + place-items: center). */
.name-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 1rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
}
.skeleton-row {
  display: flex;
  gap: 1rem;
  align-items: center;
  padding: 0.7rem 0.4rem;
  border-bottom: 1px solid var(--drop-line);
}
.skeleton-block {
  height: 0.85rem;
  border-radius: 0;
  background: var(--drop-surface-muted);
  animation: skeleton-blink 1.1s steps(2, start) infinite;
}
@keyframes skeleton-blink {
  50% { opacity: 0.3; }
}
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--drop-ink) 56%, transparent);
  display: grid;
  place-items: center;
  z-index: 50;
}
.confirm-dialog {
  background: var(--drop-card);
  border: 2px solid var(--drop-ink);
  border-top: 6px solid var(--drop-state-error);
  border-radius: 0;
  color: var(--drop-ink-2);
  box-shadow: var(--drop-shadow-hard);
  padding: 1.75rem 2rem;
  max-width: 22rem;
  width: 90%;
}
.confirm-title {
  margin: 0 0 0.35rem;
  font-family: var(--font-macro);
  font-weight: 900;
  font-size: 1.1rem;
  letter-spacing: -0.01em;
  color: var(--drop-ink);
}
.confirm-sub {
  margin: 0 0 1.25rem;
  color: var(--drop-ink-2);
  font-size: 0.9rem;
}
.confirm-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: flex-end;
}
.actions {
  display: flex;
  gap: 0.4rem;
}
button.ghost {
  background: var(--drop-surface);
  border: 1px solid var(--drop-ink);
  color: var(--drop-ink);
  border-radius: 0;
  padding: 0.45rem 0.875rem;
  cursor: pointer;
  font-family: var(--font-micro);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}
button.ghost:hover {
  background: var(--drop-ink);
  border-color: var(--drop-ink);
  color: var(--drop-background);
}
button.ghost:disabled {
  opacity: 0.5;
  cursor: default;
}
button.danger {
  color: var(--drop-state-error);
}
.error {
  color: var(--drop-state-error);
}
</style>
