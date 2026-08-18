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

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const body = await api<{ shares: MobileShareItem[] }>('/api/shares')
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
    <p
      v-if="error"
      class="error"
      role="alert"
    >
      {{ error }}
    </p>

    <div
      v-if="loading && shares.length === 0"
      class="skeleton"
      role="status"
      aria-label="加载中"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="skeleton-card"
      >
        <span
          class="skeleton-block"
          :style="{ width: n === 2 ? '48%' : '60%' }"
        />
        <span
          class="skeleton-block"
          style="width: 100%; height: 36px"
        />
      </div>
    </div>

    <div
      v-else-if="shares.length === 0"
      class="empty"
    >
      <AppIcon
        class="empty-icon"
        name="share"
      />
      <h2 class="empty-title">
        还没有分享
      </h2>
      <p class="empty-desc">
        从文件页面创建分享链接，即可分享给你的朋友
      </p>
      <button
        type="button"
        class="empty-cta"
        @click="emit('gofiles')"
      >
        <AppIcon name="folder" />
        <span>去上传文件</span>
      </button>
    </div>

    <template v-else>
      <h2 class="section-title">
        已创建的分享
      </h2>
      <div class="cards">
        <article
          v-for="share in shares"
          :key="share.id"
          class="card"
          role="button"
          tabindex="0"
          @click="onCardClick(share, $event)"
          @keydown.enter="emit('open', share)"
        >
          <div class="card-head">
            <span class="tile">
              <AppIcon name="link" />
            </span>
            <span class="card-name">{{ share.fileName ?? share.fileId }}</span>
            <span
              class="badge"
              :class="isActive(share) ? 'active' : 'inactive'"
            >{{ stateLabel(share) }}</span>
          </div>
          <div
            v-if="shareUrls[share.id] && isActive(share)"
            class="link-row"
          >
            <AppIcon
              class="link-icon"
              name="link"
            />
            <span class="link-text">{{ shareUrls[share.id] }}</span>
            <button
              type="button"
              data-stop
              class="copy-btn"
              :aria-label="copiedId === share.id ? '已复制' : '复制链接'"
              @click="copyUrl(share.id)"
            >
              <AppIcon :name="copiedId === share.id ? 'check' : 'copy'" />
            </button>
          </div>
          <div class="card-meta">
            <span>{{ daysLeft(share) }} · {{ share.downloadCount }} 次下载</span>
            <span>{{ relativeTime(share.createdAt) }}</span>
          </div>
        </article>
      </div>
      <p class="footnote">
        分享链接到期后自动失效
      </p>
    </template>
  </section>
</template>

<style scoped>
.mobile-shares {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 1rem 1rem 1.5rem;
}

.section-title {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--drop-ink-2);
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.card {
  padding: 1rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-lg);
  background: var(--drop-card);
  -webkit-tap-highlight-color: transparent;
}
.card:active {
  background: var(--drop-surface-2);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}
.tile {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-brand-tint);
  color: var(--drop-brand);
}
.tile :deep(svg) {
  width: 1.125rem;
  height: 1.125rem;
}
.card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--drop-ink);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.125rem 0.5rem;
  border-radius: var(--drop-radius-pill);
  font-size: 0.6875rem;
  white-space: nowrap;
}
.badge.active {
  background: color-mix(in srgb, var(--drop-state-success) 10%, transparent);
  color: var(--drop-state-success);
}
.badge.inactive {
  background: var(--drop-muted);
  color: var(--drop-ink-3);
}

.link-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
}
.link-icon {
  width: 1rem;
  height: 1rem;
  color: var(--drop-ink-3);
}
.link-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
  font-family: ui-monospace, "SFMono-Regular", monospace;
  color: var(--drop-ink-2);
}
.copy-btn {
  flex: none;
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
.copy-btn :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.copy-btn:active {
  background: var(--drop-muted);
}

.card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
}
.card-meta span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-meta span:last-child {
  flex: none;
}

.footnote {
  margin: 1.5rem 0 0;
  font-size: 0.75rem;
  color: var(--drop-ink-3);
  text-align: center;
}

.skeleton {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  border: 1px solid var(--drop-border);
  border-radius: var(--drop-radius-lg);
}
.skeleton-block {
  height: 0.875rem;
  border-radius: 0.25rem;
  background: var(--drop-surface-2);
  animation: skeleton-pulse 1.2s ease-in-out infinite;
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
  padding: 1.5rem;
  text-align: center;
}
.empty-icon {
  width: 4rem;
  height: 4rem;
  color: var(--drop-ink-3);
}
.empty-title {
  margin: 1rem 0 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--drop-ink);
}
.empty-desc {
  margin: 0.5rem 0 0;
  max-width: 17.5rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--drop-ink-2);
}
.empty-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  width: 100%;
  max-width: 17.5rem;
  height: 3rem;
  margin-top: 1.5rem;
  border: 0;
  border-radius: var(--drop-radius-md);
  background: var(--drop-surface-2);
  color: var(--drop-ink);
  font-size: 0.9375rem;
  font-weight: 500;
}

.error {
  margin: 0.75rem 0 0;
  color: var(--drop-state-error);
  font-size: 14px;
}
</style>
