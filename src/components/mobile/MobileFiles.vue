<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage, localizeErrorMessage } from '../../lib/api'
import { COPY, formatFileCount } from '../../lib/copy'
import { formatBytes, formatDate } from '../../lib/format'
import { toast } from '../../lib/toast'
import FileTypeIcon from '../FileTypeIcon.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ action: [file: FileItem]; upload: []; hasfiles: [value: boolean] }>()

const MOBILE_PAGE_SIZE = 20
const files = ref<FileItem[]>([])
const nextCursor = ref<string | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const selectionMode = ref(false)
const selected = ref<Set<string>>(new Set())
const zipBusy = ref(false)

async function load(reset = true): Promise<void> {
  if (loading.value || (!reset && !nextCursor.value)) return
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ limit: String(MOBILE_PAGE_SIZE) })
    if (query.value.trim()) params.set('q', query.value.trim())
    if (!reset && nextCursor.value) params.set('cursor', nextCursor.value)
    const body = await api<{ files: FileItem[]; nextCursor: string | null }>(
      `/api/files?${params.toString()}`,
    )
    files.value = reset ? body.files : [...files.value, ...body.files]
    if (reset) selected.value = new Set()
    nextCursor.value = body.nextCursor
    emit('hasfiles', files.value.length > 0)
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.fileList)
  } finally {
    loading.value = false
  }
}

function onListScroll(event: Event): void {
  const container = event.currentTarget as HTMLElement
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distanceToBottom <= 160) void load(false)
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(searchTimer))
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(true), 250)
}

function clearSearch(): void {
  if (!query.value) return
  query.value = ''
  void load(true)
}

function download(file: FileItem): void {
  toast(`开始下载：${file.name}`, 'info')
  window.location.href = `/api/files/${file.id}/download`
}

function toggleSelected(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

async function downloadSelectedZip(): Promise<void> {
  const ids = [...selected.value]
  if (ids.length === 0 || zipBusy.value) return
  zipBusy.value = true
  try {
    const response = await fetch('/api/files/batch-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: window.location.origin },
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
    selectionMode.value = false
    toast(`已生成 ZIP，包含 ${ids.length} 个文件`, 'success')
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.batchDownload), 'error')
  } finally {
    zipBusy.value = false
  }
}

onMounted(() => void load(true))
defineExpose({ load })
</script>

<template>
  <section
    class="mobile-files"
    aria-label="文件列表"
    :aria-busy="loading"
  >
    <div class="search-row">
      <div class="search-box">
        <AppIcon
          class="search-icon"
          name="search"
        />
        <label
          class="sr-only"
          for="mobile-files-search"
        >{{ COPY.files.searchPlaceholder }}</label>
        <input
          id="mobile-files-search"
          v-model="query"
          type="search"
          :placeholder="COPY.files.searchPlaceholder"
          @input="onSearch"
        >
        <button
          v-if="query"
          type="button"
          class="clear-btn"
          aria-label="清除搜索"
          @click="clearSearch"
        >
          <AppIcon name="x" />
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

    <!-- Refresh indicator while rows are already visible -->
    <div
      v-if="loading && files.length > 0"
      class="list-loading"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
    >
      {{ COPY.common.loading }}
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="loading && files.length === 0"
      class="skeleton"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
    >
      <div
        v-for="n in 5"
        :key="n"
        class="skeleton-row"
      >
        <span class="skeleton-tile" />
        <span class="skeleton-lines">
          <span
            class="skeleton-block"
            :style="{ width: n % 2 ? '58%' : '42%' }"
          />
          <span
            class="skeleton-block short"
            style="width: 30%"
          />
        </span>
      </div>
    </div>

    <!-- No files at all -->
    <div
      v-else-if="files.length === 0 && !query"
      class="empty"
      role="status"
      aria-live="polite"
    >
      <AppIcon
        class="empty-icon"
        name="folder-open"
      />
      <h2 class="empty-title">
        {{ COPY.files.empty }}
      </h2>
      <p class="empty-desc">
        上传文件即可开始使用
      </p>
      <button
        type="button"
        class="empty-cta"
        @click="emit('upload')"
      >
        <AppIcon name="upload-cloud" />
        <span>上传文件</span>
      </button>
    </div>

    <!-- Search without results -->
    <div
      v-else-if="files.length === 0"
      class="empty"
      role="status"
      aria-live="polite"
    >
      <AppIcon
        class="empty-icon"
        name="search-x"
      />
      <h2 class="empty-title">
        {{ COPY.files.noResults }}
      </h2>
      <p class="empty-desc">
        没有找到与“{{ query.trim() }}”匹配的文件
      </p>
      <p class="empty-hint">
        试试其他关键词，或上传新文件
      </p>
    </div>

    <template v-else>
      <div class="list-head">
        <div class="list-heading">
          <h2 class="list-title">
            {{ query.trim() ? COPY.files.searchResults : COPY.files.all }}
          </h2>
          <span class="list-count">{{ formatFileCount(files.length) }}</span>
        </div>
        <div class="list-actions">
          <button
            v-if="selectionMode && selected.size > 0"
            type="button"
            class="batch-download"
            :disabled="zipBusy"
            @click="downloadSelectedZip"
          >
            {{ zipBusy ? COPY.upload.loadingZip : `${COPY.actions.downloadSelectedCompact}（${selected.size}）` }}
          </button>
          <button
            type="button"
            class="select-toggle"
            @click="selectionMode = !selectionMode; selected = new Set()"
          >
            {{ selectionMode ? '完成' : '多选' }}
          </button>
        </div>
      </div>
      <div
        class="list-scroll"
        @scroll.passive="onListScroll"
      >
        <ul class="file-rows">
          <li
            v-for="file in files"
            :key="file.id"
            class="file-row"
            :class="{ selected: selected.has(file.id) }"
          >
            <button
              v-if="selectionMode"
              type="button"
              class="row-select"
              :aria-label="selected.has(file.id) ? `取消选择 ${file.name}` : `选择 ${file.name}`"
              :aria-pressed="selected.has(file.id)"
              @click="toggleSelected(file.id)"
            >
              <AppIcon :name="selected.has(file.id) ? 'check' : 'plus'" />
            </button>
            <button
              type="button"
              class="file-row-main"
              @click="selectionMode ? toggleSelected(file.id) : emit('action', file)"
            >
              <span class="tile">
                <FileTypeIcon :mime="file.mimeType" />
              </span>
              <span class="file-body">
                <span class="file-name">{{ file.name }}</span>
                <span class="file-meta">
                  <span class="file-size">{{ formatBytes(file.size) }}</span>
                  <span class="file-time">{{ formatDate(file.createdAt) }}</span>
                </span>
              </span>
            </button>
            <button
              type="button"
              class="row-action download-btn"
              :aria-label="`下载 ${file.name}`"
              @click="download(file)"
            >
              <AppIcon name="download" />
            </button>
          </li>
        </ul>
        <div
          v-if="loading && files.length > 0"
          class="load-more-status"
          role="status"
          aria-live="polite"
        >
          {{ COPY.common.loadingEllipsis }}
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mobile-files {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.search-row {
  padding: 0.5rem var(--drop-mobile-gutter);
  background: var(--drop-background);
  border-bottom: 2px solid var(--drop-ink);
}
.search-box {
  position: relative;
  display: flex;
  align-items: center;
}
.search-box .search-icon {
  position: absolute;
  left: 0.75rem;
  color: var(--drop-ink-3);
  pointer-events: none;
}
.search-box input {
  width: 100%;
  height: 2.25rem;
  padding: 0 2rem 0 1.875rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink);
  font-family: var(--font-micro);
  font-size: 0.8125rem;
  appearance: none;
  transition: border-color var(--drop-dur-fast) linear;
}
.search-box input::-webkit-search-cancel-button {
  display: none;
}
.search-box input::placeholder {
  color: var(--drop-ink-3);
}
.search-box input:focus {
  outline: none;
  border: 2px solid var(--drop-brand);
  padding-right: calc(2.25rem - 1px);
  padding-left: calc(2.125rem - 1px);
}
.search-box input:focus-visible {
  outline: 2px solid var(--drop-brand);
  outline-offset: 2px;
}
.clear-btn {
  position: absolute;
  right: 0.375rem;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 1.75rem;
  aspect-ratio: 1;
  box-sizing: border-box;
  border: 1px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
  transition: background-color var(--drop-dur-fast) linear;
}
.clear-btn:active {
  background: var(--drop-ink);
  color: var(--drop-background);
}
.clear-btn :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem var(--drop-mobile-gutter) 0.375rem;
}
.list-heading {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  min-width: 0;
}
.list-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.select-toggle,
.batch-download {
  min-height: 1.7rem;
  padding: 0 0.45rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface);
  color: var(--drop-ink-2);
  font-family: var(--font-micro);
  font-size: 0.66rem;
  font-weight: 700;
}
.batch-download {
  border-color: var(--drop-brand);
  color: var(--drop-brand);
}
.list-scroll {
  flex: 1;
  min-height: 0;
  padding-inline: var(--drop-mobile-gutter);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--drop-ink-3) transparent;
  scrollbar-width: thin;
}
.list-scroll::-webkit-scrollbar { width: 4px; }
.list-scroll::-webkit-scrollbar-track { background: transparent; }
.list-scroll::-webkit-scrollbar-thumb { background: var(--drop-ink-3); }
.load-more-status {
  padding: 0.6rem 0;
  color: var(--drop-ink-3);
  font-family: var(--font-micro);
  font-size: 0.7rem;
  text-align: center;
}
.list-title {
  margin: 0;
  font-family: var(--font-micro);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--drop-ink-2);
}
.list-title::before {
  content: "[ ";
  color: var(--drop-brand);
}
.list-title::after {
  content: " ]";
  color: var(--drop-brand);
}
.list-count {
  font-family: var(--font-micro);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
}

.file-rows {
  display: flex;
  flex-direction: column;
  list-style: none;
  margin: 0;
  padding: 0;
}
.file-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 4.25rem;
  border: 0;
  border-bottom: 1px solid var(--drop-line);
  border-radius: 0;
  background: transparent;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.file-row + .file-row {
  border-top: 0;
}
.file-row:focus-within {
  background: var(--drop-surface-2);
}
.file-row:last-child {
  border-bottom: none;
}
.file-row.selected {
  background: var(--drop-brand-tint);
  box-shadow: inset 3px 0 0 var(--drop-brand);
}
.row-select {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.75rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--drop-brand);
}
.row-select :deep(svg) { width: 1rem; height: 1rem; }
.file-row-main {
  display: flex;
  flex: 1;
  min-width: 0;
  width: 100%;
  align-items: center;
  gap: 0.625rem;
  min-height: 4.25rem;
  padding: 0.625rem 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 0;
  background: var(--drop-surface-2);
  color: var(--drop-ink-2);
}
.tile :deep(.file-icon) {
  width: 1rem;
  height: 1rem;
  border: 0;
  background: transparent;
  color: inherit;
}
.tile :deep(.file-icon svg) {
  width: 0.875rem;
  height: 0.875rem;
}
.tile :deep(.file-icon.image) {
  color: var(--drop-brand);
}
.file-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--drop-ink);
}
.file-meta {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-micro);
  font-size: 0.66rem;
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
}
.file-time {
  margin-left: auto;
}
.row-action {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
  -webkit-tap-highlight-color: transparent;
}
.download-btn {
  margin-right: 0;
}
.row-action::before {
  content: "";
  position: absolute;
  inset: 0.25rem;
  border: 1px solid var(--drop-border);
  background: transparent;
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.row-action :deep(svg) {
  position: relative;
  z-index: 1;
  width: 1rem;
  height: 1rem;
}
.row-action:active {
  color: var(--drop-brand);
}
.row-action:active::before {
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
}

.skeleton {
  display: flex;
  flex-direction: column;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  min-height: 2.5rem;
}
.skeleton-row + .skeleton-row {
  border-top: 1px solid var(--drop-line);
}
.skeleton-tile {
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: var(--drop-surface-2);
  animation: skeleton-blink 1.2s steps(2, jump-none) infinite;
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}
.skeleton-block {
  height: 12px;
  border-radius: 0;
  background: var(--drop-surface-2);
  animation: skeleton-blink 1.2s steps(2, jump-none) infinite;
}
.skeleton-block.short {
  height: 10px;
}
@keyframes skeleton-blink {
  50% {
    opacity: 0.45;
  }
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 3rem 1rem;
  border: 0;
  background: transparent;
  color: var(--drop-ink-3);
  text-align: center;
}
.empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: var(--drop-ink-3);
  opacity: 0.5;
}
.empty-title {
  margin: 0;
  font-family: var(--font-micro);
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--drop-ink);
}
.empty-title::before {
  content: "[ ";
  color: var(--drop-brand);
}
.empty-title::after {
  content: " ]";
  color: var(--drop-brand);
}
.empty-desc {
  margin: 0;
  max-width: 240px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--drop-ink-2);
}
.empty-hint {
  margin: 0;
  font-family: var(--font-micro);
  font-size: 0.7rem;
  color: var(--drop-ink-3);
}
.empty-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: 2.25rem;
  margin-top: 1rem;
  padding: 0 1rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-brand);
  color: var(--drop-background);
  font-family: var(--font-micro);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  box-shadow: var(--drop-shadow-1);
  transition: transform var(--drop-dur-fast) linear, box-shadow var(--drop-dur-fast) linear;
}
.empty-cta:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 #000000;
}

.error {
  margin: 12px 0 0;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.8rem;
}
</style>
