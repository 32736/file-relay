<script lang="ts">
export interface MobileShareItem {
  id: string
  fileId: string
  fileName: string | null
  createdAt: number
  expiresAt: number | null
  maxDownloads: number | null
  downloadCount: number
  revokedAt: number | null
  /** Server-recovered link (same account, any device); null for legacy shares. */
  url: string | null
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { api, getUserErrorMessage } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import { COPY, formatFileCount, getShareStatusLabel } from '../../lib/copy'
import { loadShareUrls } from '../../lib/share-urls'
import { toast } from '../../lib/toast'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ open: [share: MobileShareItem]; gofiles: [] }>()

const MOBILE_PAGE_SIZE = 20
const shares = ref<MobileShareItem[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const shareUrls = ref<Record<string, string>>({})
const query = ref('')

async function load(reset = true): Promise<void> {
  if (loading.value || (!reset && !nextCursor.value)) return
  loading.value = true
  error.value = null
  try {
    const params = new URLSearchParams({ limit: String(MOBILE_PAGE_SIZE) })
    if (query.value.trim()) params.set('q', query.value.trim())
    if (!reset && nextCursor.value) params.set('cursor', nextCursor.value)
    const body = await api<{ shares: MobileShareItem[]; nextCursor: string | null }>(
      `/api/shares?${params.toString()}`,
    )
    shares.value = reset ? body.shares : [...shares.value, ...body.shares]
    nextCursor.value = body.nextCursor
    // Server URL first (cross-device); the local cache only backs up legacy
    // shares created before server-side link recovery existed.
    const urls = loadShareUrls()
    for (const share of body.shares) {
      if (share.url) urls[share.id] = share.url
    }
    shareUrls.value = urls
  } catch (cause) {
    error.value = getUserErrorMessage(cause, COPY.errors.shareList)
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

function clearSearch(): void {
  if (!query.value) return
  query.value = ''
  void load(true)
}

function onListScroll(event: Event): void {
  const container = event.currentTarget as HTMLElement
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight
  if (distanceToBottom <= 160) void load(false)
}

async function copyUrl(id: string): Promise<void> {
  const url = shareUrls.value[id]
  if (!url) return
  try {
    await copyText(url)
    toast(COPY.feedback.linkCopied, 'success')
    copiedId.value = id
    setTimeout(() => (copiedId.value = null), 1500)
  } catch (cause) {
    toast(getUserErrorMessage(cause, COPY.errors.copy), 'error')
  }
}

function stateLabel(share: MobileShareItem): string {
  return getShareStatusLabel(share)
}

function isActive(share: MobileShareItem): boolean {
  return stateLabel(share) === '有效'
}

function daysLeft(share: MobileShareItem): string {
  if (share.expiresAt === null) return '永久有效'
  const days = Math.ceil((share.expiresAt - Math.floor(Date.now() / 1000)) / 86400)
  return days > 0 ? `剩余 ${days} 天` : '已过期'
}

function relativeTime(epochSeconds: number): string {
  const delta = Math.floor(Date.now() / 1000) - epochSeconds
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 14) return `${Math.floor(delta / 86400)} 天前`
  const date = new Date(epochSeconds * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function onCardClick(share: MobileShareItem): void {
  emit('open', share)
}

onMounted(() => void load(true))
defineExpose({ load })
</script>

<template>
  <section
    class="mobile-shares"
    aria-label="分享列表"
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
          for="mobile-shares-search"
        >{{ COPY.shares.searchPlaceholder }}</label>
        <input
          id="mobile-shares-search"
          v-model="query"
          type="search"
          :placeholder="COPY.shares.searchPlaceholder"
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

    <!-- Refresh indicator while cards are already visible -->
    <div
      v-if="loading && shares.length > 0"
      class="list-loading"
      role="status"
      :aria-label="COPY.common.loading"
      aria-live="polite"
    >
      {{ COPY.common.loading }}
    </div>

    <div
      v-if="loading && shares.length === 0"
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

    <div
      v-else-if="shares.length === 0 && !query"
      class="empty"
      role="status"
      aria-live="polite"
    >
      <p class="empty-text">
        {{ COPY.shares.empty }}
      </p>
    </div>

    <!-- Search without results -->
    <div
      v-else-if="shares.length === 0"
      class="empty"
      role="status"
      aria-live="polite"
    >
      <AppIcon
        class="empty-icon"
        name="search-x"
      />
      <h2 class="empty-title">
        {{ COPY.shares.noResults }}
      </h2>
      <p class="empty-desc">
        没有找到与“{{ query.trim() }}”匹配的分享链接
      </p>
      <p class="empty-hint">
        试试其他关键词
      </p>
    </div>

    <template v-else>
      <div class="list-head">
        <h2 class="list-title">
          {{ query.trim() ? COPY.shares.searchResults : COPY.shares.all }}
        </h2>
        <span class="list-count">{{ formatFileCount(shares.length) }}</span>
      </div>
      <div
        class="list-scroll"
        @scroll.passive="onListScroll"
      >
        <ul class="file-rows">
          <li
            v-for="share in shares"
            :key="share.id"
            class="file-row"
          >
            <button
              type="button"
              class="file-row-main"
              @click="onCardClick(share)"
            >
              <span class="tile">
                <AppIcon name="link" />
              </span>
              <span class="share-body">
                <span class="share-name-row">
                  <span class="share-name">{{ share.fileName || '未命名文件' }}</span>
                  <span
                    class="badge"
                    :class="isActive(share) ? 'active' : 'inactive'"
                  >{{ stateLabel(share) }}</span>
                </span>
                <span class="share-meta">
                  <span class="meta-left">
                    {{ daysLeft(share) }} · {{ share.downloadCount }} 次下载
                  </span>
                  <span class="meta-right">
                    <span v-if="!shareUrls[share.id] || !isActive(share)">{{ relativeTime(share.createdAt) }}</span>
                  </span>
                </span>
              </span>
              <AppIcon
                class="chevron"
                name="chevron-right"
              />
            </button>
            <button
              v-if="shareUrls[share.id] && isActive(share)"
              type="button"
              class="copy-btn"
              :aria-label="copiedId === share.id ? '已复制' : '复制链接'"
              @click="copyUrl(share.id)"
            >
              <AppIcon :name="copiedId === share.id ? 'check' : 'copy'" />
            </button>
          </li>
        </ul>
        <div
          v-if="loading && shares.length > 0"
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
.mobile-shares {
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
  padding: 0.625rem var(--drop-mobile-gutter) 0.5rem;
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
  padding: 0 2.5rem 0 2rem;
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
  border-color: var(--drop-brand);
  box-shadow: inset 0 0 0 1px var(--drop-brand);
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
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear;
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
  padding: 0.75rem var(--drop-mobile-gutter) 0.5rem;
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
  padding-left: 0.5rem;
  border-left: 3px solid var(--drop-brand);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--drop-ink-2);
}
.list-count {
  font-family: var(--font-micro);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
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
.file-row-main:active,
.file-row:focus-within {
  background: var(--drop-surface-2);
}
.file-row:last-child {
  border-bottom: none;
}
.file-row > .copy-btn {
  margin-right: 0;
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
.tile :deep(svg) {
  width: 0.875rem;
  height: 0.875rem;
}
.share-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}
.share-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.share-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--drop-ink);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0.5rem;
  border: 0;
  border-radius: 999px;
  font-family: var(--font-micro);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.badge.active {
  background: color-mix(in srgb, var(--drop-state-success) 14%, transparent);
  color: var(--drop-state-success);
}
.badge.inactive {
  background: color-mix(in srgb, var(--drop-state-error) 12%, transparent);
  color: var(--drop-state-error);
}

.share-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.375rem;
  font-family: var(--font-micro);
  font-size: 0.66rem;
  color: var(--drop-ink-3);
  font-variant-numeric: tabular-nums;
}
.meta-left {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-right {
  flex: none;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.copy-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  box-sizing: border-box;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear;
}
.copy-btn::before {
  content: "";
  position: absolute;
  inset: 0.25rem;
  border: 1px solid var(--drop-border);
  background: transparent;
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.copy-btn :deep(svg) {
  position: relative;
  z-index: 1;
  width: 0.75rem;
  height: 0.75rem;
}
.copy-btn:active {
  color: var(--drop-brand);
}
.copy-btn:active::before {
  border-color: var(--drop-brand);
  background: var(--drop-brand-tint);
}
.chevron {
  display: none;
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
}
.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.skeleton-block {
  height: 0.75rem;
  border-radius: 0;
  background: var(--drop-surface-2);
  animation: skeleton-blink 1.2s steps(2, jump-none) infinite;
}
.skeleton-block.short {
  height: 0.625rem;
  width: 40%;
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
  padding: 2rem 1rem;
  text-align: center;
}
.empty-text {
  font-family: var(--font-micro);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  color: var(--drop-ink-3);
}
.empty-text::before {
  content: "[ ";
  color: var(--drop-brand);
}
.empty-text::after {
  content: " ]";
  color: var(--drop-brand);
}

.error {
  margin: 0.75rem 0 0;
  color: var(--drop-state-error);
  font-family: var(--font-micro);
  font-size: 0.8rem;
}
</style>
