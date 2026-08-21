<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { api, getUserErrorMessage, localizeErrorMessage } from '../lib/api'
import { COPY, formatFileRetention } from '../lib/copy'
import { formatBytes, formatDate } from '../lib/format'
import { buildPaginationItems } from '../lib/pagination'
import { toast } from '../lib/toast'
import FileExpirationDialog from './FileExpirationDialog.vue'
import FileTypeIcon from './FileTypeIcon.vue'
import ShareDialog from './ShareDialog.vue'

export interface FileItem {
  id: string
  name: string
  size: number
  mimeType: string | null
  createdAt: number
  expiresAt?: number | null
}

const emit = defineEmits<{ shared: []; hasfiles: [value: boolean]; changed: [] }>()

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const files = ref<FileItem[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const page = ref(1)
const pageCursors = ref<Array<string | null>>([null])
const pageSize = ref<number>(PAGE_SIZE_OPTIONS[0])
const jumpPage = ref('')
const query = ref('')
const selected = ref<Set<string>>(new Set())
const loading = ref(false)
const error = ref<string | null>(null)
const sharing = ref<FileItem | null>(null)
const expiration = ref<FileItem | null>(null)
const confirming = ref<string[] | null>(null)
const zipBusy = ref(false)
const confirmDialog = ref<HTMLDialogElement | null>(null)
const deleteTrigger = ref<HTMLElement | null>(null)
const undo = ref<{ ids: string[] } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const paginationItems = computed(() => buildPaginationItems(page.value, pageCount.value))

async function loadPage(targetPage: number): Promise<void> {
  if (loading.value) return
  const cursor = targetPage > 1
    ? pageCursors.value[targetPage - 1] ?? String((targetPage - 1) * pageSize.value)
    : null
  if (targetPage > 1 && !cursor) return

  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams()
    params.set('limit', String(pageSize.value))
    if (query.value.trim()) params.set('q', query.value.trim())
    if (cursor) params.set('cursor', cursor)
    const body = await api<{ files: FileItem[]; total?: number; nextCursor: string | null }>(
      `/api/files?${params.toString()}`,
    )
    files.value = body.files
    total.value = body.total ?? (body.nextCursor
      ? (targetPage + 1) * pageSize.value
      : (targetPage - 1) * pageSize.value + body.files.length)
    page.value = targetPage
    nextCursor.value = body.nextCursor
    if (body.nextCursor) pageCursors.value[targetPage] = body.nextCursor
    else pageCursors.value = pageCursors.value.slice(0, targetPage)
    emit('hasfiles', files.value.length > 0)
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.fileList)
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(searchTimer))
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
  deleteTrigger.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  confirming.value = ids
}

function closeDeleteDialog(): void {
  confirming.value = null
  void nextTick(() => {
    if (deleteTrigger.value?.isConnected) deleteTrigger.value.focus()
  })
}

watch(confirming, async (ids) => {
  if (!ids) return
  await nextTick()
  const dialog = confirmDialog.value
  if (!dialog || dialog.open) return
  try {
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  } catch {
    dialog.setAttribute('open', '')
  }
})

async function confirmDelete(): Promise<void> {
  const ids = confirming.value
  closeDeleteDialog()
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
    toast(getUserErrorMessage(cause, COPY.errors.delete), 'error')
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
    error.value = getUserErrorMessage(cause, COPY.errors.fileList)
  }
}

function download(file: FileItem): void {
  toast(`开始下载：${file.name}`, 'info')
  window.location.href = `/api/files/${file.id}/download`
}

async function downloadSelectedZip(): Promise<void> {
  const ids = [...selected.value]
  if (ids.length === 0 || zipBusy.value) return
  zipBusy.value = true
  try {
    const response = await fetch('/api/files/batch-download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: window.location.origin,
      },
      body: JSON.stringify({ ids }),
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      throw new Error(localizeErrorMessage(body?.error?.code, body?.error?.message))
    }
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'drop-files.zip'
    anchor.click()
    URL.revokeObjectURL(url)
    selected.value = new Set()
    toast(`已生成 ZIP，包含 ${ids.length} 个文件`, 'success')
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.batchDownload), 'error')
  } finally {
    zipBusy.value = false
  }
}

async function load(reset = true): Promise<void> {
  if (reset) {
    page.value = 1
    pageCursors.value = [null]
    await loadPage(1)
    return
  }
  await nextPage()
}

async function previousPage(): Promise<void> {
  if (page.value <= 1) return
  await loadPage(page.value - 1)
}

async function nextPage(): Promise<void> {
  if (!nextCursor.value) return
  await loadPage(page.value + 1)
}

function onPageSizeChange(): void {
  page.value = 1
  jumpPage.value = ''
  pageCursors.value = [null]
  void loadPage(1)
}

function goToPage(targetPage: number): void {
  if (loading.value || targetPage < 1 || targetPage > pageCount.value || targetPage === page.value) return
  void loadPage(targetPage)
}

function jumpToPage(): void {
  const targetPage = Number.parseInt(jumpPage.value, 10)
  if (!Number.isFinite(targetPage)) return
  goToPage(Math.min(pageCount.value, Math.max(1, targetPage)))
  jumpPage.value = ''
}

onMounted(() => void load(true))
defineExpose({ load })
</script>

<template>
  <div
    class="file-list"
    :aria-busy="loading"
  >
    <div class="toolbar">
      <input
        v-model="query"
        class="search"
        type="search"
        :placeholder="COPY.files.searchPlaceholder"
        aria-label="搜索文件名"
        @input="onSearch"
      >
      <button
        v-if="selected.size > 0"
        class="ghost"
        :disabled="zipBusy"
        type="button"
        @click="downloadSelectedZip"
      >
        {{ zipBusy ? COPY.upload.loadingZip : `${COPY.actions.downloadSelected}（${selected.size}）` }}
      </button>
      <button
        v-if="selected.size > 0"
        class="ghost danger"
        :disabled="selected.size === 0"
        type="button"
        @click="askDelete"
      >
        {{ COPY.actions.deleteSelected }}（{{ selected.size }}）
      </button>
      <div
        v-if="undo"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <button
          class="ghost"
          type="button"
          @click="undoDelete"
        >
          已删除 {{ undo.ids.length }} 个文件 · {{ COPY.actions.undo }}
        </button>
      </div>
    </div>

    <p
      v-if="error"
      class="error"
      role="alert"
      aria-atomic="true"
    >
      {{ error }}
    </p>
    <div
      v-if="loading && files.length > 0"
      class="list-loading"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
    >
      {{ COPY.common.loading }}
    </div>
    <div
      v-if="loading && files.length === 0"
      class="skeleton-list"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
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
      role="status"
      aria-live="polite"
    >
      <p>{{ COPY.files.empty }}</p>
    </div>

    <div
      v-else-if="files.length > 0"
      class="table-scroll"
    >
      <table>
        <caption class="sr-only">
          {{ COPY.files.list }}
        </caption>
        <thead>
          <tr>
            <th scope="col">
              名称
            </th>
            <th scope="col">
              操作
            </th>
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
                    <span>{{ formatFileRetention(file.expiresAt, formatDate) }}</span>
                  </span>
                </span>
              </span>
            </td>
            <td class="actions">
              <button
                class="icon-btn"
                :title="COPY.actions.setFileRetention"
                :aria-label="COPY.actions.setFileRetention"
                type="button"
                @click="expiration = file"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="8"
                    stroke="currentColor"
                    stroke-width="2"
                  />
                  <path
                    d="M12 7v5l3 2"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
              <button
                class="icon-btn"
                :title="COPY.actions.download"
                :aria-label="COPY.actions.download"
                type="button"
                @click="download(file)"
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
                :title="COPY.actions.share"
                :aria-label="COPY.actions.share"
                type="button"
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
                type="button"
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
    </div>

    <nav
      v-if="files.length > 0 || page > 1 || nextCursor"
      class="pagination"
      aria-label="文件列表分页"
    >
      <span
        class="pagination-total"
        aria-live="polite"
      >
        共 {{ total }} 项
      </span>
      <label class="pagination-size">
        <span>每页</span>
        <select
          v-model.number="pageSize"
          :disabled="loading"
          aria-label="文件列表每页条数"
          @change="onPageSizeChange"
        >
          <option
            v-for="size in PAGE_SIZE_OPTIONS"
            :key="size"
            :value="size"
          >
            {{ size }}
          </option>
        </select>
        <span>条</span>
      </label>
      <div class="pagination-center">
        <button
          class="ghost pagination-arrow"
          :disabled="page <= 1 || loading"
          type="button"
          aria-label="上一页"
          @click="previousPage"
        >
          ‹
        </button>
        <template
          v-for="(item, index) in paginationItems"
          :key="typeof item === 'number' ? item : `ellipsis-${index}`"
        >
          <button
            v-if="typeof item === 'number'"
            class="pagination-page"
            :class="{ current: item === page }"
            :aria-current="item === page ? 'page' : undefined"
            :disabled="item === page || loading"
            type="button"
            @click="goToPage(item)"
          >
            {{ item }}
          </button>
          <span
            v-else
            class="pagination-ellipsis"
            aria-hidden="true"
          >…</span>
        </template>
        <button
          class="ghost pagination-arrow"
          :disabled="page >= pageCount || !nextCursor || loading"
          type="button"
          aria-label="下一页"
          @click="nextPage"
        >
          ›
        </button>
      </div>
      <label class="pagination-jump">
        <span>跳转到</span>
        <input
          v-model="jumpPage"
          inputmode="numeric"
          pattern="[0-9]*"
          type="text"
          :aria-label="`跳转到第 ${pageCount} 页以内`"
          @keydown.enter.prevent="jumpToPage"
        >
      </label>
    </nav>

    <ShareDialog
      v-if="sharing"
      :file="sharing"
      @close="sharing = null"
      @shared="emit('shared')"
    />

    <FileExpirationDialog
      v-if="expiration"
      :file="expiration"
      @close="expiration = null"
      @saved="expiration = null; void load(true); emit('changed')"
    />

    <dialog
      v-if="confirming"
      ref="confirmDialog"
      class="confirm-dialog"
      aria-labelledby="file-delete-title"
      aria-describedby="file-delete-description"
      aria-modal="true"
      @cancel.prevent="closeDeleteDialog"
      @click.self="closeDeleteDialog"
    >
      <h2
        id="file-delete-title"
        class="confirm-title"
      >
        删除 {{ confirming.length }} 个文件？
      </h2>
      <p
        id="file-delete-description"
        class="confirm-sub"
      >
        删除后将无法恢复。
      </p>
      <form
        class="confirm-actions"
        @submit.prevent="confirmDelete"
      >
        <button
          class="btn-secondary"
          type="button"
          autofocus
          @click="closeDeleteDialog"
        >
          取消
        </button>
        <button
          class="btn-danger"
          type="submit"
          @click.prevent="confirmDelete"
        >
          删除 {{ confirming.length }} 个文件
        </button>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
/* All theme surfaces use drop-* tokens so both light (newspaper print) and
   dark (CRT terminal) palettes render with consistent contrast. */
.file-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
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
.search:focus-visible {
  outline: 2px solid var(--drop-brand);
  outline-offset: 2px;
}
.table-scroll {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--drop-ink);
  background: var(--drop-surface);
}
table {
  width: 100%;
  border-collapse: collapse;
}
.table-scroll > table {
  display: flex;
  flex-direction: column;
  min-width: 100%;
  height: 100%;
  min-height: 0;
}
.table-scroll thead {
  display: table;
  flex: none;
  width: 100%;
  table-layout: fixed;
}
.table-scroll tbody {
  display: block;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.table-scroll tbody tr {
  display: table;
  width: 100%;
  table-layout: fixed;
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
  border: 0;
  border-radius: 0;
  overflow: hidden;
  color: var(--drop-ink-2);
}
.file-list th:last-child, .file-list td:last-child { width: 11rem; }
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
  width: auto;
  height: 2.25rem;
  aspect-ratio: 1;
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
.confirm-dialog {
  margin: auto;
  padding: 1.75rem 2rem;
  max-width: 22rem;
  width: 90%;
  background: var(--drop-card);
  border: 2px solid var(--drop-ink);
  border-top: 6px solid var(--drop-state-error);
  border-radius: 0;
  color: var(--drop-ink-2);
  box-shadow: var(--drop-shadow-hard);
}
.pagination {
  flex: none;
  display: grid;
  grid-template-columns: auto auto auto auto;
  align-items: center;
  justify-content: flex-end;
  gap: .35rem;
  margin-top: .45rem;
  padding-top: 0;
}
.pagination-total {
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .68rem;
  white-space: nowrap;
}
.pagination-center {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .25rem;
  padding: 0 .15rem;
}
.pagination-arrow { min-width: 1.8rem; font-size: .95rem; line-height: 1; }
.pagination-page,
.pagination-ellipsis {
  min-width: 1.55rem;
  min-height: 1.8rem;
  display: inline-grid;
  place-items: center;
  padding: 0 .15rem;
  border: 1px solid transparent;
  background: transparent;
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: .68rem;
  font-weight: 700;
}
.pagination-page:not(:disabled):hover,
.pagination-page.current {
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
  color: var(--drop-brand);
}
.pagination-page.current { cursor: default; }
.pagination-size {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .68rem;
  white-space: nowrap;
}
.pagination-size select {
  width: 3.2rem;
  min-height: 1.8rem;
  padding: .1rem .25rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  font-weight: 700;
  text-align: center;
}
.pagination-jump {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: .68rem;
  white-space: nowrap;
}
.pagination-jump input {
  width: 2.5rem;
  min-height: 1.8rem;
  padding: .1rem .25rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font: inherit;
  text-align: center;
}
.pagination button.ghost {
  min-width: 1.8rem;
  min-height: 1.8rem;
  padding: .2rem .4rem;
}
.confirm-dialog::backdrop {
  background: color-mix(in srgb, var(--drop-ink) 56%, transparent);
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
