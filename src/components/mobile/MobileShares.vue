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
import { onMounted, ref } from 'vue'

import { api } from '../../lib/api'
import { loadShareUrls } from '../../lib/share-urls'
import { toast } from '../../lib/toast'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ open: [share: MobileShareItem]; gofiles: [] }>()

const shares = ref<MobileShareItem[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const shareUrls = ref<Record<string, string>>({})
const query = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const qs = query.value.trim() ? `?q=${encodeURIComponent(query.value.trim())}` : ''
    const body = await api<{ shares: MobileShareItem[] }>(`/api/shares${qs}`)
    shares.value = body.shares
    // Server URL first (cross-device); the local cache only backs up legacy
    // shares created before server-side link recovery existed.
    const urls = loadShareUrls()
    for (const share of body.shares) {
      if (share.url) urls[share.id] = share.url
    }
    shareUrls.value = urls
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void load(), 250)
}

function clearSearch(): void {
  if (!query.value) return
  query.value = ''
  void load()
}

async function copyUrl(id: string): Promise<void> {
  const url = shareUrls.value[id]
  if (!url) return
  await navigator.clipboard.writeText(url)
  toast('链接已复制', 'success')
  copiedId.value = id
  setTimeout(() => (copiedId.value = null), 1500)
}

function stateLabel(share: MobileShareItem): string {
  if (share.revokedAt !== null) return '已撤销'
  if (share.expiresAt !== null && share.expiresAt <= Math.floor(Date.now() / 1000)) return '已过期'
  return share.maxDownloads !== null && share.downloadCount >= share.maxDownloads
    ? '已耗尽'
    : '有效'
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

function onCardClick(share: MobileShareItem, event: MouseEvent): void {
  // The copy button inside the card must not open the detail view.
  if ((event.target as HTMLElement).closest('[data-stop]')) return
  emit('open', share)
}

onMounted(() => void load())
defineExpose({ load })
</script>

<template>
  <section
    class="mobile-shares"
    aria-label="分享列表"
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
        >搜索分享文件</label>
        <input
          id="mobile-shares-search"
          v-model="query"
          type="search"
          placeholder="搜索分享文件"
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

    <!-- Refresh indicator while cards are already visible -->
    <div
      v-if="loading && shares.length > 0"
      class="list-loading"
      role="status"
      aria-label="加载中"
    >
      加载中
    </div>

    <div
      v-if="loading && shares.length === 0"
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

    <div
      v-else-if="shares.length === 0 && !query"
      class="empty"
    >
      <p class="empty-text">
        暂无分享
      </p>
    </div>

    <!-- Search without results -->
    <div
      v-else-if="shares.length === 0"
      class="empty"
    >
      <AppIcon
        class="empty-icon"
        name="search-x"
      />
      <h2 class="empty-title">
        未找到相关分享
      </h2>
      <p class="empty-desc">
        没有找到与“{{ query.trim() }}”匹配的分享
      </p>
      <p class="empty-hint">
        试试其他关键词
      </p>
    </div>

    <template v-else>
      <div class="list-head">
        <span class="list-title">{{ query.trim() ? '搜索结果' : '全部分享' }}</span>
        <span class="list-count">{{ shares.length }}</span>
      </div>
      <div class="file-rows">
        <button
          v-for="share in shares"
          :key="share.id"
          type="button"
          class="file-row"
          @click="onCardClick(share, $event)"
        >
          <span class="tile">
            <AppIcon name="link" />
          </span>
          <span class="share-body">
            <span class="share-name-row">
              <span class="share-name">{{ share.fileName ?? share.fileId }}</span>
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
                <button
                  v-if="shareUrls[share.id] && isActive(share)"
                  type="button"
                  data-stop
                  class="copy-btn"
                  :aria-label="copiedId === share.id ? '已复制' : '复制链接'"
                  @click="copyUrl(share.id)"
                >
                  <AppIcon :name="copiedId === share.id ? 'check' : 'copy'" />
                </button>
                <span v-else>{{ relativeTime(share.createdAt) }}</span>
              </span>
            </span>
          </span>
          <AppIcon
            class="chevron"
            name="chevron-right"
          />
        </button>
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
  padding: 0.5rem 0.875rem;
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
  height: 2.5rem;
  padding: 0 2.25rem 0 2.125rem;
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
.clear-btn {
  position: absolute;
  right: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
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
  width: 1rem;
  height: 1rem;
}

.list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.875rem 0.375rem;
}
.list-title {
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
}
.file-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  min-height: 3rem;
  border: 0;
  border-left: 4px solid transparent;
  border-radius: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  color: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--drop-dur-fast) linear, border-color var(--drop-dur-fast) linear;
}
.file-row + .file-row {
  border-top: 1px solid var(--drop-line);
}
.file-row:active {
  background: var(--drop-surface-2);
  border-left-color: var(--drop-brand);
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--drop-ink);
  border-radius: 0;
  background: var(--drop-surface-2);
  color: var(--drop-brand);
}
.tile :deep(svg) {
  width: 1rem;
  height: 1rem;
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
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--drop-ink);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0.4rem;
  border: 1px solid currentColor;
  border-radius: 0;
  font-family: var(--font-micro);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.badge.active {
  background: transparent;
  color: var(--drop-state-success);
}
.badge.inactive {
  background: transparent;
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
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  height: 1.25rem;
  border: 1px solid var(--drop-line);
  border-radius: 0;
  background: transparent;
  color: var(--drop-ink-2);
  transition: background-color var(--drop-dur-fast) linear, color var(--drop-dur-fast) linear;
}
.copy-btn :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}
.copy-btn:active {
  background: var(--drop-brand);
  border-color: var(--drop-brand);
  color: var(--drop-background);
}
.chevron {
  width: 1rem;
  height: 1rem;
  color: var(--drop-ink-3);
}

.skeleton {
  display: flex;
  flex-direction: column;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.875rem;
  min-height: 3rem;
}
.skeleton-row + .skeleton-row {
  border-top: 1px solid var(--drop-line);
}
.skeleton-tile {
  flex: none;
  width: 2rem;
  height: 2rem;
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
