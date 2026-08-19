<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { api } from '../../lib/api'
import { formatBytes, formatDate } from '../../lib/format'
import FileTypeIcon from '../FileTypeIcon.vue'
import type { FileItem } from '../FileList.vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ action: [file: FileItem]; upload: []; hasfiles: [value: boolean] }>()

const files = ref<FileItem[]>([])
const nextCursor = ref<string | null>(null)
const query = ref('')
const loading = ref(false)
const error = ref<string | null>(null)

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

function clearSearch(): void {
  if (!query.value) return
  query.value = ''
  void load(true)
}

onMounted(() => void load(true))
defineExpose({ load })
</script>

<template>
  <section
    class="mobile-files"
    aria-label="文件列表"
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
        >搜索文件名</label>
        <input
          id="mobile-files-search"
          v-model="query"
          type="search"
          placeholder="搜索文件名"
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
    >
      {{ error }}
    </p>

    <!-- Loading skeleton -->
    <div
      v-if="loading && files.length === 0"
      class="skeleton"
      role="status"
      aria-label="加载中"
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
    >
      <AppIcon
        class="empty-icon"
        name="folder-open"
      />
      <h2 class="empty-title">
        还没有文件
      </h2>
      <p class="empty-desc">
        上传你的第一个文件，开始使用 Drop
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
    >
      <AppIcon
        class="empty-icon"
        name="search-x"
      />
      <h2 class="empty-title">
        未找到相关文件
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
        <span class="list-title">{{ query.trim() ? '搜索结果' : '全部文件' }}</span>
        <span class="list-count">{{ files.length }}</span>
      </div>
      <div class="file-rows">
        <button
          v-for="file in files"
          :key="file.id"
          type="button"
          class="file-row"
          @click="emit('action', file)"
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
          <AppIcon
            class="chevron"
            name="chevron-right"
          />
        </button>
      </div>
      <div
        v-if="nextCursor"
        class="more"
      >
        <button
          type="button"
          :disabled="loading"
          @click="load(false)"
        >
          {{ loading ? '加载中…' : '加载更多' }}
        </button>
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
  padding: 0.75rem 1rem;
  background: var(--drop-background);
  border-bottom: 1px solid var(--drop-line);
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
  height: 2.5rem;
  padding: 0 2.5rem 0 2.375rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  color: var(--drop-ink);
  font-size: 0.875rem;
  appearance: none;
}
.search-box input::-webkit-search-cancel-button {
  display: none;
}
.search-box input::placeholder {
  color: var(--drop-ink-3);
}
.search-box input:focus {
  outline: none;
  border-color: var(--drop-brand);
}
.clear-btn {
  position: absolute;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: var(--drop-radius-sm);
  background: transparent;
  color: var(--drop-ink-2);
}
.clear-btn :deep(svg) {
  width: 1rem;
  height: 1rem;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
}
.list-title {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--drop-ink-2);
}
.list-count {
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}

.file-rows {
  display: flex;
  flex-direction: column;
}
.file-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  min-height: 3.5rem;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
}
.file-row + .file-row {
  border-top: 1px solid var(--drop-line);
}
.file-row:active {
  background: var(--drop-surface-2);
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  color: var(--drop-ink-2);
}
.tile :deep(.file-icon) {
  width: 1.375rem;
  height: 1.375rem;
  color: inherit;
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
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--drop-ink);
}
.file-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}
.file-time {
  margin-left: auto;
}
.chevron {
  color: var(--drop-ink-3);
}

.more {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0;
}
.more button {
  min-height: 2.5rem;
  padding: 0 1.25rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-md);
  background: var(--drop-card);
  color: var(--drop-ink-2);
  font-size: 0.875rem;
}

.skeleton {
  display: flex;
  flex-direction: column;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  min-height: 3.5rem;
}
.skeleton-row + .skeleton-row {
  border-top: 1px solid var(--drop-line);
}
.skeleton-tile {
  flex: none;
  width: 2.5rem;
  height: 2.5rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.skeleton-block {
  height: 14px;
  border-radius: 4px;
  background: var(--drop-surface-2);
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}
.skeleton-block.short {
  height: 11px;
}
@keyframes skeleton-pulse {
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
  padding: 24px;
  text-align: center;
}
.empty-icon {
  width: 64px;
  height: 64px;
  color: var(--drop-ink-3);
}
.empty-title {
  margin: 16px 0 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--drop-ink);
}
.empty-desc {
  margin: 8px 0 0;
  max-width: 280px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--drop-ink-2);
}
.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--drop-ink-3);
}
.empty-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  max-width: 280px;
  height: 48px;
  margin-top: 24px;
  border: 0;
  border-radius: var(--drop-radius-md);
  background: var(--drop-brand);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
}
.empty-cta:active {
  background: var(--drop-brand-strong);
}

.error {
  margin: 12px 0 0;
  color: var(--drop-state-error);
  font-size: 14px;
}
</style>
